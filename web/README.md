# Web UI

PsychoSight Lite’s local interface. Vite + React + TypeScript. The FastAPI process serves the production build from `web/dist` (see `docs/API.md`).

Colors, type, and spacing come from `src/brand/tokens.css`, copied verbatim from the PsychoSigh brand kit. Fonts live beside that file. Theme logos, the symbol, and favicons are in `public/logos/black` and `public/logos/white` and switch with `data-theme`.

## Commands

```bash
cd web
npm install
npm test
npm run dev -- --host 127.0.0.1 --port 5181 --strictPort # isolated clone preview
npm run build     # web/dist
npm run preview   # serves the build on http://127.0.0.1:4173
```

From the repo root, after `npm run build`:

```bash
.venv/bin/python -m psychosight serve
# http://127.0.0.1:8765
```

## API base

Requests are same-origin (`/config`, `/conversations`, `/analyses`). The dev server proxies those paths to `http://127.0.0.1:8765`. Set `VITE_API_BASE` only when the API is on another origin, for example `VITE_API_BASE=http://127.0.0.1:8766`.

## Mock mode

Works with no backend, no chat.db, and no API key. Reports are the checked-in sample JSON files. Conversations are labeled demo data.

```bash
npm run dev -- --port 5181 --strictPort
# http://127.0.0.1:5181/?mock=1
VITE_MOCK=1 npm run dev -- --port 5181 --strictPort
```

`?mock=0` forces the real API even when `VITE_MOCK=1`.

Useful mock URLs:

- `?mock=1&disk=1` — Full Disk Access help, with “Try demo conversation”
- `?mock=1&freeze=scoring#/run/preview` — progress held at 12 of 40 episodes
- `?mock=1&freeze=experimental#/run/preview` — experimental stage held at 4 of 8 finished
- `?mock=1#/report/sample-full` — full sample report, schema 1.0.0, no experimental section
- `?mock=1#/report/sample-det` — deterministic-only sample (`not_run` sections, no experimental section)
- `?mock=1#/report/sample-exp` — stub experimental section from `docs/sample_experimental_scores.json`
- `?mock=1#/report/sample-exp-live` — real DeepSeek full-run report (`docs/sample_report_experimental.json`)
- `?mock=1#/report/sample-exp-real` — 12 dimensions, both speakers, no insufficient data
- `?mock=1#/report/sample-exp-det` — deterministic markers only
- `?mock=1#/report/sample-exp-me` — other person not scored (`per_speaker.other` is null)
- `?mock=1#/report/sample-exp-failed` — section status `failed`
- `?mock=1#/report/sample-exp-notrun` — section status `not_run`
- `?mock=1#/report/sample-exp-thin` — section status `insufficient_data`
- `?theme=white` or `?theme=black`

The disclosure on the opt-in screen is the string from `GET /config` (`opt_in_text`). Mock mode reads `src/fixtures/mock-config.json`, which is a snapshot of that field and must stay identical to `psychosight/config.py`.

## UI refurbishment review fixtures

Use `http://127.0.0.1:5181/?mock=1&theme=black` (or `theme=white`). No backend or provider calls are made. `src/fixtures/ui-previews.ts` generates fixed synthetic cases on demand without modifying the canonical JSON samples. The original `sample-*` routes above remain available, including all four experimental statuses and null Other.

Append one of these hashes to the URL:

| Hash | Review case |
| --- | --- |
| `#/report/ui-zero` | All three word rates are real zero; other values/count bases stay coherent. |
| `#/report/ui-null` | All-null weekly and overall word metrics with counts/reasons retained. |
| `#/report/ui-thin` | One short pooled episode; insufficient data remains null. |
| `#/report/ui-single-week` | One populated week, six episodes, exact values and counts. |
| `#/report/ui-omitted-weeks` | W32, W33, W36, W38; I-words also omits W33 while other features retain it. |
| `#/report/ui-long-labels` | Long conversation, metric, and description text. |
| `#/report/ui-104-weeks` | 104 continuous weeks, Aug 4, 2025–Aug 1, 2027. |
| `#/report/ui-260-weeks` | 260 continuous weeks, Aug 4, 2025–Jul 28, 2030. |
| `#/report/ui-absent-episodes` | Intentional legacy/partial-response robustness case: index omitted; weekly totals retained. This is the only new fixture intentionally outside the current schema. |
| `#/report/ui-pooled-selected` | Full canonical synthetic report; includes five pooled episodes selected for scoring. |
| `#/report/ui-provider-note` | Saved mock-provider provenance from the exact configured note. |

