import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getClient } from "./api";
import { RunScreen } from "./components/RunScreen";
import { uiPreviewJob } from "./fixtures/ui-previews";
import { ACTIVE_JOB_KEY, rememberCompletion, rememberRunContext } from "./run-context";
import type { Job } from "./types";

vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), getClient: vi.fn() }));
const getAnalysis = vi.fn();
let reduced = false;
let media: EventTarget;
let hidden = false;
let nextId = 0;
let id: string;
const running = (): Job => ({ ...uiPreviewJob("scoring"), job_id: id });
const done = (): Job => ({ ...running(), status: "done", stage: "done" });
async function flush() { await act(async () => {}); }
async function advance(time: number) { await act(async () => { await vi.advanceTimersByTimeAsync(time); }); }
function show() { return render(<RunScreen jobId={id} />); }

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.useFakeTimers(); sessionStorage.clear(); reduced = false; hidden = false; media = new EventTarget(); id = `job-${++nextId}`;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ get matches() { return reduced; },
    addEventListener: media.addEventListener.bind(media), removeEventListener: media.removeEventListener.bind(media) })));
  window.history.replaceState(null, "", `/#/run/${id}`);
  getAnalysis.mockReset();
  vi.mocked(getClient).mockResolvedValue({ getAnalysis } as unknown as Awaited<ReturnType<typeof getClient>>);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("report entry", () => {
  it("offers View report immediately then enters at 1.6s, clearing the matching active link", async () => {
    sessionStorage.setItem(ACTIVE_JOB_KEY, id);
    getAnalysis.mockResolvedValueOnce(running()).mockResolvedValue(done());
    show(); await flush(); await advance(500);
    expect(screen.getByRole("link", { name: "View report" })).toHaveAttribute("href", `#/report/${id}`);
    expect(sessionStorage.getItem(ACTIVE_JOB_KEY)).toBeNull();
    await advance(1599); expect(location.hash).toBe(`#/run/${id}`);
    await advance(1); expect(location.hash).toBe(`#/report/${id}`);
    expect(getAnalysis).toHaveBeenCalledTimes(2);
  });
  it.each(["already done", "reduced motion", "revisit"])("enters directly for %s", async (reason) => {
    if (reason === "reduced motion") reduced = true;
    if (reason === "revisit") rememberCompletion(id);
    getAnalysis.mockResolvedValueOnce(reason === "already done" ? done() : running()).mockResolvedValue(done());
    show(); await flush(); if (reason !== "already done") await advance(500);
    expect(location.hash).toBe(`#/report/${id}`);
  });
  it("does not replay the hold after leaving a newly completed job", async () => {
    getAnalysis.mockResolvedValueOnce(running()).mockResolvedValue(done());
    const view = show(); await flush(); await advance(500); view.unmount();
    show(); await flush(); expect(location.hash).toBe(`#/report/${id}`);
  });
  it("keeps completion usable in Strict Mode", async () => {
    getAnalysis.mockResolvedValueOnce(running()).mockResolvedValue(done());
    render(<StrictMode><RunScreen jobId={id} /></StrictMode>); await flush(); await advance(500);
    expect(screen.getByRole("link", { name: "View report" })).toBeVisible();
    expect(location.hash).toBe(`#/run/${id}`); await advance(1600); expect(location.hash).toBe(`#/report/${id}`);
  });
  it("never navigates while hidden and reconciles on visibility return", async () => {
    getAnalysis.mockResolvedValueOnce(running()).mockResolvedValue(done());
    show(); await flush(); await advance(500);
    hidden = true; act(() => document.dispatchEvent(new Event("visibilitychange")));
    await advance(5000); expect(location.hash).toBe(`#/run/${id}`);
    hidden = false; act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(location.hash).toBe(`#/report/${id}`);
  });
  it("preserves the original deadline when visibility returns early and reacts to reduced motion", async () => {
    getAnalysis.mockResolvedValueOnce(running()).mockResolvedValue(done());
    show(); await flush(); await advance(500); await advance(100);
    hidden = true; act(() => document.dispatchEvent(new Event("visibilitychange"))); await advance(200);
    hidden = false; act(() => document.dispatchEvent(new Event("visibilitychange"))); await advance(1299);
    expect(location.hash).toBe(`#/run/${id}`);
    reduced = true; act(() => media.dispatchEvent(new Event("change"))); expect(location.hash).toBe(`#/report/${id}`);
  });
  it("cannot navigate another route even before unmount, including visibility return", async () => {
    getAnalysis.mockResolvedValueOnce(running()).mockResolvedValue(done());
    show(); await flush(); await advance(500);
    window.history.replaceState(null, "", "/#/run/another");
    await advance(1600); act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(location.hash).toBe("#/run/another");
  });
  it("cancels timers on unmount and ID change", async () => {
    getAnalysis.mockResolvedValueOnce(running()).mockResolvedValue(done());
    const view = show(); await flush(); await advance(500);
    const previousId = id; id = "new-job"; getAnalysis.mockReturnValue(new Promise(() => {}));
    window.history.replaceState(null, "", `/#/run/${id}`); view.rerender(<RunScreen jobId={id} />); await flush();
    expect(screen.queryByRole("link", { name: "View report" })).not.toBeInTheDocument();
    await advance(2000); expect(location.hash).toBe(`#/run/${id}`); expect(location.hash).not.toContain(previousId);
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe("progress recovery and context", () => {
  it("retains the last known job on retrieval failure; Retry only reads status", async () => {
    getAnalysis.mockResolvedValueOnce(running()).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(running());
    show(); await flush(); await advance(500);
    expect(screen.getByRole("heading", { name: "Unable to update status" })).toBeInTheDocument();
    expect(screen.getByText(/Last known status: Scoring/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Last known: 12 of 40 episodes.");
    expect(screen.queryByText("The analysis stopped.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); await flush();
    expect(screen.getByRole("heading", { name: "Scoring" })).toBeInTheDocument();
    expect(getAnalysis).toHaveBeenCalledTimes(3);
  });
  it("distinguishes missing analysis from failure, clearing only its active link", async () => {
    sessionStorage.setItem(ACTIVE_JOB_KEY, "another-job");
    getAnalysis.mockRejectedValue(new ApiError("NOT_FOUND", "gone", 404)); show(); await flush();
    expect(screen.getByRole("heading", { name: "Analysis not found" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conversations" })).toBeVisible();
    expect(sessionStorage.getItem(ACTIVE_JOB_KEY)).toBe("another-job");
  });
  it("settles job failure without retry or report navigation", async () => {
    sessionStorage.setItem(ACTIVE_JOB_KEY, id);
    getAnalysis.mockResolvedValue({ ...running(), status: "error", error: { code: "FAIL", message: "Provider unavailable" } });
    show(); await flush(); await advance(5000);
    expect(screen.getByRole("heading", { name: "Analysis stopped" })).toBeInTheDocument();
    expect(screen.getByText(/Provider unavailable/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(); expect(sessionStorage.getItem(ACTIVE_JOB_KEY)).toBeNull();
    expect(location.hash).toBe(`#/run/${id}`);
  });
  it("shows only matching validated context and no unrelated selection", async () => {
    rememberRunContext(id, { conversationId: running().conversation_id, label: "Synthetic Alex", isDemo: true, dateFrom: "2025-08-01", dateTo: "2025-09-01" });
    getAnalysis.mockResolvedValue(running()); show(); await flush();
    expect(screen.getByText(/Synthetic Alex/)).toBeInTheDocument(); expect(screen.getByText(/Requested range: 2025-08-01/)).toBeInTheDocument();
  });
});
