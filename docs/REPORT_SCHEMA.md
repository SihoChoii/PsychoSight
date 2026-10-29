# Report JSON schema (v1.0.0, with v1.1.0 additions)

Machine-readable schema: [`schemas/report.schema.json`](../schemas/report.schema.json) (JSON Schema draft 2020-12).
Fixtures: [`docs/sample_report.json`](sample_report.json) (full mode, LLM opted in) and
[`docs/sample_report_deterministic_only.json`](sample_report_deterministic_only.json) (no opt-in). Both validate
(`tests/test_schema_sample.py`). Real reports produced by `python -m psychosight analyze --demo` validate too.
The optional experimental section is documented below and illustrated by
[`docs/sample_experimental_scores.json`](sample_experimental_scores.json).

Changes after v1.0.0 are additive only and bump `schema_version`. `1.0.0` reports, which omit `experimental_scores`, still validate and still load from the local store. `config.SCHEMA_VERSION` for newly built reports is `1.1.0`.

## Stance
The report is descriptive: **me vs other** and **week vs week**, always with counts. There are no norms, no
"high/low/above average" labels, no population cutoffs and no verdicts about either person. When evidence is too
thin a value is `null` with `reason: "insufficient data"` (never `0`).

## Top level
| Field | Type | Notes |
|---|---|---|
| `schema_version` | `"1.0.0"` \| `"1.1.0"` | `1.1.0` is this document plus the optional section below. |
| `report_id` | string | Equals the analysis `job_id`. |
| `mode` | `"full"` \| `"deterministic_only"` | `deterministic_only` = user did not opt in; no LLM call was made. Render it as a real result. |
| `header` | object | Conversation label, date range, counts (below). |
| `weeks` | array | ISO weeks in order: `{week:"2025-W39", start_date, end_date, episodes, messages{me,other}, words{me,other}}`. |
| `series` | array | Deterministic features, one entry per feature (below). |
| `episodes` | array | Episode index **without text**: id, start/end, week, initiator, counts, `late_night_start`, `pooled`, `scored`, `selection`. |
| `rubric` | object | LLM rubric means (me side), or `status:"not_run"`. |
| `observations` | object | 0-5 evidence-cited observations, or `status:"not_run"`. |
| `quotes` | array | All verified evidence quotes referenced by rubric items and observations. |
| `limitations_title` | `"What this cannot tell you"` | |
| `limitations` | string[] | Fixed text for the "What this cannot tell you" box. |
| `disclaimer` | `"Experimental self-reflection, not a clinical or diagnostic tool"` | Show it on every report. |
| `run_meta` | object | Model, versions, opt-in flag, cache hits, thresholds. |
| `experimental_scores` | object, optional | Schema 1.1.0 only. Absent on 1.0.0 reports. See below. |

## header
`conversation_id`, `conversation_label`, `is_demo`, `date_from`/`date_to` (local dates actually covered),
`requested_range`, `timezone`, `message_counts{me,other}`, `word_counts{me,other}`, `episode_count`,
`episodes_scored`, `week_count`.

## Cells (null semantics)
Every value in `series` is a cell:
```json
{"value": 1.27, "count": 1187}
{"value": null, "count": 71, "reason": "insufficient data"}
```
`count` is the number of units (`count_unit` on the feature) the value is based on; show it next to the value.

## series[] (feature)
`{key, label, unit, count_unit, description, approximate, min_count, overall{me,other}, points[{week, me, other}]}`

| key | unit | count_unit | null when | notes |
|---|---|---|---|---|
| `message_count` | messages | messages | never | plain count |
| `avg_words_per_message` | words | words | side has < 300 words that week | message length balance |
| `absolutist_pct` | % of words | words | < 300 words | 19-word Al-Mosaiwi & Johnstone list, skips "not/almost/nearly X". Descriptive only, no cutoff. |
| `i_pct` | % of words | words | < 300 words | I, me, my, mine, myself |
| `we_pct` | % of words | words | < 300 words | we, us, our, ours, ourselves |
| `initiation_pct` | % of episodes | episodes | week has < 3 episodes | who opened the episode |
| `reply_latency_median_s` | seconds | replies | < 3 replies by that side | `approximate: true` |
| `double_text_pct` | % of turns | turns | < 10 turns by that side | turns that follow the same side's previous turn with no reply in between |
| `late_night_episodes` | episodes | episodes | never | neutral count of episodes this side opened between 01:00 and 04:00 local; no interpretation |

`points` has one entry per item in `weeks`, in the same order.

## rubric
`{status, reason, scored_speaker:"me", prompt_version, episodes_selected, episodes_scored, agreement_rate, unstable_items[], items[]}`