Generated timelines use UTC calendar dates, unique episode IDs, matching per-week/header totals, matching feature counts, and local-only model metadata. Long report dates and run timestamps are synthetic. An omitted week represents an interval absent from the response; it is not a zero-valued returned week. These deterministic fixtures cover the integrated layouts and data boundaries; they do not change API rendering.

Progress previews use `?mock=1&freeze=CASE#/run/preview`. Existing `scoring`, `experimental`, `loading`, `sessionizing`, `features`, `synthesis`, `done`, and `error` values still work. Additional cases:

- `queued`, `unknown-stage`.
- `scoring-zero` (0/40), `scoring-one` (0/1), `scoring-one-done` (1/1), `scoring-complete` (40/40), `scoring-unknown` (0/0).
- `experimental-zero` (0/8), `experimental-one` (0/1), `experimental-complete` (8/8), `experimental-unknown` (0/0).
- `local-experimental` (local mode with experimental work), `local-error`.
- `transport-error` (status retrieval fails), `missing` (404).
- `local-done` (completed local report). Both `done` and `local-done` load an already completed job and enter a valid `#/report/preview` directly. A completion newly observed during polling offers View report immediately, then enters automatically within 1.6 seconds.

Full reference provenance, baseline checks/captures, known existing defects, and the experimental height measurement are in `docs/UI_IMPLEMENTATION_STATUS.md`. Screenshots and temporary browser scripts live outside Git.


## Analysis job lifecycle

`hooks/useAnalysisJob.ts` owns status GETs, with one active read and a 500ms delay after each response. Job changes, retries, and unmount abort obsolete reads and invalidate their generation. Terminal `status` stops polling; a stage label or completed counter alone never establishes success. Retry reads the same job and never creates or cancels an analysis. Retrieval failures retain the last known job; missing jobs have a separate recovery state. `api.ts` preserves `AbortError` from fetch and body reads.

`stages.ts` is the pure display adapter. Only running scoring/experimental stages with valid measured totals expose stage progress, including one item. Scoring counts episodes; experimental counts finished work units. Zero/unknown/invalid totals remain indeterminate, and local mode skips only scoring/synthesis. Experimental outcomes remain neutral until the report establishes them. No overall percentage or ETA is calculated.

`components/RunScreen.tsx` owns the completion deadline separately from presentation. New completions allow immediate report entry and a maximum 1.6s hold. Reduced motion, first-loaded completion, and revisits enter directly. The timer checks the current route/job and document visibility, cleans up on navigation, and reconciles the original deadline on visibility return. The plain completion/actions remain usable before the separate LED integration.

`run-context.ts` stores optional version-1 conversation/range metadata under `psychosight-run-context:<returned job ID>` only after creation. It validates identity, dates and fields, whitelists metadata, and never stores report bodies or quotes. Existing selection/theme/active-job keys remain compatible. Missing, malformed, mismatched or unavailable storage gives a generic run screen; in-memory selection keeps a new journey usable when storage is denied. Terminal/missing status clears only a matching active-job link. Unverified resumed jobs use “Return to analysis.”

### LED progress (unit 2B)

The supplied renderer lives in `src/brand/led`; its README records archive provenance, source hashes and the two local adaptations (bundled Geist Mono and constructor rollback). `LedMatrix` owns Canvas lifecycle and a bounded ref-based clock. `StageRail` uses the existing authoritative job adapter and retains all seven stages. Native progress and exact episode/work-unit counts remain adjacent to the decorative Canvas; stage 100% never establishes run completion.

Measured rings have no perpetual clock. Queued/working signals honor Pause motion, reduced motion and hidden/offscreen suspension. Terminal marks trace once and stop; the report link/navigation deadline is independent of rendering. Canvas initialization/render failure keeps the semantic progress and recovery actions usable. Tests use a renderer stub for scheduling and the actual constructor for partial-init cleanup; browser checks remain necessary for pixels/motion.

