import { describe, expect, it } from "vitest";
import { countPhrase, formatCell, orderedSeries } from "./format";
import { progressText, stageMark } from "./stages";

describe("formatCell", () => {
  it("renders null as Insufficient data and keeps a real zero", () => {
    expect(formatCell({ value: null, count: 0, reason: "insufficient data" }, "% of episodes")).toBe(
      "Insufficient data",
    );
    expect(formatCell({ value: 0, count: 21 }, "episodes")).toBe("0 episodes");
    expect(formatCell({ value: 2.78, count: 3130 }, "% of words")).toBe("2.78%");
    expect(formatCell({ value: 139, count: 291 }, "seconds")).toBe("139 seconds");
  });

  it("omits a repeated count and keeps a distinct one", () => {
    expect(countPhrase({ value: 316, count: 316 }, { unit: "messages", count_unit: "messages" })).toBeNull();
    expect(countPhrase({ value: 2.78, count: 3130 }, { unit: "% of words", count_unit: "words" })).toBe(
      "based on 3130 words",
    );
    expect(countPhrase({ value: null, count: 10, reason: "insufficient data" }, { unit: "words", count_unit: "words" })).toBeNull();
  });

  it("orders the requested timelines first", () => {
    expect(orderedSeries([{ key: "message_count" }, { key: "absolutist_pct" }, { key: "we_pct" }]).map((item) => item.key)).toEqual([
      "absolutist_pct",
      "we_pct",
      "message_count",
    ]);
  });
});

describe("progress", () => {
  it("uses the measured episode count and does not invent a percentage", () => {
    const text = progressText({ status: "running", stage: "scoring", progress: { current: 12, total: 40 } });
    expect(text).toBe("Scoring. 12 of 40 episodes.");
    expect(text).not.toMatch(/%/);
  });

  it("marks skipped LLM stages when the run is deterministic only", () => {
    expect(stageMark("deterministic_only", "running", "features", "scoring")).toBe("Not run");
    expect(stageMark("deterministic_only", "done", "done", "synthesis")).toBe("Not run");
    expect(stageMark("deterministic_only", "done", "done", "experimental")).toBe("Done");
    expect(stageMark("deterministic_only", "running", "experimental", "experimental")).toBe("Now");
    expect(stageMark("full", "running", "scoring", "loading")).toBe("Done");
    expect(stageMark("full", "running", "scoring", "scoring")).toBe("Now");
    expect(stageMark("full", "error", "scoring", "scoring")).toBe("Failed");
  });

  it("shows experimental progress as the finished count, not a percentage", () => {
    const text = progressText({ status: "running", stage: "experimental", progress: { current: 4, total: 8 } });
    expect(text).toBe("Experimental scores. 4 of 8.");
    expect(text).not.toMatch(/%/);
    expect(progressText({ status: "running", stage: "experimental", progress: { current: 0, total: 0 } })).toBe(
      "Experimental scores.",
    );
  });
});
