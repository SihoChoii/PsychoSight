# PsychoSight Lite local API (v1)

Base URL: `http://127.0.0.1:8765` (stable; override with `--port` / `PSYCHOSIGHT_PORT`). Binds to 127.0.0.1 only.
Start with `python -m psychosight serve`. The same process serves the static UI at `/` (see "Static UI").
CORS allows `http://localhost:*` and `http://127.0.0.1:*` origins (for a separate dev server).
All bodies are JSON. Report shape: [REPORT_SCHEMA.md](REPORT_SCHEMA.md).

## Errors
Every error response is
```json
{"error": {"code": "NOT_FOUND", "message": "No analysis with id 'x'."}}
```
| code | HTTP | when |
|---|---|---|
| `FULL_DISK_ACCESS_REQUIRED` | 403 | chat.db missing or unreadable (grant Full Disk Access to the terminal/app running the backend). |
| `GROUP_CHAT_UNSUPPORTED` | 400 | Conversation has more than one other participant. 1:1 only. |
| `LLM_OPT_IN_REQUIRED` | 400 | `mode:"full"` requested without `llm_opt_in:true`. LLM stages never run without opt-in. |
| `LLM_UNAVAILABLE` | 503 (or job error) | Opt-in given but no key is configured (message: copy `.env.example` to `.env` and put the key in it, or export `DEEPSEEK_API_KEY`), the key was rejected, the model string was rejected (message lists the provider's models), or the provider failed. |
| `NOT_FOUND` | 404 | Unknown conversation, job or report. |
| `REPORT_NOT_READY` | 409 | Report requested before the job is `done`. |
| `INVALID_REQUEST` | 422 | Body failed validation (e.g. bad date). |
| `EXPERIMENTAL_CONSENT_REQUIRED` | 422 | `score_other` is true while `experimental_scores` is false, or an echoed experimental consent string does not match the current text from `GET /config`. |
| `INTERNAL_ERROR` | 500 | Unexpected failure (no message text in the message). |

## GET /health
`200 {"status": "ok", "version": "0.1.0"}`

## GET /config
No secrets: the API key is never returned, not even masked. The key is not in git; set it once with
`cp .env.example .env` and paste it (or export `DEEPSEEK_API_KEY`). `llm_available` is `true` when a key is
configured. `llm_key_source` is `"env"` (environment variable), `"dotenv"` (`.env` at the repo root or
`~/.psychosight/.env`) or `null` (no key: full mode on a real conversation returns `LLM_UNAVAILABLE`; the mock demo
and deterministic-only reports still work). `model` defaults to `deepseek-flash` (DeepSeek-V4.1-Flash), overridable
with `DEEPSEEK_MODEL`. `llm_configured` is kept as an alias of `llm_available`.
`demo_provider` is the provider the synthetic demo will use: `"deepseek"` whenever a key is configured, else `"mock"`
(override with `PSYCHOSIGHT_DEMO_PROVIDER=mock|deepseek`). `demo_provider_note` is `null` for the real model and a
user-visible string starting with `"not real model"` when the demo falls back to the offline mock; show it next to
the opt-in. The opt-in text itself says the demo excerpts are synthetic.
```json
{
  "version": "0.1.0",
  "schema_version": "1.1.0",
  "provider": "deepseek",
  "model": "deepseek-flash",
  "llm_configured": true,
  "llm_available": true,
  "llm_key_source": "dotenv",
  "reasoning_effort": "max",
  "demo_provider": "deepseek",
  "demo_provider_note": null,
  "opt_in_text": "<exact string, render verbatim; see below>",
  "disclaimer": "Experimental self-reflection, not a clinical or diagnostic tool",
  "limitations_title": "What this cannot tell you",
  "max_episodes_scored": 40,
  "experimental_opt_in_text": "Show experimental personality and well-being language scores. These are 0–100 numbers built from word counts and AI ratings. They are not validated and are not a diagnosis. With AI scoring on, the same excerpts already selected are sent to DeepSeek again with extra questions.",
  "score_other_opt_in_text": "Also score the other person. They have not agreed to be scored. Their scores are an experimental reading of their messages in this conversation only, stay on this computer, and should not be shared or used to judge them.",
  "experimental_banner": "Experimental, not validated. These scores are not a diagnosis, not a personality test and not a measure of who anyone is. They come from word counts and AI ratings of this one conversation and can easily be wrong.",
  "experimental_footer_support": "If anything in this conversation is weighing on you, consider talking with someone you trust or a licensed professional.",
  "experimental_scale_note": "0–100 experimental index. 50 is the midpoint of fixed reference points, not an average person. The shaded band shows how uncertain the number is.",
  "experimental_how_it_works": "<multi-paragraph string, render verbatim>",
  "experimental_enabled": true,
  "experimental_dimensions": [
    {"key": "openness", "label": "Openness (experimental language index)", "family": "big_five", "evidence_strength": "moderate"},
    {"key": "conscientiousness", "label": "Conscientiousness (experimental language index)", "family": "big_five", "evidence_strength": "moderate"},
    {"key": "extraversion", "label": "Extraversion (experimental language index)", "family": "big_five", "evidence_strength": "moderate"},
    {"key": "agreeableness", "label": "Agreeableness (experimental language index)", "family": "big_five", "evidence_strength": "moderate"},
    {"key": "neuroticism", "label": "Neuroticism (experimental language index)", "family": "big_five", "evidence_strength": "moderate"},
    {"key": "depression_language", "label": "Depression-related language (experimental language index)", "family": "wellbeing_language", "evidence_strength": "small"},
    {"key": "anxiety_language", "label": "Anxiety-related language (experimental language index)", "family": "wellbeing_language", "evidence_strength": "small"},
    {"key": "addictive_language", "label": "Addictive-tendency language (experimental language index)", "family": "wellbeing_language", "evidence_strength": "very_weak"},
    {"key": "anger_hostility_language", "label": "Anger/hostility language (experimental language index)", "family": "interpersonal", "evidence_strength": "small"},
    {"key": "narcissism_language", "label": "Narcissism-related language (experimental language index)", "family": "interpersonal", "evidence_strength": "very_weak"},
    {"key": "attachment_anxious_language", "label": "Anxious-attachment-related language (experimental language index)", "family": "interpersonal", "evidence_strength": "very_weak"},
    {"key": "attachment_avoidant_language", "label": "Avoidant-attachment-related language (experimental language index)", "family": "interpersonal", "evidence_strength": "very_weak"}
  ]
}
```
`opt_in_text` (current value, render it verbatim from the API rather than copying it):

> To score communication patterns, PsychoSight will send excerpts of this conversation to DeepSeek (an external AI service). The excerpts include messages from BOTH sides: your messages and the other person's messages, which are sent as context. Up to 40 short episodes are sent; nothing else from your Messages library leaves this computer. DeepSeek processes the excerpts under its own terms. Evidence quotes from the analysis are saved in the local report until you delete it. The demo conversation is synthetic: its excerpts are fictional messages written for the demo. If you do not opt in, you still get a local-only report without the AI sections.

`demo_provider` is `"deepseek"` when a key is configured (the demo runs a real analysis) and `"mock"` otherwise; override with `PSYCHOSIGHT_DEMO_PROVIDER=mock|deepseek`. `demo_provider_note` is `null` with the real model and a short explanation string when the demo falls back to the mock (show it next to the demo entry). Sample captured from the running server with a key in `.env`; `experimental_*` fields are described under [Experimental scores](#experimental-scores).

## GET /conversations
```json
{
  "conversations": [
    {"id": "demo", "label": "Demo conversation (synthetic)", "message_count": 4259, "latest_date": "2026-02-01T13:48:05-08:00",
     "is_group": false, "supported": true, "is_demo": true, "participant_count": 1},
    {"id": "42", "label": "+1 555-0100", "message_count": 3021, "latest_date": "...", "is_group": false, "supported": true, "is_demo": false, "participant_count": 1}
  ],
  "chat_db": {"available": true, "error": null}
}
```
The demo entry is always first. If chat.db cannot be read the response is still `200` with only the demo entry and
`chat_db: {"available": false, "error": {"code": "FULL_DISK_ACCESS_REQUIRED", "message": "..."}}` so the UI can show
setup help and offer the demo. Group chats are listed with `is_group: true, supported: false`.

## POST /analyses
Request:
```json
{"conversation_id": "demo", "date_from": "2025-09-01", "date_to": "2025-11-30", "llm_opt_in": true, "demo": false, "mode": null}
```
- `conversation_id` required (`"demo"` or an id from `/conversations`). `demo: true` forces the synthetic conversation.
- `date_from`/`date_to` optional, inclusive local dates `YYYY-MM-DD`.
- `llm_opt_in` required boolean. `false` gives a full deterministic-only report (rubric and observations `not_run`).
- `mode` optional: `"full"` (requires `llm_opt_in:true`, else `400 LLM_OPT_IN_REQUIRED`) or `"deterministic_only"`.

Response `202 {"job_id": "a1b2...", "status": "queued"}`. Fast-fail errors: `GROUP_CHAT_UNSUPPORTED`, `NOT_FOUND`,
`LLM_OPT_IN_REQUIRED`, `LLM_UNAVAILABLE` (opt-in with no usable key/model for a real conversation).
The demo conversation uses the real DeepSeek model when a key is configured and the offline mock otherwise
(`run_meta.provider` is `"mock"` and `run_meta.provider_note` starts with `"not real model"`).
Experimental score fields, demo defaults, and `EXPERIMENTAL_CONSENT_REQUIRED` are in [Experimental scores](#experimental-scores).

## GET /analyses/{job_id}
```json
{"job_id": "a1b2", "status": "running", "stage": "scoring", "progress": {"current": 12, "total": 40},
 "mode": "full", "conversation_id": "demo", "created_at": "...", "error": null}
```
`status`: `queued | running | done | error`. `stage`: `loading | sessionizing | features | scoring | synthesis | done`
(on error the stage where it failed is kept and `error` is `{code, message}`). Poll every ~500 ms.
`progress` is per stage (`scoring` counts episodes; other stages are 0/1 or 1/1).

## GET /analyses/{job_id}/report
`200` report JSON (validates against `schemas/report.schema.json`). `409 REPORT_NOT_READY` while running,
`404 NOT_FOUND` if unknown or deleted. Reports are persisted in local SQLite, so they survive a restart.

## GET /analyses
`200 {"analyses": [{"job_id", "conversation_label", "mode", "created_at"}]}` stored reports, newest first.

## DELETE /analyses/{job_id}
Deletes the stored report (which contains evidence quotes) and the job. `200 {"deleted": true, "job_id": "..."}`,
`404 NOT_FOUND` if unknown.

## Experimental scores

Optional report section. It is off unless the request turns it on, except `conversation_id: "demo"`, where it is on by default. The section is experimental and not validated. Fixed wording is served by `GET /config` and rendered verbatim. Methods, evidence, and limits: [EXPERIMENTAL_SCORES.md](EXPERIMENTAL_SCORES.md).

### POST /analyses

Additional fields:

| Field | Default | Demo default |
|---|---|---|
| `experimental_scores` | `false` | `true` |
| `score_other` | `false` | `true` |
| `experimental_opt_in_text` | omitted | echo not required |
| `score_other_opt_in_text` | omitted | echo not required |

- `score_other: true` with `experimental_scores: false` → **422** `EXPERIMENTAL_CONSENT_REQUIRED`, message: "Scoring the other person requires the experimental scores consent."
- On a non-demo conversation, `experimental_opt_in_text` must equal `experimental_opt_in_text` from `GET /config` when experimental scores are requested, and `score_other_opt_in_text` must equal `score_other_opt_in_text` when the other person is scored. A mismatch → **422** `EXPERIMENTAL_CONSENT_REQUIRED`, message: "The experimental consent text does not match the current text from GET /config."
- The demo does not require the echo.
- Without `llm_opt_in`, word-count markers still run. Episode AI items and the overall AI rating are `not_run`, and the uncertainty band is widened by 10 points.
- Non-demo requests that leave the section off still include it, with `status: "not_run"` and reason `"not requested"`. No experimental model calls run in that case.
- `PSYCHOSIGHT_EXPERIMENTAL=0` forces `status: "not_run"`, reason `"disabled by configuration"`, and `experimental_enabled: false` on `GET /config`.
- A failure inside the section does not fail the job. The section is `status: "failed"` with reason `"Experimental scores could not be computed for this run."` The rest of the report is unchanged.
- Progress events add stage `experimental`. `done` / `total` count finished units, not model calls: one per selected episode (both scoring runs finished) plus one per speaker with a holistic rating, in completion order. The cap is `PSYCHOSIGHT_EXP_MAX_LLM_CALLS` (default 110), separate from `PSYCHOSIGHT_MAX_LLM_CALLS`.

`GET /analyses/{job_id}/report` includes the section only as the optional `experimental_scores` object (schema 1.1.0). Reports stored at 1.0.0, which have no such object, still load.

### GET /config

Additional fields, all safe to show: `experimental_opt_in_text`, `score_other_opt_in_text`, `experimental_banner`, `experimental_footer_support`, `experimental_scale_note`, `experimental_how_it_works`, `experimental_enabled`, `experimental_dimensions`.

`experimental_dimensions` is twelve objects in registry order, each `{key, label, family, evidence_strength}`. `schema_version` in this response is `"1.1.0"`.

Current consent and banner strings (also the values tests should echo):

```text
Show experimental personality and well-being language scores. These are 0–100 numbers built from word counts and AI ratings. They are not validated and are not a diagnosis. With AI scoring on, the same excerpts already selected are sent to DeepSeek again with extra questions.
```

```text
Also score the other person. They have not agreed to be scored. Their scores are an experimental reading of their messages in this conversation only, stay on this computer, and should not be shared or used to judge them.
```

```text
Experimental, not validated. These scores are not a diagnosis, not a personality test and not a measure of who anyone is. They come from word counts and AI ratings of this one conversation and can easily be wrong.
```

### CLI

`python -m psychosight analyze --experimental-scores [--score-other]`. `--demo` implies both unless `--no-experimental-scores` (which also turns off scoring the other person). `--score-other` without `--experimental-scores` exits 2 with `EXPERIMENTAL_CONSENT_REQUIRED`.

## Message text
There is no endpoint that returns full message text. Message text leaves the backend only as evidence `quotes` in
the report (verbatim snippets with `episode_id`, `speaker`, `timestamp`).

## Static UI
FastAPI mounts a static directory at `/` **after** the API routes: `--static-dir` / `PSYCHOSIGHT_STATIC_DIR`,
default `web/dist` if it exists, else `web/` when it holds plain static files (an unbuilt Vite project with
`web/package.json` is skipped, because its raw `index.html` cannot run; build it with `cd web && npm install && npm run build`).
If no UI is found, `GET /` returns a short HTML note and the API still
works. The frontend is a Vite app that builds into `web/dist`. Those paths are resolved from the
checkout root, or from the frozen app bundle, never from the process working directory. The macOS app
passes that bundled `web/dist` as `--static-dir`.