The authorized UI checkout is `/Users/sihochoi/Documents/PsychoSight-ui-refurbishment`; use its preview at `http://127.0.0.1:5181/`. The original checkout and port 5173 are reserved for packaging. Review routes still use `?mock=1&freeze=CASE#/run/preview` with the existing boundary/error cases documented above.

## Weekly chart geometry (unit 3A)

`charts/timeline.ts` builds a chronological week index once per report. Supplied calendar dates take priority; validated ISO weeks provide a fallback. UTC day ordinals preserve DST and year boundaries. Absent calendar weeks and absent feature cells remain unknown, with gaps in paths and explicit missing rows in data tables.

`charts/scales.ts` calculates full-report weekly domains: participation 0–100%; one shared rounded positive bound (at most 100%) for the three word rates; separate zero-based count, length and seconds domains. Overall totals do not inflate weekly scales. Unknown metrics retain signed values on a labeled observed domain. `charts/models.ts` joins points by key and supplies a common horizontal gutter. `charts/geometry.ts` owns axes, marks, segments and binary-search hit testing. Displaying fewer rows must retain the model's domain.

`TimelineChart` measures its container with one cleaned-up ResizeObserver and renders SVG labels in the same coordinates as its marks. Dense plots retain all lines and isolated/selected marks. Report-owned pointer preview, click/touch pin and keyboard arrows/Home/End/Escape use those coordinates. Static drawing and table elements are reused during inspection; no report joins or observation-array scans run on pointer movement. “View data” exposes exact full-range values, units, supplied count bases, null reasons and absent intervals. The report-wide interaction owner and window controls are implemented by unit 3B below.

`format.ts` distinguishes cell counts by feature: initiation counts are episodes opened by that speaker, with a percentage denominator only when a returned week/header total establishes it; late-night counts are all episodes opened as basis. Word length uses a word basis, rates use words/turns, and latency uses replies. Null cells retain counts/reasons; absent cells have no fabricated count. Numeric values are preserved exactly in readouts/tables; only axis labels use compact notation.

The dedicated refurbishment clone previews at `http://127.0.0.1:5181/?mock=1&theme=black#/report/ui-omitted-weeks` (also white, single-week, zero, null, 104-weeks and 260-weeks). Geometry/format/component regressions: `npm test -- src/charts src/timeline-chart.test.tsx src/format.test.ts src/report.test.tsx`. Visual evidence and comparisons to the supplied app-demo/HyperFrames s8 are indexed in `docs/UI_IMPLEMENTATION_STATUS.md`.


## Coordinated report overview (unit 3B)

`ReportView` owns the display window, temporary preview, persistent pin and explicit-action announcement. Keying its content by report ID resets inspection and disclosures on a different report. The activity bars and all nine stateless `TimelineChart` panels receive the same calendar window and selected key. Pointer exit restores the pin; only click/tap, keyboard and window actions update the live region. The adjacent Week inspection group provides Previous/Next, arrows, Home/End, Escape and Clear week without per-point tab stops. Panels keep their own exact values/count bases next to each plot.

`charts/inspection.ts` applies All/Latest 52/Latest 13 to calendar coordinates anchored at the final report week, including unknown intervals. The shared selector appears above 52 calendar weeks. An outside pin clears explicitly; domains and supplied overall values/header totals stay fixed. There are no requests, resampling or derived overall averages. Section buttons scroll and focus headings without changing the hash route.

`components/report` separates the compact overview/navigation, activity plot, shared inspection and data disclosure. Both themes use open rules and a two-column feature grid above 1000px; smaller layouts use one column. The overview displays applied header dates/timezone, actual mode/demo status, supplied provider/clamp notes and full-report totals (word totals only when present). Header `episodes_scored` is labeled sent for rubric scoring, matching the schema rather than implying scoring success.

`ChartData` mounts full-range table rows on opening its visible View data disclosure; the labeled region scrolls internally in both directions. All dates, exact values/count bases and null/missing reasons remain accessible regardless of plotted window. This avoids thousands of closed-table nodes: a 260-week browser probe fell from 23,844 to about 1,700 DOM nodes, retaining all 520 activity bars and every line segment. Existing immutable model/geometry reuse remains; the measured interaction did not warrant additional component memoization.

