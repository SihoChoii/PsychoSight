# PsychoSight Lite backend audit

Audit of branch `backend/lite-pipeline` (PR #1). Fixes are on `backend/audit-fixes`. No real Messages library was read. Every live run used the synthetic demo conversation and the offline mock LLM (`PSYCHOSIGHT_DEMO_PROVIDER` left at `mock`). A throwaway `DEEPSEEK_API_KEY` value was set only to confirm it is not written to logs, reports, or SQLite.

Python: 3.12.3 (`/workspace/.venv`) and 3.9.25 (uv CPython, `/tmp/ps39`). 3.9 is not in the image apt archive; it was installed with `uv python install 3.9`.

## Result

No critical defect. Three high defects were fixed (provider error bodies, non-loopback bind, quote-offset cache reuse). Several medium defects in quoting, LLM parsing, the stance lint, the absolutist dictionary, tokenization, the call ceiling, and local file permissions were fixed. One medium privacy item in `msgexport.py` is left for a decision. The two-run agreement rule, late-night window, opt-in gate, and delete-plus-VACUUM behavior match the spec.

## Test results

| Run | Result |
|---|---|
| Before these fixes, Python 3.12.3 | 94 passed, twice, no flakes |
| Before these fixes, Python 3.9.25 | 94 passed |
| Before these fixes, coverage | about 69% of `psychosight/` ( `msgexport.py` about 25%) |
| After, Python 3.12.3 | 120 passed, including a coverage run |
| After, Python 3.9.25 | 120 passed, twice |
| After, coverage | 72% of 2,662 statements (751 missed). Excluding `msgexport.py`, about 94% |

`tests/test_audit.py` adds the cases for the bugs below. The first draft of `test_report_not_ready_and_delete_during_run` polled job status during a cancel and raced (404 body has no `stage` while the worker is still between save and delete). That assertion was rewritten to wait until `delete_report` actually removes the row. After that change the suite did not flake. The pre-existing 94 tests did not flake across the two 3.12 runs.

Coverage that is still thin, and is a gap rather than a product failure:

- `psychosight/msgexport.py` is 25% covered. The lite path uses listing, the read-only snapshot, and row decoding. The Markdown exporter and UI are unused here.
- `psychosight/__main__.py` is 0% (the five-line `python -m` entry). `cli.py` `check-llm` (lines 127-154) is untested because it calls the network; missing-key exit 2 is covered.
- `app.py` lines 139-144 and 201-202 (job error branches), `llm.py` lines 215-216 and 247 (non-string error message, non-dict content parts), `synthesize.py` retry/fail lines 162-165.

## Live exercise

`python -m psychosight -v analyze --demo` and the same command with `--opt-in-llm`, plus one saved full run, all exited 0. Reports validate against `schemas/report.schema.json` (Draft 2020-12):

| Run | mode | `llm_opt_in` | episodes | scored | llm_calls | cache_hits | quotes | schema |
|---|---|---|---|---|---|---|---|---|
| `--demo` | `deterministic_only` | false | 59 | 0 | 0 | 0 | 0 | valid |
| `--demo --opt-in-llm` | `full` | true | 59 | 40 | 77 | 4 | 10 | valid |
| saved repeat of the full run | `full` | true | 59 | 40 | 1 | 80 | 10 | valid |

The four cache hits on a cold full run are the demo's repeated late-night script (identical text, so the exact fingerprint matches). The second run reused the cache. `run_meta.llm_opt_in` matches the flag.

`serve --host 0.0.0.0` returned exit 2 and did not bind. `serve --host 127.0.0.1 --port 18765` was curled:

| Request | Result |
|---|---|
| `GET /health`, `/config`, `/conversations`, `/`, `/docs`, `/openapi.json` | 200 |
| `GET /config` and the serve log | the throwaway API key is absent; `demo_provider` is `mock` |
| `Origin: http://127.0.0.1:5173` and `http://localhost:3000` | `access-control-allow-origin` echoed |
| `Origin: http://localhost.evil.com`, `https://127.0.0.1:5173`, `null` | no allow-origin header |
| empty body, missing id, `llm_opt_in: "yes"`, `mode: "nope"`, bad date | 422 `INVALID_REQUEST`; the 500-character id is not echoed |
| `date_from` after `date_to` | 422 |
| `mode: "full"` with `llm_opt_in: false` | 400 `LLM_OPT_IN_REQUIRED` |
| unknown id and a SQL-looking id | 403 `FULL_DISK_ACCESS_REQUIRED` on this Linux host, because `~/Library/Messages/chat.db` is missing. The client string is not in the message. Parameterized lookup is covered by `tests/test_audit.py` against a fixture database |
| unknown job, report, and delete | 404 |
| `GET /../secret.txt` and a percent-encoded variant | 404, body does not contain a planted secret |
| two overlapping `POST /analyses` (`llm_opt_in` false and true) | both 202, both reached `done`, both reports schema-valid (`deterministic_only` with 0 calls, `full` with 77 calls and 10 quotes) |
| `GET` report while the job was in `features` | 409 `REPORT_NOT_READY` |
| `DELETE` of the deterministic job | 200; later `GET` of the job and the report are 404; `GET /analyses` keeps only the remaining full report |

CLI `analyze --demo --from 2025-12-01 --to 2025-01-01` exits 2 with `date_from must be on or before date_to`. CLI `analyze --conversation` of a SQL-looking id exits 2 with the Full Disk Access message and does not echo the id.

SQLite (`PSYCHOSIGHT_DATA_DIR`, mode `0600`):

- `llm_scores` holds `items` plus `_exact_fp`. The demo sentence "you never listen" is absent from every score row and from analyze/serve logs. `reasoning_content` is absent.
- That sentence is present only inside `quotes[].text` of a full report. A deterministic report does not contain it.
- `delete-report` removed the report row and, after `VACUUM`, the sentence is gone from the database file. Score rows remain, still without message text.

## Critical

None.

## High

### H1. Provider error bodies were returned to callers

- Where: `psychosight/llm.py` `_provider_error` (lines 220-230). Before the fix, a non-retryable 4xx interpolated `resp.text` into `LLMUnavailable`, which the API and the CLI print.
- Evidence: a mocked 400 whose JSON error message contained a prompt excerpt and a fake key came back in the exception string. DeepSeek error messages can echo the request.
- Fix: the exception now carries only the status code and, when the classified message mentions them, the words `response_format` or `temperature`. The raw body is not logged (`_error_message` is used for classification only). Covered by `test_provider_errors_do_not_echo_the_body`.

### H2. `serve --host` would bind a non-loopback address

- Where: `psychosight/cli.py` lines 157-169.
- Evidence: the previous code printed a warning and still called `uvicorn.run` with the requested host. The API has no authentication, and a full report contains evidence quotes.
- Fix: hosts other than `127.0.0.1`, `localhost`, and `::1` return exit 2 before `uvicorn.run`. Confirmed live: `--host 0.0.0.0 --port 9` exited 2. CORS stays `^http://(localhost|127\.0\.0\.1)(:\d+)?$` (`psychosight/app.py` line 28). An `http://[::1]` browser origin is outside that regex on purpose; the API document allows localhost and 127.0.0.1 only.

### H3. Quote offsets were reused across a normalized-hash collision

- Where: `psychosight/sessionize.py` `exact_fingerprint` (lines 38-46); `psychosight/rubric.py` `score_one` (lines 339-368).
- Evidence: episode hash lowercases and collapses whitespace. `"Hi  there friend"` and `"hi there  friend"` share a hash. Applying the first episode's offsets to the second sliced `here ` rather than `there`. A cached score would then publish the wrong span as a verbatim quote. The demo's repeated episodes share both the hash and the exact text, so that reuse is valid.
- Fix: cache rows store `_exact_fp` (sha256 of `speaker` plus the exact message text). A hash hit with a different fingerprint, or a legacy row with no fingerprint, is a miss. `test_cache_does_not_reuse_offsets_when_only_normalized_text_matches`.

## Medium

### M1. Sanitized multiline quotes could not be verified

- Where: `psychosight/rubric.py` `_sanitize_aligned` (lines 135-162) and `locate_quote` / `_span_from_sanitized` (lines 206-239).
- Evidence: prompts flatten newlines to ` / ` and replace `<<<` / `>>>` so a message cannot close the data block or forge a speaker line. A quote of that flattened form failed the verbatim check, and a score above 1 with no verified quote was dropped.
- Fix: the sanitizer returns a span map. `locate_quote` tries the original substring first, then maps a sanitized quote back and stores the original slice. A mapped slice longer than 400 characters is rejected so a long run of newlines cannot fail report validation (`maxLength` 400). `test_sanitized_multiline_quote_maps_to_original`.

### M2. Huge messages were sent whole, and synthesis ignored the call ceiling

- Where: `psychosight/config.py` line 28 `MAX_MESSAGE_PROMPT_CHARS = 8000` (kept out of `thresholds()` because the report schema sets `additionalProperties: false`); `psychosight/rubric.py` lines 170-177; `psychosight/pipeline.py` line 63; `psychosight/synthesize.py` lines 150-152.
- Evidence: each message was copied into the rubric prompt with no cap. `CallBudget` was taken in `score_one` only, so `PSYCHOSIGHT_MAX_LLM_CALLS` did not cover the synthesis attempts.
- Fix: each prompt line keeps the first 8000 characters and appends ` [truncated]` outside the body, so a quote of the kept prefix still matches the original. One budget is created per run and passed into both scoring and synthesis. `test_huge_message_is_truncated_in_the_prompt` and `test_synthesis_respects_the_call_budget`.

### M3. Malformed provider payloads crashed or kept reasoning text

- Where: `psychosight/llm.py` `complete` (lines 165-207), `_message_text` / `_coerce_content` (lines 233-253).
- Evidence: HTTP 200 with a non-JSON body raised `JSONDecodeError` (a `ValueError`), and the CLI prints `ValueError` text. A list `content` was returned as the list object. `reasoning_content` was popped only when it was a sibling of a string `content`; a list of typed parts could still carry a reasoning part.
- Fix: invalid JSON is retried like a transport failure. Content is coerced to a string. Parts typed `reasoning` or `thinking`, and `reasoning_content` / `reasoning`, are discarded. Usage keeps int and float and drops booleans. 401 and 403 stay immediate (existing `test_llm.py`). 429, 500, 502, 503, and 504 retry. 402 is immediate. Covered in `tests/test_audit.py`.

### M4. Any 400 that mentioned the model id was treated as "model rejected"

- Where: `psychosight/llm.py` lines 26-29 and 133-140.
- Evidence: `_is_model_error` was true when the configured model string appeared anywhere in the body. A temperature rejection that echoes `"model": "deepseek-chat"` was reported as "Models available to this key", and `list_models` ran on the failure path.
- Fix: classification uses the provider `error.message` and a phrase list (`model not`, `unknown model`, `invalid model`, `model name`, `supported api model`, `does not exist`, `model_not_found`, `no such model`). A temperature 400 now mentions `temperature` and does not list models.

### M5. Stance lint could be bypassed, and the prompts used clinical words

- Where: `psychosight/safety.py` lines 19-77; rubric prompt rule 3 (`psychosight/rubric.py` line 124); synthesis rules 4 and 5 (`psychosight/synthesize.py` lines 25-26).
- Evidence: before normalization, a zero-width space inside `always`, an en dash in `T-score`, fullwidth `ｔｅｎｄｓ ｔｏ`, a Cyrillic `а` in `always`, `self harm`, `bi-affect`, `PID5`, and `above-average` missed the patterns. The rubric prompt contained `personality`, `psychiatric`, and `medical`. The synthesis prompt said `norms`. Schema descriptions, the disclaimer, the limitations, and sample observation copy were already inside the stance. `confidence` values `low` / `medium` / `high` are evidence-strength labels required by the schema; they are observation-only patterns, not banned words, so they stay in the JSON example.
- Fix: lint strips the exact allow-list first (so a zero-width character inside the disclaimer cannot hide the words that sentence is allowed to contain), then applies NFKC, strips invisible `Cf` characters, folds dashes, lowercases, folds a small Latin/Greek lookalike set, and collapses whitespace. Patterns now include `t-score` spacing, `self-harm`, `bi-affect`, `pid-5`, `neo-pi`, `elevat`, `cut-off`, `psychiatr`, `medical`, `norms` / `norm`, `percentiles`, and `personality`. Generalization adds `kind/type of person`, `tends to`, and `above/below average`. Prompts were reworded and still pass the generalization lint. `test_lint_adversarial_wording_and_prompts_stay_clean`.
- Residual: homoglyphs outside that small map still pass. Observations that copy `ignore previous`, `ignore all previous`, `system prompt`, `disregard the`, or `you are now` are dropped (`psychosight/synthesize.py` lines 48-50 and 120).

### M6. Absolutist dictionary used `absolute` instead of `whole`

- Where: `psychosight/features.py` lines 16-22.
- Evidence: Al-Mosaiwi & Johnstone (2018) Table S2 is 19 words and includes `whole`, not `absolute`. Counts therefore missed `whole` and counted `absolute`.
- Fix: the set is the published 19. Demo word counts are unchanged (3,130 me / 3,078 other). Me `absolutist_pct` is unchanged. Other overall moved from 1.36 to 1.43, and two weekly points moved from 1.32 to 1.51 (count 529) and from 1.40 to 1.57 (count 573). `docs/sample_report.json` and `docs/sample_report_deterministic_only.json` were updated only for those other-side points. Both samples still validate.
- Qualifiers stay `not`, `almost`, and `nearly`, which is what `docs/REPORT_SCHEMA.md` lists. `don't always` still counts `always`, because the token is `don't`, not `not`. Changing that would change rates. See decisions.

### M7. The tokenizer was ASCII-only, so non-English text looked like insufficient data

- Where: `psychosight/features.py` `tokenize` (lines 54-79).
- Evidence: the old `[a-z0-9]+(?:'[a-z]+)?` pattern counted `café` as `caf` and counted CJK as zero words. A Chinese thread under 300 ASCII words returned `null` features (the insufficient-data path) rather than a rate.
- Fix: ASCII tokens match the old pattern, including one trailing apostrophe group (`don't`, `i'm`; `rock'n'roll` stays `rock'n` + `roll`). Other letters stay with their word (`café`, Cyrillic). CJK, kana, and Hangul are one token per character. Emoji is still zero words. A 299-token side is `null`; 300 tokens with no dictionary hits is `0.0`, never a fake zero for an empty side. `test_tokenizer_ascii_is_unchanged_and_unicode_counts` and `test_min_words_boundary_is_null_not_zero`.
- Residual: a 300-character Chinese message now reports absolutist 0.0%, because the dictionary is English. That 0% is easy to misread. See decisions.

### M8. ISO week labels depended on the platform C library

- Where: `psychosight/features.py` `week_key` (lines 103-107).
- Evidence: `strftime("%G-W%V")` follows the C library. `datetime.isocalendar()` is the language definition. 2024-12-30 is 2025-W01. 2023-01-01 (Sunday) is 2022-W52, week start 2022-12-26. 2027-01-01 is 2026-W53 (existing test).
- Fix: `week_key` uses `isocalendar()`. `test_iso_week_year_boundary`.
- A cross-midnight episode stays one episode (gap arithmetic is UTC elapsed) and the whole episode is bucketed by its start week. That matches the current design. See decisions.

### M9. The httpx client and the database file mode

- Where: `psychosight/llm.py` `close` (lines 121-122); `psychosight/pipeline.py` lines 58-61 and 153-157; `psychosight/app.py` lines 145-148; `psychosight/cli.py` `cmd_check_llm` `finally`; `psychosight/storage.py` lines 54-57.
- Evidence: `DeepSeekProvider` opened a client and nothing closed it. The SQLite file was created with the process umask (often `0644`), and the reports table holds quotes.
- Fix: the pipeline closes a provider it created. The job thread and `check-llm` always close. The API passes a provider in, so the pipeline does not close it twice. `Store` chmods the database to `0600` (mode confirmed on the live data directory). `OSError` on chmod is ignored so a read-only filesystem does not abort startup.

### M10. Full `chat.db` snapshot is copied to a temp directory

- Where: `psychosight/msgexport.py` `snapshot_connection` (lines 287-315). Not modified. This file is the existing exporter.
- Evidence: every real-library read copies the whole Messages database, including every message body, to `tempfile.mkdtemp(prefix="msgexport-")` and queries the copy. `shutil.rmtree(..., ignore_errors=True)` runs in a `finally`. `kill -9`, or a failed rmtree, can leave the copy. `mkdtemp` is mode `0700`, so other users on the machine cannot read it, but it is a second on-disk copy of the library.
- Needs a decision: keep the snapshot (Messages locks the live database), or read through the read-only URI and accept the lock behavior. This audit did not change the exporter.

### M11. Error text echoed client strings

- Where: `psychosight/app.py` lines 62-68 and 154-161; `psychosight/loader.py` lines 138-149; `psychosight/pipeline.py` lines 52-53.
- Evidence: `NotFound` interpolated the raw conversation or job id. A multi-kilobyte or multi-line id would be reflected. `date_from` after `date_to` was not rejected up front.
- Fix: ids in errors are single-line and truncated at 64 characters. `conversation_id` longer than 128 characters is 422 and the value is not echoed. An inverted date range raises `InvalidRequest` in both the API and the pipeline. Live curl confirmed the 500-character id and the SQL-looking id are absent from the response.

## Low

### L1. `n't` / `isn't` / `won't` are not negation

`count_absolutist` skips a dictionary word only when the previous token is `not`, `almost`, or `nearly` (`psychosight/features.py` lines 82-86). `don't always` counts. The report schema names those three qualifiers. Left as specified. See decisions.

### L2. In-memory jobs are unbounded

`psychosight/app.py` line 76 keeps every `Job` until delete. Error jobs are not in SQLite, so they live until process exit. There is no concurrency cap. The bind is loopback and each full demo run is capped at 40 episodes plus the call budget. A local caller can still queue a large number of jobs. See decisions.

### L3. Under the 40-episode cap, every selected episode is labeled `top_signal`

`psychosight/rubric.py` lines 282-283. The 60/40 split runs only when there are more than 40 candidates. The demo has 40 scored episodes, so the random bucket can be empty. The label then means "selected", not "top of a larger pool". See decisions.

### L4. Episode-start week for post-midnight messages

Documented in M8. A message at 00:10 stays in the episode that started at 23:50, and that episode's week is the start instant. Late night itself is the half-open local window `[01:00, 04:00)` (`is_late_night`, lines 98-100): 00:59 is false, 01:00 is true, 03:59 is true, 04:00 is false. `test_late_night_window`.

### L5. Dependencies are unpinned

`requirements.txt` and `pyproject.toml` use `fastapi>=0.100`, `uvicorn>=0.22`, `jsonschema>=4.17`, `httpx>=0.24`, `pytest>=7`. There is no lockfile. The environment used for this audit resolved fastapi 0.162.0, uvicorn 0.54.0, jsonschema 4.26.0, httpx 0.28.1, pydantic 2.14.1, starlette 1.10.0, pytest 9.2.0. `pip-audit` was not run. See decisions.

### L6. Quote search returns the first matching ME message

`locate_quote` uses `str.find` on each ME message in order (`psychosight/rubric.py` lines 234-239). A short phrase that happens to occur in an earlier ME message than the one the model copied is attributed to that earlier message. The quote is still a verbatim substring of the scored speaker in that episode. Speaker `other` is rejected. Existing tests cover speaker mismatch and the injection mode that tries to quote OTHER.

### L7. Non-404 Starlette errors echo `exc.detail`

`psychosight/app.py` lines 93-97. The 404 path returns `Not found.` Unexpected exceptions return `INTERNAL_ERROR` / `Unexpected backend error.` and log the exception type only (`app.py` lines 99-102). `test_unexpected_error_hides_the_message` raises `RuntimeError("private message text SECRET_BODY")` and the body does not contain it. A Starlette HTTP error other than 404 still stringifies `detail`.

### L8. Log redaction is attached at handler level

`psychosight/llm.py` `install_log_guard` (lines 50-70), called at import, from `create_app`, and from CLI `_setup_logging` after `basicConfig`. httpx and httpcore are set to WARNING. The filter reads `DEEPSEEK_API_KEY` at emit time and replaces it with `[redacted]` on root and `psychosight` handlers. A child logger's own filter does not see propagated records, which is why the filter is on the handlers. The live serve log did not contain the throwaway key.

## Checked and consistent with the spec

- Opt-in: `require_opt_in` rejects anything other than `True` (`psychosight/llm.py` lines 73-76). `resolve_mode` refuses `full` without opt-in. `deterministic_only` wins even when opt-in is true. `run_meta.llm_opt_in` records the flag. A provider that would raise if called is not called when opt-in is false (`test_llm_opt_in_false_makes_no_provider_call`).
- Agreement: a pair agrees when `abs(score_a - score_b) <= 1`; the stored value is the mean (so 3 and 4 become 3.5). A difference of 2 or more is unstable and excluded. Null scores are excluded from the denominator. An item is `unstable` when the agreement rate is below 0.7, and `insufficient` when fewer than 3 episodes agree (`psychosight/rubric.py` lines 409-439). `test_agreement_boundary` locks 7/10 as ok and 6/10 as unstable.
- Evidence quotes in the report are slices of the episode, speaker `me`, and observations whose `episode_id` is not in the scored set are dropped (existing synthesis tests plus the injection-phrase drop).
- Session gaps: turn gap is `< 30s` (`build_turns`), episode gap is `<= 1200s` stays together (`sessionize`). Both use timezone-aware elapsed seconds, so a DST fold does not split on the wall clock. Out-of-order timestamps are sorted before grouping. Duplicate handling is by id as a tie-break. Undated rows are dropped (`test_undated_rows_are_dropped`).
- `MIN_WORDS` is 300. Below that, rates are `null`, not 0. Initiation `count` is the numerator (episodes that side opened). Double-text and absolutist `count` are denominators. The mock observation copy uses initiation the same way.
- Confidence (`psychosight/synthesize.py` lines 102-108): support under 5 is `low`, 5 through 12 is `medium`, above 12 is `high` only when every cited item agreement is at least 0.8. An empty item list is vacuously high; the existing test locks `(20, [], "high")`. These words are evidence-strength labels, not a verdict about the person.
- Empty range, one message, all-one-side, and emoji-only produce a schema-valid report and null absolutist rates (count 0 where there are no words). One side with no words does not yield a selection (`select_episodes` requires some words from the other person and at least two turns).
- Delete removes `reports`, `episodes`, and `features`, then `VACUUM`s (`psychosight/storage.py` lines 113-123). The live file no longer contained the quote bytes. Cache rows are scores and offsets, not bodies.
- Group chats, missing `chat.db`, and the demo-first conversation list were already tested and matched the live `/conversations` response on this host (`chat_db.available` false, demo still listed).

## Decisions

1. `msgexport.snapshot_connection` copies the full Messages database to a temp directory (M10). Left unchanged.
2. Whether `don't` / `isn't` / `won't` should count as negation. The schema names `not`, `almost`, and `nearly` only.
3. Whether a non-English thread that clears 300 tokens should show absolutist 0.0% (English dictionary, no hits) or stay `null`.
4. Whether weeks should follow the episode start when the episode crosses midnight.
5. Whether selection under the 40-episode cap should say `top_signal` for every episode.
6. Whether to cap concurrent jobs or expire in-memory error jobs.
7. Whether to pin dependencies and add a lockfile. Not pinned in this change, because a pin changes the install the app already ships.
