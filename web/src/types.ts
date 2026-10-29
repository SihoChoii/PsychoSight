export interface Cell {
  value: number | null;
  count: number;
  reason?: "insufficient data";
}

export interface Feature {
  key: string;
  label: string;
  unit: string;
  count_unit: string;
  description: string;
  approximate: boolean;
  min_count: number | null;
  overall: { me: Cell; other: Cell };
  points: { week: string; me: Cell; other: Cell }[];
}

export interface Week {
  week: string;
  start_date: string;
  end_date: string;
  episodes: number;
  messages: { me: number; other: number };
  words: { me: number; other: number };
}

export interface Quote {
  quote_id: string;
  episode_id: string;
  speaker: "me" | "other" | string;
  timestamp: string;
  text: string;
  item_key?: string | null;
}

export interface RubricItem {
  key: string;
  label: string;
  description: string;
  anchors: { "1": string; "3": string; "5": string };
  speaker: string;
  status: "ok" | "unstable" | "insufficient_data" | "not_run" | string;
  reason: string | null;
  mean: number | null;
  n_scored: number;
  n_null: number;
  n_unstable_pairs: number;
  agreement_rate: number | null;
  by_week: { week: string; mean: number | null; count: number; reason?: string }[];
  quote_ids: string[];
}

export interface Observation {
  observation_id: string;
  text: string;
  confidence: "low" | "medium" | "high" | string;
  supporting_episodes: number;
  episode_ids: string[];
  item_keys: string[];
  feature_keys: string[];
  quotes: Quote[];
}

export interface Report {
  schema_version: string;
  report_id: string;
  mode: "full" | "deterministic_only" | string;
  header: {
    conversation_id: string;
    conversation_label: string;
    is_demo: boolean;
    date_from: string | null;
    date_to: string | null;
    requested_range?: { date_from: string | null; date_to: string | null };
    timezone: string;
    message_counts: { me: number; other: number };
    word_counts?: { me: number; other: number };
    episode_count: number;
    episodes_scored: number;
    week_count: number;
  };
  weeks: Week[];
  series: Feature[];
  rubric: {
    status: string;
    reason: string | null;
    scored_speaker?: string;
    items: RubricItem[];
  };
  observations: {
    status: string;
    reason: string | null;
    note?: string | null;
    items: Observation[];
  };
  quotes: Quote[];
  limitations_title: string;
  limitations: string[];
  disclaimer: string;
  experimental_scores?: ExperimentalScores;
  run_meta: {
    run_id: string;
    created_at: string;
    mode: string;
    llm_opt_in: boolean;
    source?: string;
    provider: string | null;
    model: string | null;
    timezone?: string;
    experimental_opt_in?: boolean;
    score_other_opt_in?: boolean;
    experimental_scoring_version?: string | null;
    experimental_prompt_versions?: { episode: string; holistic: string } | null;
    experimental_llm_calls?: number;
    experimental_cache_hits?: number;
    provider_note?: string | null;
    date_range_clamped?: DateRangeClamp | null;
  };
}

export type ExpStatus = "ok" | "not_run" | "insufficient_data" | "failed";
export type ExpConfidence = "low" | "medium";
export type ExpFamily = "big_five" | "wellbeing_language" | "interpersonal";
export type ExpEvidence = "moderate" | "small" | "weak" | "very_weak";

export interface ExpCitation {
  short: string;
  doi: string | null;
}

export interface ExpQuote {
  id: string;
  speaker: "me" | "other";
  episode_id: string;
  marker_key: string;
  text: string;
  ts: string;
}

export interface ExpContribution {
  marker_key: string;
  label: string;
  source: "D" | "R" | "H";
  direction: "up" | "down";
  weight: number;
  value: number | null;
  unit: string;
  sub_score: number | null;
  anchor_source: string;
  status: "ok" | "not_run" | "no_data";
  quote_ids: string[];
}

export interface ExpTrendPoint {
  week: string;
  score: number | null;
  n_episodes: number;
  n_words: number;
  reason: string | null;
}

export interface ExpBand {
  lo: number;
  hi: number;
}

export interface ExpSpeakerScore {
  status: ExpStatus;
  reason: string | null;
  score: number | null;
  band: ExpBand | null;
  confidence: ExpConfidence | null;
  n_episodes: number;
  n_words: number;
  contributions: ExpContribution[];
  trend: ExpTrendPoint[];
  quote_ids: string[];
}

export interface ExpDimension {
  key: string;
  label: string;
  family: ExpFamily | string;
  evidence_strength: ExpEvidence | string;
  evidence_note: string;
  citations: ExpCitation[];
  per_speaker: {
    me: ExpSpeakerScore;
    other: ExpSpeakerScore | null;
  };
}

export interface ExperimentalScores {
  status: ExpStatus;
  reason: string | null;
  banner: string;
  title: string;
  scale_note: string;
  footer_support: string;
  how_it_works: string;
  scoring_version: string;
  prompt_versions: { episode: string; holistic: string };
  anchors_version: string;
  speakers_scored: ["me"] | ["me", "other"];
  thresholds: { min_episodes: number; min_words: number; max_confidence: "medium" };
  dimensions: ExpDimension[];
  quotes: ExpQuote[];
}

export interface ExperimentalDimensionConfig {
  key: string;
  label: string;
  family: string;
  evidence_strength: string;
}

export interface Config {
  version: string;
  schema_version: string;
  provider: string;
  model: string | null;
  llm_configured: boolean;
  reasoning_effort: string | null;
  demo_provider: string;
  demo_provider_note?: string | null;
  opt_in_text: string;
  disclaimer: string;
  limitations_title: string;
  max_episodes_scored: number;
  experimental_opt_in_text?: string;
  score_other_opt_in_text?: string;
  experimental_banner?: string;
  experimental_footer_support?: string;
  experimental_scale_note?: string;
  experimental_trend_note?: string;
  experimental_how_it_works?: string;
  experimental_enabled?: boolean;
  experimental_dimensions?: ExperimentalDimensionConfig[];
}

export interface Conversation {
  id: string;
  label: string;
  message_count: number | null;
  latest_date: string | null;
  first_message_at: string | null;
  last_message_at: string | null;
  first_message_date: string | null;
  last_message_date: string | null;
  is_group: boolean;
  supported: boolean;
  is_demo: boolean;
  participant_count: number;
}

export interface DateRangePair {
  date_from: string | null;
  date_to: string | null;
}

export interface DateRangeClamp {
  requested: DateRangePair;
  applied: DateRangePair;
  bounds: DateRangePair;
}

export interface ConversationsResponse {
  conversations: Conversation[];
  chat_db: { available: boolean; error: { code: string; message: string } | null };
}

export interface Job {
  job_id: string;
  status: "queued" | "running" | "done" | "error" | string;
  stage: string;
  progress: { current: number; total: number };
  mode: string;
  conversation_id: string;
  created_at: string;
  error: { code: string; message: string } | null;
}

export interface SavedAnalysis {
  job_id: string;
  conversation_id?: string;
  conversation_label: string;
  mode: string;
  created_at: string;
}

export interface AnalysisRequest {
  conversation_id: string;
  date_from?: string;
  date_to?: string;
  llm_opt_in: boolean;
  demo?: boolean;
  mode?: "full" | "deterministic_only" | null;
  experimental_scores?: boolean;
  score_other?: boolean;
  experimental_opt_in_text?: string;
  score_other_opt_in_text?: string;
}

export interface ExperimentalChoice {
  experimental: boolean;
  scoreOther: boolean;
}