Regression checks: `npm test -- src/charts src/timeline-chart.test.tsx src/report.test.tsx src/report-interaction.test.tsx`. Unit evidence records browser/touch, five responsive sizes, real Chrome 200% zoom, full-suite/build results and supplied brand/HyperFrames comparisons in `docs/UI_IMPLEMENTATION_STATUS.md`. Evidence and experimental ownership is documented below.

Episode detail (unit 3C) uses the existing optional frontend projection of `episodes[]`; the wire/API is unchanged. `charts/episodes.ts` indexes stable episode/week IDs and the report's own quote collection once per immutable report. The activity disclosure starts at the latest visible week with indexed episodes unless a week is already selected. `ReportView` keeps episode, week, and display-window changes together and resets them with report identity. Evidence navigation pins the real episode week, expands/focuses the disclosure, and changes to All weeks only when necessary, with a live announcement. Missing indexes/references preserve the report.

`EpisodeTimeline` uses actual instants on a UTC axis, one row per episode including overlaps and point intervals; exact original timestamps/offsets, per-speaker counts, neutral flags and supplied selection categories remain in the inspector and lazy full table. The bounded diagram/table scroll internally at narrow widths. `scored` means **Selected for scoring**, never rating success; pooled and selected are independent. Main-report evidence never uses experimental quotes. Preview routes `ui-episode-overlaps` and `ui-episode-dense` add 3/96 coherent synthetic intervals, including pooled + selected, overlapping starts and a zero-duration interval. The focused `episodes.test.tsx` covers these semantics and coordinated navigation/reset behavior.


## Scored patterns and observation evidence (unit 4A)

`ScoredPatterns` presents each supplied item on a fixed 1–5 track with its exact mean, agreeing episode count (`n_scored`), null/unstable counts, speaker scope and description. Only an `ok`, finite in-range mean draws a marker. Every item's written 1/3/5 anchors have a native keyboard disclosure. Missing, unstable, skipped, failed and unknown states retain their status/reason without a fabricated score.

`Observations` keeps each supplied claim beside its confidence, supporting episode count, and verbatim evidence. The first quote and total supplied quote count are visible; the rest expand in place. Supporting episode counts are never replaced with quote/reference counts. Quotes retain whitespace, original ISO timestamp/offset and episode context; long unbroken text wraps. Complete limitations/disclaimer and secondary run details/delete controls remain available.

Evidence lookup is explicit: rubric IDs use only `report.quotes`, observations use their supplied `item.quotes`, and the episode inspector uses the indexed main collection. `EvidenceQuote` shares presentation only; experimental evidence stays in its separate existing collection/component. Item/feature references use the existing data keys to focus local headings without changing the route; episode references use unit 3C's real-ID coordinated navigation. Absent references remain readable as unavailable.

Reproducible routes on the isolated 5181 preview: `?mock=1&theme=black#/report/ui-evidence-states` (unstable/insufficient/not-run/failed/null/exact-mean), `ui-evidence-long` (long claims/labels/unbroken verbatim quote, note, missing references), and `ui-evidence-failed` (section failures). Both themes work. `src/evidence.test.tsx` tests data boundaries/states/navigation; visual/keyboard/zoom/reference evidence is indexed in `docs/UI_IMPLEMENTATION_STATUS.md`. Experimental comparisons retain their separate quote collection, as described below.

### Experimental comparisons (unit 4B)

`ExperimentalScores` retains the single closed section at the report bottom; the supplied banner/support and How this works are available while closed. `components/experimental/DimensionRow.tsx` uses paired neutral intervals on the same 0–100 scale, with exact score, band, low/medium confidence, evidence and episode/word basis visible. Null Other is omitted. Missing/failed/not-run/thin speakers never draw a score marker.

Each speaker's keyboard/touch “Why this number” button opens contributions, weekly trend, supplied research citations and experimental quotes in document flow. Effective weights retain stable descending order and use one fixed 0–100% length scale. Observed values retain supplied precision. Quote lookup is a single explicit index of `experimental_scores.quotes`; missing IDs stay labeled. No report quote fallback or literature request is made. Trends use an independently labeled domain, calendar gaps, exact configured note, and a visible table of values/reasons and episode/word basis. The optional Big Five shape retains both uncertainty and speaker cues.

