import { describe, expect, it } from "vitest";
import { buildTimeline, calendarDay, dayString, isoWeekDay, isoWeekKey } from "./timeline";
import type { Feature, Week } from "../types";

const week = (key: string, start_date: string): Week => ({ week: key, start_date, end_date: start_date,
  episodes: 2, messages: { me: 1, other: 1 }, words: { me: 100, other: 100 } });
const feature = (keys: string[]) => ({ points: keys.map((key) => ({ week: key })) }) as Feature;
const isoDate = (key: string) => { const day = isoWeekDay(key); return day === null ? null : dayString(day); };

describe("UTC calendar timeline", () => {
  it("validates calendar dates rather than normalizing invalid days", () => {
    expect(calendarDay("1970-01-01")).toBe(0);
    expect(calendarDay("1969-12-31")).toBe(-1);
    expect(calendarDay("2000-02-29")).toBe(11016);
    for (const date of ["2025-02-29", "2025-04-31", "2025-13-01", "2025-03-03T00:00:00Z", "garbage"]) expect(calendarDay(date)).toBeNull();
  });

  it("converts ISO week years, genuine W53, and rejects nonexistent weeks", () => {
    expect(isoDate("2020-W01")).toBe("2019-12-30");
    expect(isoDate("2020-W53")).toBe("2020-12-28");
    expect(isoDate("2021-W01")).toBe("2021-01-04");
    expect(isoDate("2026-W53")).toBe("2026-12-28");
    expect(isoDate("2027-W01")).toBe("2027-01-04");
    for (const key of ["2021-W53", "2025-W00", "2025-W54", "2025-W1", "no week"]) expect(isoWeekDay(key)).toBeNull();
    expect(isoWeekKey(0)).toBe("1970-W01");
    expect(isoWeekKey(4)).toBe("1970-W02");
  });

  it("uses returned dates first and ISO fallback for series-only keys", () => {
    const result = buildTimeline([week("2025-W10", "2025-03-04")], [feature(["2025-W10", "2025-W11"])]);
    expect(result.byKey.get("2025-W10")?.startDate).toBe("2025-03-04");
    expect(result.byKey.get("2025-W11")?.startDate).toBe("2025-03-10");
    expect(result.byKey.get("2025-W11")?.source).toBeUndefined();
    expect(result.indexByKey.get("2025-W11")).toBe(1);
  });

  it("joins unordered keys and fills omitted weeks without making up counts", () => {
    const result = buildTimeline([week("2025-W36", "2025-09-01"), week("2025-W32", "2025-08-04")], [feature(["2025-W33", "2025-W32"])]);
    expect(result.weeks.map((w) => [w.key, w.startDate])).toEqual([
      ["2025-W32", "2025-08-04"], ["2025-W33", "2025-08-11"], ["2025-W34", "2025-08-18"],
      ["2025-W35", "2025-08-25"], ["2025-W36", "2025-09-01"],
    ]);
    expect(result.byKey.get("2025-W34")?.source).toBeUndefined();
    expect(result.byKey.get("2025-W34")?.endDate).toBe("2025-08-24");
  });

  it("keeps exactly seven-day steps through US DST and year boundaries", () => {
    for (const [first, last, expected] of [
      ["2025-W10", "2025-W12", ["2025-03-03", "2025-03-10", "2025-03-17"]],
      ["2025-W43", "2025-W45", ["2025-10-20", "2025-10-27", "2025-11-03"]],
      ["2020-W53", "2021-W02", ["2020-12-28", "2021-01-04", "2021-01-11"]],
    ] as const) {
      const result = buildTimeline([], [feature([first, last])]);
      expect(result.weeks.map((w) => w.startDate)).toEqual(expected);
      expect(result.weeks[1].day - result.weeks[0].day).toBe(7);
      expect(result.weeks[2].day - result.weeks[1].day).toBe(7);
    }
  });

  it("handles empty data and malformed date fallback without NaN", () => {
    expect(buildTimeline([], []).weeks).toEqual([]);
    const result = buildTimeline([week("2025-W01", "invalid")], [feature(["invalid"])]);
    expect(result.weeks.map((w) => w.startDate)).toEqual(["2024-12-30"]);
  });
});
