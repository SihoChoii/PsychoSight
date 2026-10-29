import type { Feature, Week } from "../types";

const DAY_MS = 86_400_000;

/** Supplied calendar dates are coordinates, never instants in the browser's timezone. */
export function calendarDay(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? parsed.getTime() / DAY_MS : null;
}

export function dayString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function isoYearStart(year: number): number {
  const jan4 = new Date(0);
  jan4.setUTCFullYear(year, 0, 4);
  return jan4.getTime() / DAY_MS - (jan4.getUTCDay() + 6) % 7;
}

/** Monday of a real ISO week, including week 53 only in years that have one. */
export function isoWeekDay(key: string): number | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]), week = Number(match[2]);
  const day = isoYearStart(year) + (week - 1) * 7;
  return week >= 1 && day < isoYearStart(year + 1) ? day : null;
}

export function isoWeekKey(day: number): string {
  const date = new Date(day * DAY_MS);
  const thursday = day + 3 - (date.getUTCDay() + 6) % 7;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  return `${String(year).padStart(4, "0")}-W${String(Math.floor((day - isoYearStart(year)) / 7) + 1).padStart(2, "0")}`;
}

export interface TimelineWeek {
  key: string;
  day: number;
  startDate: string;
  endDate: string;
  source?: Week;
}

export interface Timeline {
  weeks: TimelineWeek[];
  byKey: ReadonlyMap<string, TimelineWeek>;
  indexByKey: ReadonlyMap<string, number>;
}

/** Union by key, then fill absent calendar intervals with unknown (never zero) rows. */
export function buildTimeline(weeks: Week[], series: Feature[]): Timeline {
  const known = new Map<string, TimelineWeek>();
  for (const week of weeks) {
    const day = calendarDay(week.start_date) ?? isoWeekDay(week.week);
    if (day !== null) known.set(week.week, {
      key: week.week, day, startDate: dayString(day), endDate: week.end_date, source: week,
    });
  }
  for (const feature of series) for (const point of feature.points) {
    if (known.has(point.week)) continue;
    const day = isoWeekDay(point.week);
    if (day !== null) known.set(point.week, {
      key: point.week, day, startDate: dayString(day), endDate: dayString(day + 6),
    });
  }
  const ordered = [...known.values()].sort((a, b) => a.day - b.day);
  const result: TimelineWeek[] = [];
  for (const week of ordered) {
    const previous = result.at(-1);
    if (previous) for (let day = previous.day + 7; day < week.day; day += 7) {
      const key = isoWeekKey(day);
      if (!known.has(key)) result.push({ key, day, startDate: dayString(day), endDate: dayString(day + 6) });
    }
    result.push(week);
  }
  return {
    weeks: result,
    byKey: new Map(result.map((week) => [week.key, week])),
    indexByKey: new Map(result.map((week, index) => [week.key, index])),
  };
}