The existing `sample-exp*` previews are unchanged. `http://127.0.0.1:5181/?mock=1&theme=white#/report/sample-exp-details` adds a UI-only synthetic stress preview for explicit/omitted weeks, zero trend, unavailable marker, precise observed value, long verbatim quote/missing ID, and mixed speaker statuses. Tests are `experimental.test.tsx` and `experimental-details.test.tsx`; browser/reference/height evidence is indexed in the unit-4B ledger record. No contract, score algorithm, API, consent or sharing/export behavior changed.

## Picker and consent (unit 5A)

The conversation catalog keeps its last successful result and query together during search, paging and retries. The status distinguishes the initial load, updates with retained rows, an empty catalog, no search matches and failures with Retry. Selection and valid custom dates remain available across pages and refreshes. Both date fields expose the adapter's existing range error; the adapter and request builder remain unchanged.

Consent carries the selected label and requested calendar dates from the existing optional selection record. The complete configured disclosure, provider note and checkbox text retain whitespace at body size. Experimental defaults initialize when config arrives (including saved opt-in links); demo/non-demo defaults and the dependent Other checkbox are preserved. Both original actions share a synchronous submission guard and release it after an error for retry.

Review on the existing clone server at `http://127.0.0.1:5181/?mock=1&theme=black#/` (or `theme=white`). Use search, page controls and date fields, then Continue; verify both analysis actions through progress, report and Saved reports. `#/optin` with no selection offers a conversation link without fabricating context.

Focused checks: `npm test -- src/picker.test.tsx src/optin.test.tsx src/consent-journey.test.tsx src/analysis-request.test.ts src/experimental.test.tsx src/run-submission.test.tsx`. The payload matrix covers demo/non-demo, local/full, experimental availability, both consent choices and exact consent echoes. Unit evidence and rendered brand/HyperFrames comparisons are indexed in `docs/UI_IMPLEMENTATION_STATUS.md`.

Unit 5B supporting screens use the same task heading and action language as the picker/consent. Saved-report loading/errors remain local to their section, preserving conversation access and retained rows. Configuration and report GET failures offer retry. `ReportScreen` owns a keyed report request and deletion lifecycle; successful async report retrieval focuses its heading once, without reacting to chart interaction or theme/config updates. A granted disk-access recheck refreshes the existing catalog request. The native settings, Finder, demo and recheck callbacks are retained.

Deletion uses native `dialog.showModal()` for the top layer and inert background. A small enabled-button Tab cycle covers WebKit's viewport boundary; initial focus is Cancel, and close restores the opener. While pending, Close, Escape and the backdrop dismiss only the dialog. The request continues, its status remains on the report, and **View deletion status** reopens it. Failure stays visible inside an open dialog (or by the original action when closed), with retry. A synchronous ref prevents duplicate delete requests. Navigating away cannot trigger an unrelated redirect when an old deletion finishes.

Development-only synthetic recovery previews (with `npm run dev`, `?mock=1`) accept `&recovery=report-loading|report-error|delete-pending|delete-failure|saved-loading|saved-error|saved-refresh|config-error|submission-error`. Use `#/report/sample-det` for report/deletion previews, `#/optin` for config, and `#/` for saved/submission previews. Initial read failures account for the dev root's Strict Mode effect replay; Retry succeeds. `saved-refresh` retains rows when returning from a report. Deletion previews wait six seconds; the first `delete-failure` attempt fails and the next succeeds. These wrappers never touch the HTTP client and are disabled in production builds. Access callbacks can be reviewed safely at `?mock=1&disk=1#/`.


## Final validation and maintenance (unit 6, 2026-10-29)

Review checkout: `/Users/sihochoi/Documents/PsychoSight-ui-refurbishment`, branch `codex/frontend-refurbishment`. Use port **5181** for this clone; the original checkout and port 5173 belong to separate work. This UI is reviewable and uncommitted. No backend, schema, provider configuration, packaging, dependency, request-builder, adapter, token or identity-asset change was needed.

