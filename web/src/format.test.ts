import { describe, expect, it } from "vitest";
import { countPhrase, formatAxis, formatCalendarDay, formatCell, formatCellLine, orderedSeries } from "./format";
import { progressText, stageMark } from "./stages";

describe("formatCalendarDay", () => {
  it("formats a YYYY-MM-DD local date without shifting the day", () => {
    expect(formatCalendarDay("2025-08-04")).toBe("Aug 4, 2025");
    expect(formatCalendarDay("2026-02-01")).toBe("Feb 1, 2026");
    expect(formatCalendarDay("2025-03-03")).toBe("Mar 3, 2025");
    expect(formatCalendarDay(null)).toBeNull();
    expect(formatCalendarDay("2025-08-04T20:29:09-07:00")).toBeNull();
  });
});

describe("formatCell", () => {
  it("renders null as Insufficient data and keeps a real zero", () => {
    expect(formatCell({ value: null, count: 0, reason: "insufficient data" }, "% of episodes")).toBe(
      "Insufficient data",
    );
    expect(formatCell({ value: 0, count: 21 }, "episodes")).toBe("0 episodes");
    expect(formatCell({ value: 2.78, count: 3130 }, "% of words")).toBe("2.78% of words");
    expect(formatCell({ value: 139, count: 291 }, "seconds")).toBe("139 seconds");
  });

  it("omits a repeated count and keeps a distinct one", () => {
    expect(countPhrase({ value: 316, count: 316 }, { key: "message_count", unit: "messages", count_unit: "messages" })).toBeNull();
    expect(countPhrase({ value: 2.78, count: 3130 }, { key: "absolutist_pct", unit: "% of words", count_unit: "words" })).toBe(
      "based on 3130 words",
    );
    expect(countPhrase({ value: null, count: 10, reason: "insufficient data" }, { key: "avg_words_per_message", unit: "words", count_unit: "words" })).toBe("word basis: 10 words");
  });

  it("preserves exact supplied values and meaningful units", () => {
    expect(formatCell({ value: 1.234567, count: 600 }, "% of words")).toBe("1.234567% of words");
    expect(formatCell({ value: 0, count: 12 }, "% of turns")).toBe("0% of turns");
    expect(formatCell({ value: 90.5, count: 4 }, "seconds")).toBe("90.5 seconds");
    expect(formatAxis(0.00002, "% of words")).toBe("2.0e-5%");
    expect(formatAxis(200000, "messages")).toBe("2.0e+5");
  });

  it("distinguishes initiation numerator and late-night basis from denominators", () => {
    const initiation = { key: "initiation_pct", unit: "% of episodes", count_unit: "episodes" };
    expect(formatCellLine({ value: 85.7, count: 6 }, initiation, 7)).toBe(
      "85.7% of episodes, 6 episodes opened by this speaker; 7 total episodes (percentage denominator)",
    );
    expect(countPhrase({ value: 50, count: 2 }, initiation)).toBe("2 episodes opened by this speaker");
    expect(countPhrase({ value: 1, count: 1 }, { key: "late_night_episodes", unit: "episodes", count_unit: "episodes" })).toBe(
      "basis: 1 episode opened by this speaker",
    );
    expect(countPhrase({ value: 0, count: 104 }, { key: "late_night_episodes", unit: "episodes", count_unit: "episodes" })).toBe(
      "basis: 104 episodes opened by this speaker",
    );
  });

  it("retains null counts/reasons and distinguishes an omitted cell", () => {
    const feature = { key: "reply_latency_median_s", unit: "seconds", count_unit: "replies" };
    expect(formatCellLine({ value: null, count: 2, reason: "insufficient data" }, feature)).toBe(
      "Insufficient data, based on 2 replies; reason: insufficient data",
    );
    expect(formatCellLine(undefined, feature)).toBe("No data supplied for this week; count unavailable.");
    expect(formatCellLine({ value: null, count: 0, reason: "insufficient data" }, { key: "message_count", unit: "messages", count_unit: "messages" })).toBe(
      "Insufficient data, supplied count: 0 messages; reason: insufficient data",
    );
    expect(countPhrase({ value: -2, count: 6 }, { key: "future", unit: "points", count_unit: "samples" })).toBe("supplied count: 6 samples");
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
    expect(text).toBe("12 of 40 episodes.");
    expect(text).not.toMatch(/%/);
  });

  it("marks skipped LLM stages when the run is deterministic only", () => {
    expect(stageMark("deterministic_only", "running", "features", "scoring")).toBe("Not run");
    expect(stageMark("deterministic_only", "done", "done", "synthesis")).toBe("Not run");
    expect(stageMark("deterministic_only", "done", "done", "experimental")).toBe("See report");
    expect(stageMark("deterministic_only", "running", "experimental", "experimental")).toBe("Now");
    expect(stageMark("full", "running", "scoring", "loading")).toBe("Done");
    expect(stageMark("full", "running", "scoring", "scoring")).toBe("Now");
    expect(stageMark("full", "error", "scoring", "scoring")).toBe("Failed");
  });

  it("shows experimental progress as the finished count, not a percentage", () => {
    const text = progressText({ status: "running", stage: "experimental", progress: { current: 4, total: 8 } });
    expect(text).toBe("4 of 8 work units complete.");
    expect(text).not.toMatch(/%/);
    expect(progressText({ status: "running", stage: "experimental", progress: { current: 0, total: 0 } })).toBe(
      "Progress total is unavailable.",
    );
  });
});
