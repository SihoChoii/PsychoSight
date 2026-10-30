import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, httpApi, isAbortError } from "./api";

afterEach(() => vi.unstubAllGlobals());
describe("abortable status GET", () => {
  it("forwards the internal signal without changing the endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"job_id":"a/b"}', { status: 200 }));
    vi.stubGlobal("fetch", fetch); const controller = new AbortController();
    await httpApi.getAnalysis("a/b", controller.signal);
    expect(fetch).toHaveBeenCalledWith("/analyses/a%2Fb", expect.objectContaining({ signal: controller.signal }));
    expect(fetch.mock.calls[0][1].method).toBeUndefined();
  });
  it("preserves AbortError identity from fetch and the response body", async () => {
    const abort = new DOMException("Canceled", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(httpApi.getAnalysis("a")).rejects.toBe(abort);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ text: () => Promise.reject(abort) }));
    await expect(httpApi.getAnalysis("a")).rejects.toBe(abort);
    expect(isAbortError(abort)).toBe(true);
  });
  it("continues to identify transport failures and missing jobs separately", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(httpApi.getAnalysis("a")).rejects.toEqual(new ApiError("INTERNAL_ERROR", "The local API could not be reached.", 0));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":{"code":"NOT_FOUND","message":"gone"}}', { status: 404 })));
    await expect(httpApi.getAnalysis("a")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
