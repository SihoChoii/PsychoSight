import type { KeyboardEvent } from "react";
import type { TimelineWeek } from "./timeline";

export type DisplayWindow = "all" | "52" | "13";

/** Calendar windows always end at the last report week, including unknown intervals. */
export function windowWeeks(weeks: TimelineWeek[], window: DisplayWindow): TimelineWeek[] {
  if (window === "all" || !weeks.length) return weeks;
  const firstDay = weeks[weeks.length - 1].day - (Number(window) - 1) * 7;
  return weeks.filter((week) => week.day >= firstDay);
}

export function nextWeekKey(weeks: TimelineWeek[], indexByKey: ReadonlyMap<string, number>, selected: string | null, key: string): string | null | undefined {
  if (key === "Escape") return null;
  if (!weeks.length) return undefined;
  const index = selected === null ? undefined : indexByKey.get(selected);
  if (key === "Home") return weeks[0].key;
  if (key === "End") return weeks[weeks.length - 1].key;
  if (key === "ArrowRight") return weeks[Math.min(weeks.length - 1, (index ?? -1) + 1)].key;
  if (key === "ArrowLeft") return weeks[Math.max(0, (index ?? weeks.length) - 1)].key;
  return undefined;
}

export interface ChartInspection {
  selectedKey: string | null;
  pinnedKey: string | null;
  preview: (key: string | null) => void;
  pin: (key: string | null) => void;
  keyDown: (event: KeyboardEvent<SVGSVGElement | HTMLDivElement>) => void;
}
