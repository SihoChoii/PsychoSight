import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearActiveJob, isSelection, readRunContext, rememberRunContext } from "./run-context";

const selection = { conversationId: "conversation", label: "Alex", isDemo: true, dateFrom: "2024-02-29", dateTo: "2025-01-01" };
const job = { job_id: "returned-id", conversation_id: "conversation" };
const key = "psychosight-run-context:returned-id";
beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

describe("optional run metadata", () => {
  it("stores versioned whitelisted metadata keyed to returned ID without replacing older keys", () => {
    sessionStorage.setItem("psychosight-selection", JSON.stringify(selection));
    sessionStorage.setItem("psychosight-theme", "white");
    rememberRunContext(job.job_id, { ...selection, unexpected: "private body" } as typeof selection);
    expect(readRunContext(job)).toEqual({ ...selection, jobId: job.job_id, version: 1 });
    expect(sessionStorage.getItem(key)).not.toContain("private body");
    expect(sessionStorage.getItem("psychosight-selection")).toBe(JSON.stringify(selection));
    expect(sessionStorage.getItem("psychosight-theme")).toBe("white");
  });
  it("returns a neutral fallback for deep links, wrong job or conversation", () => {
    expect(readRunContext(job)).toBeNull(); rememberRunContext(job.job_id, selection);
    expect(readRunContext({ ...job, job_id: "different" })).toBeNull();
    expect(readRunContext({ ...job, conversation_id: "different" })).toBeNull();
  });
  it.each(["broken", "null", "[]", '{"version":2}', JSON.stringify({ ...selection, jobId: "wrong", version: 1 }),
    JSON.stringify({ ...selection, dateFrom: "2025-02-30", jobId: job.job_id, version: 1 }),
    JSON.stringify({ ...selection, isDemo: "yes", jobId: job.job_id, version: 1 })])("rejects malformed/unsupported context %s", (value) => {
      sessionStorage.setItem(key, value); expect(readRunContext(job)).toBeNull();
    });
  it.each([{ ...selection, dateFrom: "2025-02-29" }, { ...selection, dateTo: "2020-01-01" }, { ...selection, label: "" },
    { ...selection, dateFrom: 42 }, { ...selection, conversationId: null }])("validates selection %j", (value) => expect(isSelection(value)).toBe(false));
  it("tolerates unavailable storage for reads, writes, and terminal cleanup", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("disabled"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => rememberRunContext(job.job_id, selection)).not.toThrow();
    expect(readRunContext(job)).toBeNull(); expect(() => clearActiveJob(job.job_id)).not.toThrow();
  });
});
