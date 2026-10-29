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
  run_meta: {
    run_id: string;
    created_at: string;
    mode: string;
    llm_opt_in: boolean;
    source?: string;
    provider: string | null;
    model: string | null;
    timezone?: string;
  };
}

export interface Config {
  version: string;
  schema_version: string;
  provider: string;
  model: string | null;
  llm_configured: boolean;
  reasoning_effort: string | null;
  demo_provider: string;
  opt_in_text: string;
  disclaimer: string;
  limitations_title: string;
  max_episodes_scored: number;
}

export interface Conversation {
  id: string;
  label: string;
  message_count: number;
  latest_date: string | null;
  is_group: boolean;
  supported: boolean;
  is_demo: boolean;
  participant_count: number;
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
}
