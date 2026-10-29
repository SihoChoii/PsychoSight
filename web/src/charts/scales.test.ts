import { describe, expect, it } from "vitest";
import { buildDomains } from "./scales";
import { buildReportCharts } from "./models";
import type { Feature } from "../types";

function feature(key: string, values: (number | null)[], overall = 9999): Feature {
  return { key, label: key, description: "test", unit: "test units", count_unit: "test basis", approximate: false, min_count: null,
    overall: { me: { value: overall, count: 50 }, other: { value: overall, count: 50 } },
    points: values.map((value, i) => ({ week: `2025-W${String(32 + i).padStart(2, "0")}`, me: { value, count: 20 }, other: { value, count: 20 } })),
  };
}

describe("full-report metric domains", () => {
  it("fixes both participation metrics at 0–100, even zero/null", () => {
    const domains = buildDomains([feature("initiation_pct", [null, 2]), feature("double_text_pct", [0])]);
    expect(domains.get("initiation_pct")).toEqual({ min: 0, max: 100, ticks: [0, 50, 100], policy: "participation" });
    expect(domains.get("double_text_pct")).toEqual({ min: 0, max: 100, ticks: [0, 50, 100], policy: "participation" });
  });

  it("shares one rounded, bounded word-rate domain from all weekly values", () => {
    const domains = buildDomains([feature("absolutist_pct", [1.2, 0]), feature("i_pct", [7.51, 6]), feature("we_pct", [1.3])]);
    for (const key of ["absolutist_pct", "i_pct", "we_pct"]) expect(domains.get(key)).toEqual({ min: 0, max: 10, ticks: [0, 5, 10], policy: "word-rate" });
    expect(buildDomains([feature("i_pct", [91])]).get("i_pct")?.max).toBe(100);
    expect(buildDomains([feature("i_pct", [0]), feature("we_pct", [null])]).get("we_pct")?.max).toBe(1);
    expect(buildDomains([feature("i_pct", [0.03])]).get("i_pct")?.max).toBe(0.05);
  });

  it("keeps separate zero-based length/count/seconds domains and ignores overall totals", () => {
    const domains = buildDomains([feature("message_count", [78, 123]), feature("avg_words_per_message", [6.03, 7.1]),
      feature("reply_latency_median_s", [102, 237]), feature("late_night_episodes", [0, 1])]);
    expect(domains.get("message_count")).toEqual({ min: 0, max: 200, ticks: [0, 100, 200], policy: "metric" });
    expect(domains.get("avg_words_per_message")?.max).toBe(10);
    expect(domains.get("reply_latency_median_s")?.max).toBe(500);
    expect(domains.get("late_night_episodes")).toEqual({ min: 0, max: 1, ticks: [0, 1], policy: "metric" });
    expect(buildDomains([feature("message_count", [0, null])]).get("message_count")?.max).toBe(1);
  });

  it("labels unknown domains and includes negative, zero and positive data", () => {
    expect(buildDomains([feature("future", [-3, 7])]).get("future")).toEqual({ min: -5, max: 10, ticks: [-5, 0, 2.5, 10], policy: "observed" });
    expect(buildDomains([feature("future", [-3, -1])]).get("future")).toEqual({ min: -5, max: 0, ticks: [-5, -2.5, 0], policy: "observed" });
  });

  it("indexes once, preserves exact cells and missing weeks, appends unknown features", () => {
    const item = feature("i_pct", [1.234567, null, 8]);
    item.points = [item.points[2], item.points[0]];
    const input = { weeks: [], series: [feature("future", [-3]), item, feature("message_count", [0])] };
    const before = JSON.stringify(input);
    const model = buildReportCharts(input);
    expect(model.features.map((f) => f.feature.key)).toEqual(["i_pct", "message_count", "future"]);
    const chart = model.features[0];
    expect(chart.rows.map((r) => r.week.key)).toEqual(["2025-W32", "2025-W33", "2025-W34"]);
    expect(chart.byWeek.get("2025-W32")?.me).toBe(item.points[1].me);
    expect(chart.byWeek.get("2025-W33")?.me).toBeUndefined();
    expect(chart.byWeek.get("2025-W34")?.me?.value).toBe(8);
    expect(chart.domain.max).toBe(10);
    // A displayed window/selection uses the same precomputed domain; never recompute it from its rows.
    const latest = { ...chart, rows: chart.rows.slice(-1) };
    expect(latest.domain).toBe(chart.domain);
    expect(latest.domain.max).toBe(10);
    expect(JSON.stringify(input)).toBe(before);
  });
});
