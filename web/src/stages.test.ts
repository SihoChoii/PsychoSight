import { describe, expect, it } from "vitest";
import { uiPreviewJob } from "./fixtures/ui-previews";
import { measuredProgress, progressHeading, progressText, STAGE_ORDER, stageMark } from "./stages";

describe("authoritative progress presentation", () => {
  it.each([["scoring-one", "0 of 1 episode.", 0], ["scoring-one-done", "1 of 1 episode.", 100],
    ["experimental-one", "0 of 1 work unit complete.", 0], ["experimental-complete", "8 of 8 work units complete.", 100]])
    ("measures %s as stage progress including one item", (name, text, percent) => {
      const job = uiPreviewJob(name); expect(progressText(job)).toBe(text); expect(measuredProgress(job)?.percent).toBe(percent);
      expect(progressHeading(job)).not.toBe("Report ready");
    });
  it.each(["queued", "loading", "sessionizing", "features", "synthesis", "scoring-unknown", "experimental-unknown", "done", "error", "unknown-stage"])
    ("does not fabricate a measured percentage for %s", (name) => expect(measuredProgress(uiPreviewJob(name))).toBeNull());
  it.each([{ current: NaN, total: 1 }, { current: 0, total: Infinity }, { current: -1, total: 2 }, { current: 2, total: 1 }, { current: 0.5, total: 1 }])
    ("rejects invalid counts %j", (progress) => expect(measuredProgress({ ...uiPreviewJob("scoring"), progress })).toBeNull());
  it("does not infer failure, insufficiency or completion from counters/stage", () => {
    expect(progressText(uiPreviewJob("scoring-unknown"))).toBe("Progress total is unavailable.");
    expect(progressText({ ...uiPreviewJob("done"), status: "running" })).toBe("Waiting for completion status.");
    expect(progressHeading({ ...uiPreviewJob("done"), status: "future" })).toBe("Checking analysis status");
    expect(progressHeading({ ...uiPreviewJob("scoring"), status: "done" })).toBe("Report ready");
  });
  it("does not advance known stages for queued/unknown state or unknown stages", () => {
    expect(stageMark("full", "queued", "done", "loading")).toBe("Queued");
    for (const stage of STAGE_ORDER) {
      expect(stageMark("full", "running", "future", stage)).toBe("Unknown");
      expect(stageMark("full", "future", "done", stage)).toBe("Unknown");
    }
  });
  it("local mode skips scoring/synthesis while experimental remains factual and neutral", () => {
    expect(stageMark("deterministic_only", "running", "experimental", "scoring")).toBe("Not run");
    expect(stageMark("deterministic_only", "running", "experimental", "synthesis")).toBe("Not run");
    expect(stageMark("deterministic_only", "running", "experimental", "experimental")).toBe("Now");
    expect(stageMark("full", "done", "done", "experimental")).toBe("See report");
    expect(stageMark("full", "error", "scoring", "scoring")).toBe("Failed");
    expect(stageMark("full", "error", "scoring", "synthesis")).toBe("Not reached");
  });
});
