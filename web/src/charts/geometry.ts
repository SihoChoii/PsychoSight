import { formatAxis, shortDate } from "../format";
import type { ChartRow } from "./models";
import type { MetricDomain } from "./scales";

export interface ChartGeometry {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  x: (day: number) => number;
  y: (value: number) => number;
  xTicks: { key: string; x: number; label: string; year: string; anchor: "start" | "middle" | "end" }[];
  yTicks: { value: number; y: number; label: string }[];
  hitTest: (x: number) => number | null;
}

/** CSS-pixel geometry shared by axes, marks, cursor and binary-search hit testing. */
export function chartGeometry(rows: ChartRow[], domain: MetricDomain, width: number, plotLeft?: number, height = 240): ChartGeometry {
  const top = 12, bottom = height - 48;
  const labels = domain.ticks.map((value) => formatAxis(value, ""));
  const left = plotLeft ?? Math.max(40, ...labels.map((label) => label.length * 8.5 + 22));
  const right = width - 12;
  const start = rows[0]?.week.day ?? 0, end = rows.at(-1)?.week.day ?? start;
  const x = (day: number) => start === end ? (left + right) / 2 : left + (day - start) / (end - start) * (right - left);
  const y = (value: number) => bottom - (value - domain.min) / (domain.max - domain.min) * (bottom - top);
  const positions = rows.map((row) => x(row.week.day));
  const count = Math.min(rows.length, 7, Math.max(2, Math.floor((right - left) / 90) + 1));
  const indices: number[] = rows.length ? [0] : [];
  for (let i = 1; i < count - 1; i++) {
    const index = Math.round(i * (rows.length - 1) / (count - 1));
    if (positions[index] - positions[indices[indices.length - 1]] >= 76 && positions[positions.length - 1] - positions[index] >= 76) indices.push(index);
  }
  if (rows.length > 1) indices.push(rows.length - 1);
  const xTicks = indices.map((index) => ({ key: rows[index].week.key, x: positions[index],
    label: shortDate(rows[index].week.startDate), year: rows[index].week.startDate.slice(0, 4),
    anchor: rows.length === 1 ? "middle" as const : index === 0 ? "start" as const : index === rows.length - 1 ? "end" as const : "middle" as const,
  }));
  const hitTest = (position: number): number | null => {
    if (!positions.length) return null;
    let lo = 0, hi = positions.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (positions[mid] < position) lo = mid + 1; else hi = mid;
    }
    return lo > 0 && position - positions[lo - 1] <= positions[lo] - position ? lo - 1 : lo;
  };
  return { width, height, left, right, top, bottom, x, y, xTicks,
    yTicks: domain.ticks.map((value) => ({ value, y: y(value), label: formatAxis(value, "") })), hitTest };
}

/** An isolated observation remains a segment so it receives a visible mark at any density. */
export function lineSegments(rows: ChartRow[], side: "me" | "other"): ChartRow[][] {
  const segments: ChartRow[][] = [];
  let active: ChartRow[] | null = null;
  let previousDay: number | null = null;
  for (const row of rows) {
    const value = row[side]?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) { active = null; previousDay = null; continue; }
    if (!active || previousDay === null || row.week.day - previousDay !== 7) {
      active = []; segments.push(active);
    }
    active.push(row); previousDay = row.week.day;
  }
  return segments;
}

export function segmentPath(segment: ChartRow[], side: "me" | "other", geometry: ChartGeometry): string {
  return segment.map((row, index) => {
    const value = row[side]?.value;
    return typeof value === "number" ? `${index === 0 ? "M" : "L"}${geometry.x(row.week.day).toFixed(2)} ${geometry.y(value).toFixed(2)}` : "";
  }).join(" ");
}
