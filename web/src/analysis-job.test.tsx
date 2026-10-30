import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getClient } from "./api";
import { useAnalysisJob } from "./hooks/useAnalysisJob";
import { uiPreviewJob } from "./fixtures/ui-previews";
import type { Job } from "./types";

vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), getClient: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function job(id: string, overrides: Partial<Job> = {}): Job {
  return { ...uiPreviewJob("scoring"), job_id: id, ...overrides };
}
const getAnalysis = vi.fn();
const createAnalysis = vi.fn();
const deleteAnalysis = vi.fn();
async function flush() { await act(async () => {}); }
async function advance(time: number) { await act(async () => { await vi.advanceTimersByTimeAsync(time); }); }

beforeEach(() => {
  vi.useFakeTimers();
  getAnalysis.mockReset(); createAnalysis.mockReset(); deleteAnalysis.mockReset();
  vi.mocked(getClient).mockResolvedValue({ getAnalysis, createAnalysis, deleteAnalysis } as unknown as Awaited<ReturnType<typeof getClient>>);
});
afterEach(() => vi.useRealTimers());

describe("analysis status reads", () => {
  it("has one read in flight and waits 500ms after each response", async () => {
    const first = deferred<Job>(); const second = deferred<Job>();
    getAnalysis.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, unmount } = renderHook(() => useAnalysisJob("a"));
    await flush(); await advance(5000);
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    expect(result.current.initialLoading).toBe(true);
    await act(async () => first.resolve(job("a")));
    await advance(499); expect(getAnalysis).toHaveBeenCalledTimes(1);
    await advance(1); expect(getAnalysis).toHaveBeenCalledTimes(2);
    await advance(5000); expect(getAnalysis).toHaveBeenCalledTimes(2);
    const signal = getAnalysis.mock.calls[1][1] as AbortSignal;
    unmount(); expect(signal.aborted).toBe(true);
    await act(async () => second.resolve(job("a", { status: "done" })));
    await advance(5000); expect(getAnalysis).toHaveBeenCalledTimes(2);
  });

  it("resets immediately on ID change, aborts old reads and ignores their late success/error", async () => {
    const a = deferred<Job>(); const b = deferred<Job>(); const c = deferred<Job>(); const d = deferred<Job>();
    getAnalysis.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(c.promise).mockReturnValueOnce(d.promise);
    const { result, rerender } = renderHook(({ id }) => useAnalysisJob(id), { initialProps: { id: "a" } });
    await flush(); const signal = getAnalysis.mock.calls[0][1] as AbortSignal;
    rerender({ id: "b" }); await flush();
    expect(signal.aborted).toBe(true); expect(result.current.job).toBeNull(); expect(result.current.error).toBeNull();
    await act(async () => b.resolve(job("b")));
    await act(async () => a.resolve(job("a", { status: "done" })));
    expect(result.current.job?.job_id).toBe("b");
    await advance(500); rerender({ id: "c" }); await flush();
    await act(async () => c.reject(new ApiError("NOT_FOUND", "old missing", 404)));
    expect(result.current.error).toBeNull(); expect(result.current.job).toBeNull();
  });

  it("Retry invalidates synchronously and only repeats GET while retaining last known job", async () => {
    const stale = deferred<Job>(); const fresh = deferred<Job>();
    getAnalysis.mockResolvedValueOnce(job("retry")).mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    const { result } = renderHook(() => useAnalysisJob("retry"));
    await flush(); await advance(500);
    expect(result.current.job?.stage).toBe("scoring"); expect(result.current.error?.kind).toBe("transport");
    act(() => result.current.retry()); await flush();
    expect(result.current.job?.stage).toBe("scoring"); expect(result.current.reading).toBe(true);
    const signal = getAnalysis.mock.calls[2][1] as AbortSignal;
    act(() => result.current.retry());
    await act(async () => stale.resolve(job("retry", { status: "done" })));
    expect(signal.aborted).toBe(true); expect(result.current.job?.status).toBe("running");
    await act(async () => fresh.resolve(job("retry", { stage: "experimental" })));
    expect(result.current.error).toBeNull(); expect(result.current.job?.stage).toBe("experimental");
    expect(createAnalysis).not.toHaveBeenCalled(); expect(deleteAnalysis).not.toHaveBeenCalled();
  });

  it.each(["done", "error"])("stops polling on status %s even when stage disagrees", async (status) => {
    getAnalysis.mockResolvedValue(job("terminal", { status, stage: "scoring" }));
    const { result } = renderHook(() => useAnalysisJob("terminal"));
    await flush(); await advance(10000);
    expect(result.current.job?.status).toBe(status); expect(getAnalysis).toHaveBeenCalledTimes(1);
  });

  it("keeps polling unknown statuses/stages and a running done stage", async () => {
    getAnalysis.mockResolvedValueOnce(job("future", { stage: "future-stage" }))
      .mockResolvedValueOnce(job("future", { status: "future-status", stage: "done" }))
      .mockResolvedValue(job("future", { stage: "done" }));
    const { result } = renderHook(() => useAnalysisJob("future"));
    await flush(); await advance(1000);
    expect(getAnalysis).toHaveBeenCalledTimes(3); expect(result.current.completion).toBeNull();
  });

  it("distinguishes missing jobs and ignores aborts without transport failures", async () => {
    getAnalysis.mockRejectedValueOnce(new DOMException("Canceled", "AbortError"))
      .mockRejectedValueOnce(new ApiError("NOT_FOUND", "gone", 404));
    const { result } = renderHook(() => useAnalysisJob("missing"));
    await flush(); expect(result.current.error).toBeNull(); expect(result.current.reading).toBe(false);
    act(() => result.current.retry()); await flush();
    expect(result.current.error?.kind).toBe("missing"); await advance(5000);
    expect(getAnalysis).toHaveBeenCalledTimes(2);
  });

  it("rejects a mismatched response and cleans up Strict Mode reads/timers", async () => {
    const old = deferred<Job>();
    getAnalysis.mockReturnValueOnce(old.promise).mockResolvedValue(job("wrong"));
    const { result, unmount } = renderHook(() => useAnalysisJob("strict"), { wrapper: StrictMode });
    await flush();
    // Strict Mode cleans up before the first getClient continuation starts a GET.
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    act(() => result.current.retry()); await flush();
    await act(async () => old.resolve(job("strict")));
    expect(result.current.error?.message).toMatch(/did not match/);
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});
