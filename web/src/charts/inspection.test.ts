import { describe, expect, it } from "vitest";
import { buildTimeline } from "./timeline";
import { nextWeekKey, windowWeeks } from "./inspection";
import type { Feature } from "../types";

const feature = { points: [{ week: "2024-W01" }, { week: "2025-W52" }] } as Feature;
const weeks = buildTimeline([], [feature]).weeks;
const index = new Map(weeks.map((week, i) => [week.key, i]));

describe("report display windows and week navigation", () => {
  it("anchors calendar windows to the final week and retains absent intervals", () => {
    expect(weeks).toHaveLength(104);
    expect(windowWeeks(weeks, "all")).toBe(weeks);
    const year = windowWeeks(weeks, "52"), quarter = windowWeeks(weeks, "13");
    expect(year).toHaveLength(52);
    expect([year[0].startDate, year.at(-1)?.endDate]).toEqual(["2024-12-30", "2025-12-28"]);
    expect(quarter).toHaveLength(13);
    expect([quarter[0].startDate, quarter.at(-1)?.endDate]).toEqual(["2025-09-29", "2025-12-28"]);
    expect(quarter[1].source).toBeUndefined();
  });
  it("handles empty and single-week timelines", () => {
    expect(windowWeeks([], "13")).toEqual([]);
    expect(windowWeeks(weeks.slice(0, 1), "52")).toEqual(weeks.slice(0, 1));
    expect(nextWeekKey([], new Map(), null, "Home")).toBeUndefined();
    expect(nextWeekKey([], new Map(), null, "Escape")).toBeNull();
  });
  it("moves from either end when unselected, clamps and supports Home/End/clear", () => {
    expect(nextWeekKey(weeks, index, null, "ArrowRight")).toBe("2024-W01");
    expect(nextWeekKey(weeks, index, null, "ArrowLeft")).toBe("2025-W52");
    expect(nextWeekKey(weeks, index, "2024-W01", "ArrowLeft")).toBe("2024-W01");
    expect(nextWeekKey(weeks, index, "2025-W52", "ArrowRight")).toBe("2025-W52");
    expect(nextWeekKey(weeks, index, "2025-W52", "Home")).toBe("2024-W01");
    expect(nextWeekKey(weeks, index, "2024-W01", "End")).toBe("2025-W52");
    expect(nextWeekKey(weeks, index, "2024-W01", "Escape")).toBeNull();
    expect(nextWeekKey(weeks, index, null, "Tab")).toBeUndefined();
  });
});