The final integration pass made two measured fixes: `WeeklyActivity` reuses calendar geometry until rows/domain/width/left margin change (31 selection actions went from 62 Strict Mode rebuilds to zero), and `charts.css` gives open data disclosures an explicit parent width so WebKit keeps wide tables inside their labeled scroll regions. Keep those boundaries when changing selection or disclosure layout. Do not replace exact tables with a sampled window, change full-report totals on window selection, or perform geometry scans in pointer handlers. RAF/observer clocks stay in the LED wrapper; React owns semantic state only.

| Validation | Result / evidence |
| --- | --- |
| Frontend | `npm test`: 360/360, 29 files. `npm run build`: strict TypeScript + Vite, 91 modules. |
| States and layout | 520 core report/progress checks in both themes at 1440×900, 1280×800, 768×1024, 390×844 and 320×844; 280 affected report checks rerun after the geometry fix; 72 combined table/episode checks after the WebKit fix, plus 24 final closed/open composition checks, including 720×450. Recovery, keyboard, full/local journeys, refresh/deep links and exact data also checked. |
| API and contracts | Isolated existing FastAPI + temporary Store, synthetic demo only. Successful smoke-analysis POSTs explicitly set `demo:true`, `llm_opt_in:false`, `mode:"deterministic_only"`, `experimental_scores:false`, `score_other:false`; provider creation was blocked and the private catalog excluded by the external test harness. Actual HTTP and built-UI journey passed; schemas 1.0.0/1.1.0 validated; 28 frozen experimental-contract checks passed; nine disclosure/copy fields matched exactly. |
| Motion and performance | Actual supplied reference segments played; 7.72s in-app LED capture, stable pause pixels, offscreen stop/resume, terminal stop and five resource-clean revisits. Chrome-trace-compatible long-report and before/after geometry recordings are outside Git. No per-frame React LED state or new caching/dependencies. |
| Zoom / touch / hidden / reduced motion | Reused earlier actual browser-zoom, touch, hidden-document and reduced-motion evidence for preserved behavior. Unit 5B's 28 actual zoom states remain hash-matched. New table bounds were also checked at 720×450 CSS pixels; that check is explicitly **reflow**, not a new actual-zoom run. |

Reference provenance: the supplied `frontend-handoff.zip` and nested design/brand/video archives were byte-verified in unit 0. Primary extraction: `/private/tmp/psychosight-frontend-review/frontend-handoff/psychosigh-design/psychosigh-design`; HyperFrames: sibling `video-source/psychosight-video-code`. Rendered brand-kit and app-demo comparisons in both themes confirm pure canvas, supplied static identity, regular Geist, Mono counts, open rules and two readable chart columns. Progress uses the supplied LED material with real seven-stage semantics. Full consent, provider provenance, experimental bands/confidence/evidence/basis and separate quote collections remain visible. The standard report's first feature row begins within 1440×900; progress fits 1280×800. Fresh in-app-browser expanded `sample-exp` is 4,582.12px versus 9,956.23px baseline (53.98% shorter; earlier Chromium result 4,581.72px) with required text sizes/context retained.

All screenshots, synthetic responses, scripts and traces are outside Git at `/private/tmp/psychosight-ui-unit6`: `before-*.png`, `after-*.png`, `led-motion.mp4`, `long-report-trace.json`, `geometry-{before,after}-trace.json`, `led-lifecycle-trace.json`, `browser-matrix.json`, `browser-reports-final.json`, `disclosures-final.json`, `layout-final.json`, `api-smoke.json`, `source-hashes-final.json`, and the test/build logs. The unit-6 record in `docs/UI_IMPLEMENTATION_STATUS.md` indexes the full evidence, earlier zoom/touch/motion sources and acceptance criteria. Temporary evidence paths are machine-local; retain/copy that folder before OS cleanup if needed for later review. Temporary servers are stopped after validation; the shared 5181 preview remains available.

Actual VoiceOver remains **unverified at the human's explicit stop instruction**. Do not restart it or claim a pass. Subsequent browser review used Codex's in-app browser; no new Safari or external Chromium session was opened in unit 6. The installed `/Applications/PsychoSight.app` contains an older web bundle, so current-assets packaged-webview and native permission/Finder behavior are **unperformed**; packaging was not modified. Real-provider analysis was intentionally excluded. These limits do not establish native distribution readiness. Merge, publication and deployment are separate work.
