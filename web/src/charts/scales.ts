import type { Feature } from "../types";

const WORD_RATES = new Set(["absolutist_pct", "i_pct", "we_pct"]);
const PARTICIPATION = new Set(["initiation_pct", "double_text_pct"]);
const NONNEGATIVE = new Set(["message_count", "avg_words_per_message", "reply_latency_median_s", "late_night_episodes"]);
const COUNTS = new Set(["message_count", "late_night_episodes"]);

export interface MetricDomain {
  min: number;
  max: number;
  ticks: number[];
  policy: "participation" | "word-rate" | "metric" | "observed";
}

function roundedUpper(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return Number((step * magnitude).toPrecision(12));
}

export function countDomain(maximum: number): MetricDomain {
  const max = roundedUpper(maximum);
  return { min: 0, max, ticks: [...new Set([0, Math.floor(max / 2), max])], policy: "metric" };
}

function extent(feature: Feature): [number, number] {
  let min = 0, max = 0;
  for (const point of feature.points) for (const side of ["me", "other"] as const) {
    const value = point[side].value;
    if (value !== null && Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  }
  return [min, max];
}

/** Full-report weekly observations set scales; overall totals never inflate weekly domains. */
export function buildDomains(series: Feature[]): ReadonlyMap<string, MetricDomain> {
  const extents = new Map(series.map((feature) => [feature.key, extent(feature)]));
  let wordMax = 0;
  for (const key of WORD_RATES) wordMax = Math.max(wordMax, extents.get(key)?.[1] ?? 0);
  const wordUpper = Math.min(100, roundedUpper(wordMax));
  return new Map(series.map((feature) => {
    const [observedMin, observedMax] = extents.get(feature.key) ?? [0, 0];
    const policy = PARTICIPATION.has(feature.key) ? "participation"
      : WORD_RATES.has(feature.key) ? "word-rate" : NONNEGATIVE.has(feature.key) ? "metric" : "observed";
    const min = policy === "observed" && observedMin < 0 ? -roundedUpper(-observedMin) : 0;
    const max = policy === "participation" ? 100 : policy === "word-rate" ? wordUpper
      : observedMax > 0 || min === 0 ? roundedUpper(observedMax) : 0;
    const middle = COUNTS.has(feature.key) ? Math.floor((min + max) / 2) : (min + max) / 2;
    const ticks = [...new Set([min, middle, ...(min < 0 && max > 0 ? [0] : []), max])].sort((a, b) => a - b);
    return [feature.key, { min, max, ticks, policy }];
  }));
}
