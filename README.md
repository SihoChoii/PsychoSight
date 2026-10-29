# PsychoSight

Project repository for PsychoSight.

## PsychoSight Lite backend

PsychoSight Lite analyzes **one 1:1 iMessage conversation** and produces a descriptive "communication patterns"
report: weekly me-vs-other timelines, an anchored rubric of observable behaviors in *my* messages, 3-5
evidence-cited observations, and a "What this cannot tell you" box.

> **Experimental self-reflection, not a clinical or diagnostic tool.** No diagnoses, labels, scores against
> norms or cutoffs. Thin evidence is shown as "insufficient data", never as zero.

Specs: `docs/REPORT_SCHEMA.md` + `schemas/report.schema.json` (report contract), `docs/API.md` (localhost API),
`docs/sample_report.json` / `docs/sample_report_deterministic_only.json` (fixtures).

### Setup (macOS, Python 3.9+)
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest            # all offline, no network, no chat.db needed
```

### DeepSeek key (one-time setup)
```bash
cp .env.example .env      # then paste the DeepSeek key after DEEPSEEK_API_KEY=
.venv/bin/python -m psychosight check-llm
```
The key is **not in git** (judges receive it privately). It is read from the `DEEPSEEK_API_KEY` environment variable,
else from `.env` at the repo root, else `~/.psychosight/.env` (both gitignored; no extra dependency). The default model
is `deepseek-flash` (DeepSeek-V4.1-Flash) at the highest thinking effort (`reasoning_effort: max`). The key is only
used after the explicit opt-in and is shown masked (`sk-…abcd`) by `check-llm`. Without a key everything else still
works: deterministic-only reports and the offline mock demo.
A full AI run on the demo conversation (`PSYCHOSIGHT_DEMO_PROVIDER=deepseek`, 40 episodes x 2 scoring runs + 1 synthesis
call) took about 5 minutes live and roughly 90k input / 280k output tokens (most of it reasoning); re-runs reuse the
local score cache.

### Environment variables
Any of these can also go in `.env`; a real environment variable wins over the file.

| Variable | Required | Meaning |
|---|---|---|
| `DEEPSEEK_API_KEY` | for real LLM runs | DeepSeek key (env var or `.env`). Never logged, printed in full, returned by the API, or written to disk. |
| `DEEPSEEK_MODEL` | no | Overrides the default model `deepseek-flash` (DeepSeek-V4.1-Flash, "4.1 flash 1017"). Other id on the key today: `deepseek-v4-pro`. |
| `DEEPSEEK_BASE_URL` | no | Default `https://api.deepseek.com`. |
| `DEEPSEEK_REASONING_EFFORT` | no | Default `max` (highest). `none` disables thinking. |
| `DEEPSEEK_THINKING` | no | Default `enabled`. |
| `DEEPSEEK_JSON_MODE`, `DEEPSEEK_SEND_TEMPERATURE` | no | Default `1`; set `0` if the model rejects `response_format` or `temperature`. |
| `DEEPSEEK_TIMEOUT_S`, `DEEPSEEK_MAX_TOKENS` | no | Request timeout (default 300 s) and optional max tokens. |
| `PSYCHOSIGHT_PORT` | no | Default `8765`. |
| `PSYCHOSIGHT_STATIC_DIR` | no | UI directory; default `web/dist`, then `web/`. |
| `PSYCHOSIGHT_DATA_DIR` | no | Local SQLite location; default `~/.psychosight/`. |
| `PSYCHOSIGHT_CHAT_DB` | no | Default `~/Library/Messages/chat.db`. |
| `PSYCHOSIGHT_DEMO_PROVIDER` | no | `mock` (default, offline) or `deepseek` to score the synthetic demo conversation with the real API. |
| `PSYCHOSIGHT_MAX_LLM_CALLS` | no | Per-run call ceiling (default 200). |
| `PSYCHOSIGHT_LLM_CONCURRENCY` | no | Episodes scored in parallel (default 8). |