`status`: `ok` | `not_run` (no opt-in; `reason` says why) | `insufficient_data` | `failed`.
Items describe observable behaviors in **my** messages only (the other person's messages are context):

`{key, label, description, anchors{"1","3","5"}, speaker:"me", status: ok|unstable|insufficient_data, reason, mean (1-5 or null), n_scored, n_null, n_unstable_pairs, agreement_rate, by_week[{week, mean, count, reason?}], quote_ids[]}`

Each episode is scored twice. An (episode, item) pair counts only when both runs agree within 1 point (mean of
the two). An item whose agreement rate is below 0.7 is `unstable`: `mean` is null and it should be hidden or shown
as "not stable enough to report". An item with fewer than 3 agreeing episodes is `insufficient_data`.

## observations
`{status, reason, prompt_version, note, items[]}`; each item:
`{observation_id, text, confidence: low|medium|high, supporting_episodes, episode_ids[], item_keys[], feature_keys[], quotes[quote]}`.
Text is scoped ("In this conversation, in the N episodes reviewed, ..."); no trait language or causal claims.
Confidence is computed in code from `supporting_episodes` (the larger of: cited episodes, agreeing episodes behind
the cited rubric items, and all analyzed episodes when a conversation-level feature is cited): low < 5, medium 5-12, high > 12 with all cited rubric items
agreeing at >= 0.8.

## quote
`{quote_id, episode_id, speaker: me|other, timestamp, text, item_key}`. `text` is a verbatim snippet of one message
(checked in code: substring of the episode **and** spoken by the speaker being scored). Quotes are the only message
text that ever leaves the backend.

## run_meta
`run_id, created_at, finished_at, duration_s, mode, llm_opt_in, source (demo|chat.db), provider (deepseek|mock|null),
model, reasoning_effort, prompt_version, synthesis_prompt_version, extractor_version, backend_version, cache_hits,
cache_misses, llm_calls, llm_retries, invalid_outputs, dropped_quotes, dropped_observations, thresholds{...}`.

Optional on 1.1.0 (all may be omitted on a 1.0.0 report): `experimental_opt_in` (bool), `score_other_opt_in` (bool),
`experimental_scoring_version` (string or null), `experimental_prompt_versions` (`{episode, holistic}` or null),
`experimental_llm_calls` (int), `experimental_cache_hits` (int), `date_range_clamped` (null, or
`{requested, applied, bounds}`, each `{date_from, date_to}` local dates or null; set when `POST /analyses` clamped a
range that was partly outside the conversation's first..last message dates).

## experimental_scores (schema 1.1.0, optional)

Methods, evidence, and the validity statement: [`EXPERIMENTAL_SCORES.md`](EXPERIMENTAL_SCORES.md). `experimental_scores` is optional, experimental, and not validated. Schema `1.0.0` reports omit it. Schema `1.1.0` adds it. It is a sibling of `observations`, not a field inside them.

`status` is `ok` | `not_run` | `insufficient_data` | `failed`. `banner`, `title` ("Experimental scores"), `scale_note`, `footer_support`, and `how_it_works` are constants. `scoring_version` is `exp-scores-v1`. `prompt_versions` is `{episode: "traits-exp-v1", holistic: "exp-holistic-v1"}`. `anchors_version` is `exp-anchors-v1`. `speakers_scored` is `["me"]` or `["me", "other"]`. `thresholds` is `{min_episodes: 20, min_words: 1500, max_confidence: "medium"}`.

`dimensions` has exactly 12 objects, in this order: `openness`, `conscientiousness`, `extraversion`, `agreeableness`, `neuroticism`, `depression_language`, `anxiety_language`, `addictive_language`, `anger_hostility_language`, `narcissism_language`, `attachment_anxious_language`, `attachment_avoidant_language`. Each pins `key`, `label`, `family`, `evidence_strength`, and `evidence_note`. Families are `big_five`, `wellbeing_language`, and `interpersonal`. `citations` is `{short, doi|null}`.

`per_speaker.me` is always an object. `per_speaker.other` is an object or null when that person was not scored. When `status` is `ok`, `score` is an integer 0–100, `band` is `{lo, hi}`, and `confidence` is `low` or `medium`. Otherwise `score`, `band`, and `confidence` are null and `reason` is a string. `confidence` is never `high`. Dimensions whose evidence is not moderate only allow `low` or null. Also present: `n_episodes`, `n_words`, `contributions`, `trend`, `quote_ids`.

A contribution is `{marker_key, label, source: D|R|H, direction: up|down, weight, value|null, unit, sub_score|null, anchor_source, status: ok|not_run|no_data, quote_ids}` with at most two quote ids. A trend point is `{week, score|null, n_episodes, n_words, reason|null}`.

`quotes` (ids `xq_001`, …) are `{id, speaker, episode_id, marker_key, text, ts}`. They are the only place experimental excerpts appear. They are not copied into top-level `quotes` and they are not referenced by observations.

These keys do not appear anywhere under the section: `percentile`, `t_score`, `norm`, `level`, `category`, `label_high`, `cutoff`.
