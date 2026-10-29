import { describe, expect, it } from "vitest";
import { chartGeometry, lineSegments, segmentPath } from "./geometry";
import type { ChartRow } from "./models";
import type { MetricDomain } from "./scales";

const domain: MetricDomain = { min: 0, max: 10, ticks: [0, 5, 10], policy: "metric" };
const row = (key: string, day: number, value: number | null | undefined): ChartRow => ({
  week: { key, day, startDate: new Date(day * 86_400_000).toISOString().slice(0, 10), endDate: "1970-01-31" },
  me: value === undefined ? undefined : { value, count: 3 }, other: { value: 0, count: 3 },
});
const rows = [row("a", 4, 0), row("b", 11, 5), row("c", 18, 10)];

describe("shared chart geometry", () => {
  it("places marks, ticks, zero and upper bound on one coordinate system", () => {
    const g = chartGeometry(rows, domain, 300);
    expect([g.left, g.right, g.top, g.bottom]).toEqual([40, 288, 12, 192]);
    expect(rows.map((r) => g.x(r.week.day))).toEqual([40, 164, 288]);
    expect([g.y(0), g.y(5), g.y(10)]).toEqual([192, 102, 12]);
    expect(g.yTicks).toEqual([{ value: 0, y: 192, label: "0" }, { value: 5, y: 102, label: "5" }, { value: 10, y: 12, label: "10" }]);
    expect(g.xTicks.map((t) => [t.key, t.x])).toEqual([["a", 40], ["b", 164], ["c", 288]]);
    expect(segmentPath(rows, "me", g)).toBe("M40.00 192.00 L164.00 102.00 L288.00 12.00");
  });

  it("hit-tests all positions, boundaries, ties and positions outside the plot", () => {
    const g = chartGeometry(rows, domain, 300);
    expect([-20, 40, 102, 103, 164, 226, 227, 288, 400].map(g.hitTest)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    expect(chartGeometry([], domain, 300).hitTest(50)).toBeNull();
  });

  it("breaks on omitted weeks, null cells and nonconsecutive calendar days", () => {
    const data = [row("a", 4, 1), row("b", 11, 0), row("c", 18, null), row("d", 25, 3),
      row("e", 32, undefined), row("f", 39, 4), row("g", 53, 5)];
    expect(lineSegments(data, "me").map((segment) => segment.map((r) => r.week.key))).toEqual([["a", "b"], ["d"], ["f"], ["g"]]);
    expect(lineSegments(data, "other").map((segment) => segment.map((r) => r.week.key))).toEqual([["a", "b", "c", "d", "e", "f"], ["g"]]);
  });

  it("centers a single point and preserves calendar gaps instead of index spacing", () => {
    expect(chartGeometry([rows[0]], domain, 300).x(4)).toBe(164);
    const sparse = chartGeometry([rows[0], rows[1], row("late", 46, 3)], domain, 300);
    expect(sparse.x(11)).toBeCloseTo(81.3333333333);
    expect(sparse.hitTest(sparse.x(11))).toBe(1);
  });

  it("reduces dense ticks by width while retaining endpoints and every hit target", () => {
    const dense = Array.from({ length: 260 }, (_, i) => row(String(i), 4 + i * 7, i % 10));
    const narrow = chartGeometry(dense, domain, 280), desktop = chartGeometry(dense, domain, 1200);
    expect(narrow.xTicks.map((t) => t.key)).toEqual(["0", "130", "259"]);
    expect(desktop.xTicks[0].key).toBe("0");
    expect(desktop.xTicks.at(-1)?.key).toBe("259");
    expect(desktop.xTicks.length).toBeGreaterThan(narrow.xTicks.length);
    expect(desktop.xTicks.every((tick, i, ticks) => i === 0 || tick.x - ticks[i - 1].x >= 76)).toBe(true);
    for (let i = 0; i < 260; i++) expect(narrow.hitTest(narrow.x(4 + i * 7))).toBe(i);
  });
});