### Run
```bash
# One command: API + static UI on http://127.0.0.1:8765
.venv/bin/python -m psychosight serve

# CLI
.venv/bin/python -m psychosight list-conversations
.venv/bin/python -m psychosight analyze --demo                         # deterministic-only (no LLM)
.venv/bin/python -m psychosight analyze --demo --opt-in-llm --out demo.json   # full mode, offline mock LLM
.venv/bin/python -m psychosight analyze -c 42 --from 2026-08-01 --to 2026-10-28 --opt-in-llm --out report.json
.venv/bin/python -m psychosight list-reports
.venv/bin/python -m psychosight delete-report <report_id>
.venv/bin/python -m psychosight check-llm     # DeepSeek smoke test on ONE synthetic episode
.venv/bin/python -m psychosight --demo        # shortcut for analyze --demo
```
API demo flow with curl:
```bash
B=http://127.0.0.1:8765
curl -s $B/config
JOB=$(curl -s -X POST $B/analyses -H 'content-type: application/json' \
      -d '{"conversation_id":"demo","llm_opt_in":true}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["job_id"])')
curl -s $B/analyses/$JOB          # status, stage, progress
curl -s $B/analyses/$JOB/report   # report JSON
curl -s -X DELETE $B/analyses/$JOB
```

### How it works
`loader` (imports `psychosight/msgexport.py`, Siho's exporter, unchanged) -> `sessionize` (turn: same sender,
gap < 30 s; episode: gap > 20 min starts a new one; DST-safe) -> `features` (absolutist-word rate with the 19-word
Al-Mosaiwi & Johnstone list, I/we rates, initiation, approximate reply-time medians, message length, follow-up
turns, neutral late-night count; per ISO week; < 300 words per side -> null "insufficient data") ->
`rubric` (opt-in only: up to 40 episodes, ~60% top-signal + ~40% seeded random; 6 anchored 1-5 items on my
messages; strict JSON, one retry; each episode scored twice and kept only when runs agree within 1 point;
quotes must be verbatim and from my messages) -> `synthesize` (opt-in only: scoped observations "In this
conversation, in the N episodes reviewed, ...", ids/quotes/wording post-checked, confidence from supporting
episodes and agreement) -> `report` (validated against the JSON Schema, a failure is a hard error).

### Privacy
- **Local-first.** Analysis runs on this Mac. chat.db is read through a read-only snapshot.
- **Nothing is sent anywhere without opt-in.** Without `llm_opt_in` you get a full deterministic-only report and no
  network call is made.
- **After opt-in, excerpts of both sides are sent to DeepSeek.** Up to 40 selected episode windows, including the
  other person's messages as context, plus (for the synthesis call) aggregate numbers and the verified quotes. The
  exact disclosure is `opt_in_text` in `GET /config`.
- **Reports contain evidence quotes.** The local `reports` table (in `~/.psychosight/psychosight.db`) stores each
  report JSON, including short verbatim quotes. Delete one with `python -m psychosight delete-report <id>` or
  `DELETE /analyses/{id}` (the DB is vacuumed afterwards).
- **The LLM cache holds no message text.** `llm_scores` is keyed by (episode hash, prompt version, model, run) and
  stores scores plus quote offsets only. `episodes`/`features` tables hold counts and numbers only.
- **No message bodies or model reasoning in logs.** DeepSeek reasoning traces are discarded on receipt and never
  logged or stored; logs carry ids, counts and status codes only (enforced by tests). The API key is never logged or returned by the API.
- The API binds to 127.0.0.1 and only serves message text as evidence quotes inside reports.

### Troubleshooting
- **`FULL_DISK_ACCESS_REQUIRED`**: System Settings > Privacy & Security > Full Disk Access, enable the app that runs
  the backend (Terminal, iTerm, or your IDE), then restart it. The demo conversation works meanwhile.
- **`LLM_UNAVAILABLE` "No DeepSeek API key found"**: `cp .env.example .env`, paste the key, restart the backend.
- **`LLM_UNAVAILABLE` "rejected the API key"**: the key in `.env` (or `DEEPSEEK_API_KEY`) is wrong or revoked;
  replace it and run `python -m psychosight check-llm`.
- **`LLM_UNAVAILABLE` "rejected the model"**: the error lists the model ids your key can use (from DeepSeek's
  `GET /models`); set `DEEPSEEK_MODEL` to one of them and run `python -m psychosight check-llm`.
- **HTTP 400 mentioning `response_format` or `temperature`**: set `DEEPSEEK_JSON_MODE=0` or
  `DEEPSEEK_SEND_TEMPERATURE=0`.
- **`GROUP_CHAT_UNSUPPORTED`**: only 1:1 conversations are supported in this version.
- **Port in use**: `python -m psychosight serve --port 8766` (the UI expects 8765 by default).
