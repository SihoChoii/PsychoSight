import type { Cell, Feature } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "Insufficient data";
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

/** Exact supplied values. Only axis labels use rounded/compact notation. */
export function formatCell(cell: Cell | null | undefined, unit: string): string {
  if (!cell || cell.value === null || !Number.isFinite(cell.value)) return "Insufficient data";
  const n = String(cell.value);
  return unit.startsWith("%") ? `${n}${unit}` : `${n} ${unit}`.trim();
}

type CountFeature = Pick<Feature, "key" | "unit" | "count_unit">;

/** Cell.count is not universally a denominator; never derive a percentage from it. */
export function countPhrase(cell: Cell, feature: CountFeature, totalEpisodes?: number): string | null {
  const n = String(cell.count);
  const episodes = cell.count === 1 ? "episode" : "episodes";
  switch (feature.key) {
    case "initiation_pct":
      return `${n} ${episodes} opened by this speaker${totalEpisodes === undefined ? "" : `; ${totalEpisodes} total episodes (percentage denominator)`}`;
    case "late_night_episodes": return `basis: ${n} ${episodes} opened by this speaker`;
    case "message_count":
      return cell.value !== null && cell.value === cell.count ? null : `supplied count: ${n} messages`;
    case "avg_words_per_message": return `word basis: ${n} words`;
    case "absolutist_pct": case "i_pct": case "we_pct":
    case "reply_latency_median_s": case "double_text_pct":
      return `based on ${n} ${feature.count_unit}`;
    default: return `supplied count: ${n} ${feature.count_unit}`;
  }
}

export function formatCellLine(cell: Cell | undefined, feature: CountFeature, totalEpisodes?: number): string {
  if (!cell) return "No data supplied for this week; count unavailable.";
  const value = formatCell(cell, feature.unit);
  const count = countPhrase(cell, feature, totalEpisodes);
  const reason = cell.value === null ? `; reason: ${cell.reason ?? "insufficient data"}` : "";
  return `${value}${count ? `, ${count}` : ""}${reason}`;
}

export function formatAxis(value: number, unit: string): string {
  const abs = Math.abs(value);
  const label = abs >= 100_000 || abs > 0 && abs < 0.001
    ? value.toExponential(1) : String(Number(value.toPrecision(8)));
  return `${label}${unit.startsWith("%") ? "%" : ""}`;
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

/** Local calendar day already provided as YYYY-MM-DD. No timezone conversion. */
export function formatCalendarDay(day: string | null | undefined): string | null {
  if (!day) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return `${month} ${Number(match[3])}, ${match[1]}`;
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
