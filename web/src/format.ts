import type { Cell, Feature } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "Insufficient data";
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

/** A null cell is "Insufficient data". A numeric 0 stays 0. */
export function formatCell(cell: Cell | null | undefined, unit: string): string {
  if (!cell || cell.value === null) return "Insufficient data";
  const n = formatNumber(cell.value);
  if (unit.startsWith("%")) return `${n}%`;
  if (unit === "seconds") return `${n} seconds`;
  return `${n} ${unit}`;
}

export function countPhrase(cell: Cell, feature: Pick<Feature, "unit" | "count_unit">): string | null {
  if (cell.value === null) return null;
  if (feature.unit === feature.count_unit && cell.value === cell.count) return null;
  return `based on ${formatNumber(cell.count)} ${feature.count_unit}`;
}

export function formatCellLine(cell: Cell, feature: Pick<Feature, "unit" | "count_unit">): string {
  const value = formatCell(cell, feature.unit);
  const count = countPhrase(cell, feature);
  return count ? `${value}, ${count}` : value;
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "Insufficient data";
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : iso;
}

export function formatTimestamp(iso: string): string {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : iso;
}

export function shortDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1] ?? match[2];
  return `${month} ${Number(match[3])}`;
}

export function numericDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  return `${Number(match[2])}/${Number(match[3])}`;
}

export function speakerLabel(speaker: string): string {
  if (speaker === "me") return "Me";
  if (speaker === "other") return "Other person";
  return speaker;
}

export const CHART_ORDER = [
  "absolutist_pct",
  "i_pct",
  "we_pct",
  "initiation_pct",
  "reply_latency_median_s",
  "avg_words_per_message",
  "late_night_episodes",
  "message_count",
  "double_text_pct",
] as const;

export function orderedSeries<T extends { key: string }>(series: T[]): T[] {
  const rank = (key: string) => {
    const index = CHART_ORDER.indexOf(key as (typeof CHART_ORDER)[number]);
    return index === -1 ? CHART_ORDER.length : index;
  };
  return [...series].sort((a, b) => rank(a.key) - rank(b.key));
}

export function modeLabel(mode: string): string {
  if (mode === "deterministic_only") return "Deterministic only";
  if (mode === "full") return "Opted in";
  return mode;
}

export function dateOrderError(from: string, to: string): string | null {
  if (from && to && from > to) return "The start date is after the end date.";
  return null;
}
