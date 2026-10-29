/** Synthetic UI stress cases. Canonical backend samples are never mutated. */
import fullSample from "../../../docs/sample_report.json";
import localSample from "../../../docs/sample_report_deterministic_only.json";
import mockConfig from "./mock-config.json";
import type { Cell, Episode, Feature, Job, Report, Week } from "../types";

export type PreviewReport = Report;

export const UI_REPORT_CASES = [
  "zero", "null", "thin", "single-week", "omitted-weeks", "long-labels",
  "104-weeks", "260-weeks", "absent-episodes", "pooled-selected", "provider-note", "episode-overlaps", "episode-dense", "evidence-states", "evidence-long", "evidence-failed",
] as const;
export type UiReportCase = (typeof UI_REPORT_CASES)[number];

const DAY = 86_400_000;
const START = Date.UTC(2025, 7, 4); // Monday; use UTC calendar arithmetic across DST/year boundaries.
const day = (offset: number) => new Date(START + offset * DAY).toISOString().slice(0, 10);

function weekKey(monday: string): string {
  const thursday = new Date(`${monday}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function cell(value: number, count: number, enough: boolean): Cell {
  return enough ? { value, count } : { value: null, count, reason: "insufficient data" };
}

function featureCell(key: string, weeks: Week[], who: "me" | "other", zero: boolean): Cell {
  const messages = weeks.reduce((n, w) => n + w.messages[who], 0);
  const words = weeks.reduce((n, w) => n + w.words[who], 0);
  const episodes = weeks.reduce((n, w) => n + w.episodes, 0);
  const opened = weeks.reduce((n, w) => n + (who === "me" ? Math.ceil(w.episodes / 2) : Math.floor(w.episodes / 2)), 0);
  const replies = messages - opened;
  switch (key) {
    case "message_count": return { value: messages, count: messages };
    case "avg_words_per_message": return cell(words / messages, words, words >= 300);
    case "absolutist_pct": return cell(zero ? 0 : who === "me" ? 1 : 0, words, words >= 300);
    case "i_pct": return cell(zero ? 0 : who === "me" ? 2 : 1.25, words, words >= 300);
    case "we_pct": return cell(zero ? 0 : who === "me" ? 1 : 1.25, words, words >= 300);
    case "initiation_pct": return cell(Math.round(1000 * opened / episodes) / 10, opened, episodes >= 3);
    case "reply_latency_median_s": return cell(who === "me" ? 90 : 120, replies, replies >= 3);
    case "double_text_pct": return cell(0, messages, messages >= 10);
    case "late_night_episodes": return { value: 0, count: opened };
    default: throw new Error(`Unknown fixture feature: ${key}`);
  }
}

function timeline(caseName: UiReportCase): PreviewReport {
  const report = structuredClone(localSample) as unknown as PreviewReport;
  const thin = caseName === "thin" || caseName === "null";
  const length = caseName === "104-weeks" ? 104 : caseName === "260-weeks" ? 260
    : caseName === "single-week" || caseName === "thin" || caseName.startsWith("episode-") ? 1 : 4;
  const offsets = caseName === "omitted-weeks" ? [0, 1, 4, 6] : Array.from({ length }, (_, i) => i);
  report.weeks = offsets.map((i) => {
    const episodes = thin ? 1 : 6 + i % 3;
    const start_date = day(i * 7);
    return {
      week: weekKey(start_date), start_date, end_date: day(i * 7 + 6), episodes,
      messages: { me: episodes * 2, other: episodes * 2 },
      words: { me: episodes * (thin ? 20 : 100), other: episodes * (thin ? 20 : 80) },
    };
  });
  report.episodes = report.weeks.flatMap((week, i) => Array.from({ length: week.episodes }, (_, j): Episode => {
    const start = `${day(offsets[i] * 7 + Math.floor(j / 4))}T${String(9 + j % 4 * 2).padStart(2, "0")}`;
    return {
      episode_id: `ui-${i + 1}-${j + 1}`, start: `${start}:00:00+00:00`, end: `${start}:10:00+00:00`,
      week: week.week, initiator: j % 2 === 0 ? "me" : "other",
      messages: { me: 2, other: 2 }, words: { me: thin ? 20 : 100, other: thin ? 20 : 80 },
      late_night_start: false, pooled: thin, scored: false, selection: null,
    };
  }));
  if (caseName === "episode-overlaps" || caseName === "episode-dense") {
    const base = report.episodes[0];
    report.episodes = Array.from({ length: caseName === "episode-dense" ? 96 : 3 }, (_, i): Episode => {
      const start = Date.parse("2025-08-04T08:00:00Z") + i * 60_000;
      return { ...base, episode_id: `interval-${i + 1}`, initiator: i % 2 ? "other" : "me",
        start: i === 0 ? "2025-08-04T01:00:00-07:00" : new Date(start).toISOString(),
        end: i === 0 ? "2025-08-04T02:00:00-07:00" : new Date(start + (i === 2 ? 0 : 180_000)).toISOString(),
        words: i === 0 ? { me: 20, other: 20 } : base.words,
        pooled: i === 0, late_night_start: i === 0, scored: i < 2, selection: i === 0 ? "random" : i === 1 ? "top_signal" : null };
    });
    const sumEpisodes = (key: "messages" | "words", speaker: "me" | "other") => report.episodes?.reduce((sum, episode) => sum + episode[key][speaker], 0) ?? 0;
    report.weeks[0] = { ...report.weeks[0], episodes: report.episodes.length,
      messages: { me: sumEpisodes("messages", "me"), other: sumEpisodes("messages", "other") },
      words: { me: sumEpisodes("words", "me"), other: sumEpisodes("words", "other") } };
  }
  report.series = report.series.map((feature): Feature => ({
    ...feature,
    overall: {
      me: featureCell(feature.key, report.weeks, "me", caseName === "zero"),
      other: featureCell(feature.key, report.weeks, "other", caseName === "zero"),
    },
    points: report.weeks.filter((_, i) => !(caseName === "omitted-weeks" && feature.key === "i_pct" && i === 1))
      .map((week) => ({ week: week.week,
        me: featureCell(feature.key, [week], "me", caseName === "zero"),
        other: featureCell(feature.key, [week], "other", caseName === "zero"),
      })),
  }));
  const sum = (key: "messages" | "words", who: "me" | "other") => report.weeks.reduce((n, w) => n + w[key][who], 0);
  report.header = {
    ...report.header, date_from: report.weeks[0].start_date, date_to: report.weeks.at(-1)?.end_date ?? null,
    timezone: "UTC", requested_range: { date_from: null, date_to: null },
    message_counts: { me: sum("messages", "me"), other: sum("messages", "other") },
    word_counts: { me: sum("words", "me"), other: sum("words", "other") },
    episode_count: report.episodes.length, episodes_scored: report.episodes.filter((episode) => episode.scored).length, week_count: report.weeks.length,
  };
  if (caseName.startsWith("episode-")) { report.mode = "full"; report.run_meta.mode = "full"; report.run_meta.llm_opt_in = true; }
  if (caseName.startsWith("episode-")) {
    report.rubric.reason = "Synthetic selection-metadata preview; no model results supplied.";
    report.observations.reason = "Synthetic selection-metadata preview; no model results supplied.";
    for (const feature of report.series) if (feature.key === "late_night_episodes") {
      feature.overall.me.value = 1;
      feature.points[0].me.value = 1;
    }
  }
  const finished = new Date(`${report.header.date_to}T00:00:00Z`).getTime() + DAY;
  report.run_meta.created_at = new Date(finished).toISOString();
  Object.assign(report.run_meta, { finished_at: report.run_meta.created_at, duration_s: 0 });
  // Local sections contain no model output, evidence references, or stale sample-week rows.
  report.rubric.items = report.rubric.items.map((item) => ({ ...item, by_week: [] }));
  if (caseName === "long-labels") {
    report.series[0].label = "Messages exchanged across a conversation with a deliberately long descriptive label";
    report.series[0].description += " Synthetic preview for wrapping descriptions at narrow widths without truncating meaningful text.";
  }
  return report;
}

/** `ui-*` IDs resolve without selection/session state, API calls, or elapsed time. */
export function uiPreviewReport(jobId: string): PreviewReport | null {
  const name = jobId.replace(/^ui-/, "");
  if (!jobId.startsWith("ui-") || !UI_REPORT_CASES.some((item) => item === name)) return null;
  const caseName = name as UiReportCase;
  const full = caseName === "pooled-selected" || caseName === "provider-note" || caseName.startsWith("evidence-");
  const report = full ? structuredClone(fullSample) as unknown as PreviewReport : timeline(caseName);
  if (caseName === "absent-episodes") delete report.episodes; // Intentional legacy/partial-response robustness case.
  if (caseName === "provider-note") {
    report.run_meta.provider = "mock";
    report.run_meta.model = "offline-mock";
    report.run_meta.provider_note = mockConfig.demo_provider_note;
    Object.assign(report.run_meta, { cache_hits: 0, cache_misses: 0, llm_calls: 0, llm_retries: 0 });
  }
  if (caseName === "evidence-states") {
    report.rubric.items = report.rubric.items.map((item, i) => ({ ...item,
      status: ["unstable", "insufficient_data", "not_run", "failed", "ok", "ok"][i],
      mean: i === 5 ? 4.123456789 : null,
      n_scored: [2, 2, 0, 0, 0, item.n_scored][i],
      n_null: [0, 38, 0, 0, 40, item.n_null][i],
      n_unstable_pairs: [38, 0, 0, 0, 0, item.n_unstable_pairs][i],
      agreement_rate: i === 0 ? 0.05 : i === 1 || i === 5 ? 1 : null,
      by_week: [],
      quote_ids: i === 2 || i === 3 ? [] : item.quote_ids,
      reason: i === 0 ? "Synthetic preview: repeated ratings did not agree." : i === 2 ? "Synthetic preview: scoring skipped." : i === 3 ? "Synthetic preview: provider failed." : null,
    }));
    report.observations.items = report.observations.items.map((item, i) => ({ ...item, text: `Synthetic evidence-state preview, supplied observation ${i + 1}.` }));
  }
  if (caseName === "evidence-long") {
    const first = report.quotes[0];
    first.text = "  Verbatim synthetic preview: preserve spaces, punctuation, and the line break.\n" + "unbrokentext".repeat(24) + "  ";
    report.rubric.items[0].label = "Acknowledging the other person's stated feelings with a deliberately long synthetic label for narrow-layout review";
    report.observations.note = "Synthetic preview: evidence counts and supporting episode counts are separate supplied fields.";
    report.observations.items = report.observations.items.map((item, i) => ({ ...item,
      text: `Synthetic long-content observation ${i + 1}. This supplied text tests the reading width and wrapping beside exact verbatim evidence. `.repeat(3),
      quotes: item.quotes.map((quote) => quote.quote_id === first.quote_id ? { ...first } : quote),
    }));
    report.observations.items[0].item_keys.push("absent-item");
    report.observations.items[0].feature_keys.push("absent-feature");
    report.observations.items[0].episode_ids.push("absent-episode");
    report.rubric.items[0].quote_ids.push("absent-quote");
  }
  if (caseName === "evidence-failed") {
    report.rubric = { ...report.rubric, status: "failed", reason: "Synthetic preview: rubric scoring failed.", items: [] };
    report.observations = { ...report.observations, status: "failed", reason: "Synthetic preview: observation synthesis failed.", items: [] };
  }
  report.report_id = jobId;
  report.run_meta.run_id = jobId;
  report.header.conversation_id = "demo";
  report.header.conversation_label = caseName === "long-labels"
    ? "Synthetic conversation with an exceptionally long label for checking responsive report headings and metadata wrapping"
    : `UI preview: ${caseName} (synthetic)`;
  report.header.is_demo = true;
  return report;
}

export const PROGRESS_CASES: Record<string, Partial<Pick<Job, "status" | "stage" | "mode" | "progress" | "error">>> = {
  queued: { status: "queued", stage: "loading", progress: { current: 0, total: 0 } },
  loading: { stage: "loading", progress: { current: 0, total: 1 } },
  sessionizing: { stage: "sessionizing", progress: { current: 0, total: 1 } },
  features: { stage: "features", progress: { current: 0, total: 1 } },
  scoring: {},
  "scoring-zero": { progress: { current: 0, total: 40 } },
  "scoring-one": { progress: { current: 0, total: 1 } },
  "scoring-one-done": { progress: { current: 1, total: 1 } },
  "scoring-complete": { progress: { current: 40, total: 40 } },
  "scoring-unknown": { progress: { current: 0, total: 0 } },
  synthesis: { stage: "synthesis", progress: { current: 0, total: 1 } },
  experimental: { stage: "experimental", progress: { current: 4, total: 8 } },
  "experimental-zero": { stage: "experimental", progress: { current: 0, total: 8 } },
  "experimental-one": { stage: "experimental", progress: { current: 0, total: 1 } },
  "experimental-complete": { stage: "experimental", progress: { current: 8, total: 8 } },
  "experimental-unknown": { stage: "experimental", progress: { current: 0, total: 0 } },
  "local-experimental": { mode: "deterministic_only", stage: "experimental", progress: { current: 4, total: 8 } },
  "unknown-stage": { stage: "future-stage", progress: { current: 0, total: 0 } },
  error: { status: "error", error: { code: "LLM_UNAVAILABLE", message: "Synthetic preview: provider unavailable." } },
  "local-error": { status: "error", mode: "deterministic_only", stage: "features", error: { code: "INTERNAL_ERROR", message: "Synthetic preview: feature extraction failed." } },
  done: { status: "done", stage: "done", progress: { current: 1, total: 1 } },
  "local-done": { status: "done", stage: "done", mode: "deterministic_only", progress: { current: 1, total: 1 } },
};

export function uiPreviewJob(caseName: string): Job {
  return structuredClone({
    job_id: "preview", status: "running", stage: "scoring", progress: { current: 12, total: 40 },
    mode: "full", conversation_id: "demo", created_at: "2025-11-16T06:10:00.000Z", error: null,
    ...(PROGRESS_CASES[caseName] ?? PROGRESS_CASES.scoring),
  });
}
