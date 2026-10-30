# UI refurbishment: technical implementation plan

Status: implemented and validated on 2026-10-29. Unit 6 evidence and the permitted VoiceOver / current-assets packaged-webview limits are recorded in `UI_IMPLEMENTATION_STATUS.md`; merge and deployment remain separate actions.

Reviewed and revised on 2026-10-29. Audit findings and the reasons for these revisions are recorded in `UI_REFURBISHMENT_REVIEW.md` beside this file.

Branch: `codex/frontend-refurbishment`, created from `9e0a53ec6bdf6e49dbd56d5fb09f3509931023af`. Keep every implementation change and any subsequent commits on this branch. Do not commit or push to `main`.

## 1. Outcome and scope

Bring the existing frontend into close alignment with the supplied PsychoSigh design package and the HyperFrames UI references. The defining improvements are a real LED analysis display, a more useful report overview, coordinated data visualizations, and a coherent visual system across the complete conversation → consent → analysis → report journey.

The UI should reveal more useful information at once while keeping each number, chart, and piece of evidence understandable. Preserve the existing analytical meaning and user choices.

**In scope**

- Layout, typography, spacing, colors, controls, responsive behavior, and both themes.
- React presentation components, frontend state, route transitions, motion, and accessibility.
- Visualizations derived from fields already returned by the API.
- Frontend polling presentation and recovery, without changing the API or job execution.
- Existing picker, consent, progress, reports, experimental details, access help, saved reports, and deletion UI.
- Frontend fixtures, tests, local reference notes, and documentation needed to maintain the result.

**Out of scope**

- Backend code, report schemas, scoring, prompts, provider selection, analysis algorithms, databases, and consent contracts.
- Native application packaging, signing, keys, permissions, or deployment changes.
- New metrics requiring backend computation, new endpoints, cancellation, or streaming progress.
- New sharing/export features, telemetry, external asset requests, or new product workflows.
- Image generation. Use the supplied assets, the supplied LED renderer, CSS, Canvas, and SVG.

Expected source changes are confined to `web/src`, any necessary supplied assets in `web/public`, frontend test/config files only when needed, `web/README.md`, and the UI implementation/review documents. Read backend and contract files to understand behavior; do not edit them.

## 2. Reference hierarchy and current baseline

Use these references in order:

1. Existing API, report, and experimental contracts for data meaning and required copy.
2. The supplied design package for identity, tokens, type, geometry, and LED behavior.
3. HyperFrames motion and screen compositions for hierarchy, density, diagrams, and transitions.
4. The current React application for working interactions and compatibility.

The local handoff is `/Users/sihochoi/Downloads/frontend-handoff.zip`. Its relevant contents are `HANDOFF.md`, `psychosigh-design.zip`, `psychosigh-brand-kit.zip`, and `video-source.zip`. The additional screen archive is `/Users/sihochoi/Downloads/psychosight-main-screens.zip`.

Within the extracted design package, consult `brand-kit/v0.1/tokens.css`, `agent-design-system.md`, `brand-guide.md`, `app-demo/`, and `exploration/{matrix.js,light-processing.js,LED_MATRIX.md}`. Compare the rendered `brand-kit/v0.1/index.html` in both themes as well as reading its source. Within the video source, consult `compositions/s4-picker.html` through `s8-report.html`, `experimental/compositions/e1-optin.html` through `e4-caveats.html`, and the associated CSS. The explainer's approximately 70–80 second progress sequence is the motion reference for the ring, changing stage, and terminal check.

The video is an art-directed composition at 1920 × 1080. Transfer its UI hierarchy and motion language into responsive components; do not port its absolute positions, narrative captions, mock cursor, shortened consent, or simulated timeline.

### Required design-package references

The supplied PsychoSigh design/branding package is the primary visual authority throughout implementation. Use HyperFrames to refine motion, density, and data presentation within that identity. Consult both sources for every visual slice; matching the existing token file alone does not satisfy the reference requirement.

| UI area | Design/branding package reference | Supporting HyperFrames reference |
| --- | --- | --- |
| Every screen | `README.md`, `PSYCHOSIGH_CHANGES.md`, `brand-kit/v0.1/{agent-design-system.md,brand-guide.md,index.html,tokens.css}`, `comparison/COMPARISON.md` | Relevant composition at comparable UI width; source values may be cinematic rather than production sizes. |
| Shell, type, controls, themes | Rendered brand-kit website and its `style.css`; local fonts and theme-specific logos; `app-demo/index.html` and `app.css` | `assets/video.css`; picker/consent compositions for alignment and hierarchy. |
| Analysis progress | `exploration/{LED_MATRIX.md,matrix.js,light-processing.js}` and app-demo progress integration | `compositions/s6-progress.html` and the actual progress animation in the explainer video. |
| Reports and diagrams | App-demo report composition, chart/evidence treatments, and brand guide's open structure | `compositions/s7-pipeline.html`, `s8-report.html`; use existing episode/report data for actual diagrams. |
| Experimental comparisons | Brand typography, neutral structural treatment, controls, and app-demo where applicable | `experimental/compositions/e2-bars.html`, `e3-drilldown.html`, `e4-caveats.html`, and `experimental/assets/exp.css`. |
| Picker, consent, recovery | Brand-kit lists/forms/focused tasks and app-demo states | `compositions/s4-picker.html`, `s5-consent.html`, and `experimental/compositions/e1-optin.html`. |

Locate these paths inside the extracted `psychosigh-design` and `psychosight-video-code` roots. Keep a reusable extraction outside the Git worktree, record resolved roots once, and reuse them. Do not depend on an undocumented temporary path or copy the entire reference website into the application.

Every implementation handoff must identify the relevant design-package source, what was adopted, and any deliberate deviation. Rendered comparisons should include the design package in both themes as well as the relevant video UI; the baseline app alone is not the visual target. This requirement is carried into the executable prompts in `UI_IMPLEMENTATION_PROMPTS.md`.

### Findings that drive the implementation

| Current implementation | Planned correction |
| --- | --- |
| Canonical tokens and bundled fonts are already present; `tokens.css` matches the kit. | Preserve that file as the source of truth; change how components use its tokens. |
| Oversized picker heading and repeated large logo push the conversation list down. | One persistent identity in the shell, compact task heading, search and rows near the top. |
| Consent is a long narrow stack with actions far below the fold. | Better reading width and grouping, selected-conversation context, clear adjacent choices; retain all disclosure text. |
| Progress is a native bar, pixel text, and a long stage list. | Supplied LED renderer plus a compact pipeline, exact counts, meaningful completion and error states. |
| `RunScreen` immediately navigates on `done`. | A brief completion transition with an immediately available “View report” action, followed by automatic report entry. |
| Reports contain nine large, vertically stacked charts. | Summary and weekly activity overview, followed by a coordinated grid of smaller charts. |
| Chart labels use a separate flex row; plotted maximum and displayed maximum differ. | One coordinate system for marks and axes, real time spacing, adaptive ticks, exact inspection. |
| Expanded experimental scores produce a very long report. | Aligned comparison rows with required context visible, details expanded per dimension/speaker. |
| Skip/back-to-top anchors use `#main` in a hash-routed application. | Scroll and focus in place without accidentally changing the application route. |

The earlier review verified the mock UI, both themes, desktop and narrow layouts. The existing frontend baseline passed 36 tests across seven files and a production build during that review. Live API integration and packaged-webview verification remain implementation acceptance work, not previously established results.

## 3. Architecture and file ownership

Keep React 19, Vite, TypeScript, the existing hash routes, and the current API client. Use CSS/SVG for charts and transitions and Canvas only for the LED display. No charting, animation, router, or global-state dependency is needed for this scope.

Refactor by responsibility as each area is changed; avoid a preliminary rewrite of the application.

| Area | Existing files | Planned additions / responsibility |
| --- | --- | --- |
| Shell and shared styling | `components/Shell.tsx`, `styles/app.css`, `main.tsx` | `styles/{base,shell,controls,picker,progress,report,experimental,motion}.css`; keep `app.css` as a deterministic import entry point. |
| Shared UI | Existing repeated markup | Small `PageHeading`, `SpeakerLegend`, and `EvidenceQuote` components where shared. Keep experimental evidence lookup separate. |
| Run lifecycle | `App.tsx`, `api.ts`, `stages.ts`, `components/ProgressView.tsx` | `hooks/useAnalysisJob.ts`, `components/progress/{LedMatrix,StageRail}.tsx`; `stages.ts` remains the pure job-to-presentation adapter. Optional abort signals are internal client plumbing only. |
| LED implementation | Not currently in the app | `brand/led/{matrix.js,light-processing.js,matrix.d.ts,README.md}` copied from the handoff with provenance and documented adaptations. |
| Report overview | `components/ReportView.tsx`, `types.ts` | `components/report/{ReportOverview,WeeklyActivity,EpisodeTimeline,ReportNavigation}.tsx`; type the episode index already returned by the API. |
| Chart system | `components/TimelineChart.tsx`, `format.ts` | `charts/{timeline,scales,models}.ts`, `components/report/{FeaturePanel,WeekInspector}.tsx`. Shared geometry and formatting, not a generic chart framework. |
| Evidence and scored patterns | Inline in `ReportView.tsx` | `components/report/{ScoredPatterns,Observations}.tsx`; preserve report section boundaries. |
| Experimental display | `components/ExperimentalScores.tsx`, `experimental.ts` | `components/experimental/{DimensionRow,ScoreComparison,ContributionPanel,TrendChart,BigFiveShape}.tsx`; retain the existing outer component and helpers. |
| Picker and consent | `components/{Picker,OptIn}.tsx`, `App.tsx` | Presentation-only selection/run context with backward-compatible session data. |
| Verification | Existing `*.test.tsx`, fixtures, `mock.ts` | Focused chart, stage, lifecycle, and integration tests; deterministic UI-only stress fixtures. |

Names above are intended destinations, not a requirement to split trivial markup into separate files. Move styles/components only while changing the associated view; a repository-wide CSS split or component extraction is not a prerequisite. Keep API types in `types.ts`; put derived display models in frontend-only modules. Do not alter wire fields to make a visualization easier.

The existing frontend `Report` interface is a partial projection of the actual response. It omits `episodes[]`, and several rubric/run metadata fields. Consult `schemas/report.schema.json`, `docs/REPORT_SCHEMA.md`, and the sample payloads before declaring a visualization unsupported. Add frontend types for fields being consumed; this requires no backend/schema changes. Treat an absent optional or legacy field as unavailable, not a fabricated empty result.

### State boundaries

- `App` continues to own routing, configuration, analysis submission, and the existing saved-report lifecycle.
- `useAnalysisJob(jobId)` owns one polling loop and returns the last job, initial loading, retrieval error, and a retry action. It does not start or cancel analyses. Reset job/error state on ID changes and guard responses with a request generation so an earlier request/retry cannot overwrite a newer result.
- `ProgressView` derives its display from that job plus optional matching run context.
- `ReportView` owns selected-week and display-window state; overview and feature charts receive the same selection/window. Reset them when the report ID changes, and invalidate a selected episode when its week is no longer selected. Disclosure state stays local to the relevant section.
- The LED instance and its animation clock live in refs/effects, outside React's render loop.
- Preserve existing theme and session keys. Any added session object is versioned, optional, validated on read, and contains only UI metadata—not report bodies or evidence quotes. Store matching context only after a successful create response and key it by returned job ID. Older stored selections and direct links must still work; storage failures fall back to an ordinary usable view.

## 4. Visual foundation

### Tokens, typography, and geometry

- Leave `brand/tokens.css` unchanged. Use its black/white canvas, foreground, secondary text, rules, focus, and accent-text tokens.
- Add component-level aliases only when they reference existing tokens. Do not create another palette or replace the kit with a UI framework.
- Use regular Geist for interface text, Geist Mono for technical labels and aligned numbers, and Geist Pixel sparingly for prominent readouts on black.
- Use tabular numeric alignment and locale-aware number formatting. Retain enough precision to distinguish values; compact axis formatting must have an exact-value equivalent.
- Keep the 1248px content maximum, supplied gutters, 1px rules, 2px control radii, and approximately 48px primary controls.
- Use contextual spacing inside analytical regions: typically 24–32px within groups and 48–64px between related data groups. Retain the kit's open page framing and distinct major-section separation; density is a deliberate exception inside the data region rather than a global compression of the canvas.
- Use the kit's smaller heading range for task screens rather than the display size everywhere. Chart headings must fit dense layouts without shrinking axis/body text beyond legibility.
- Keep open layouts with rules and alignment. Reserve enclosing surfaces for meaningful boundaries, especially the experimental section and dialogs.

### Identity and speaker cues

- Keep the supplied theme-specific wordmark, symbol, and favicon. The wordmark stays static and crisp; the LED treatment belongs to status, not the logo.
- Remove the repeated oversized picker identity and align nav items, demo indicator, theme control, and logo on a consistent baseline.
- Standardize **Me: solid line + filled circle; Other: dashed line + open square** across main charts, legends, experimental bars, and trends.
- Main charts may use Iris as the second graphic color; use the contrast-safe accent-text token for text. Experimental comparisons remain neutral and distinguish speakers through shape/line treatment.
- Do not encode confidence, personality, or wellbeing with red/green, good/bad colors, or diagnostic labels.

### Responsive layout

- Desktop: compact shell; progress uses an LED/status column beside its pipeline; reports use a two-column chart grid.
- Use chart minimum widths around 420px and cap the grid at two columns. Collapse to one column when that width cannot be maintained.
- Narrow view: one reading column, stacked actions where necessary, wrapping metadata, and no page-level horizontal scrolling. Keep the LED around 180px; desktop around 240px.
- Allow intentional scrolling inside a labeled data table. Do not hide layout defects with `.page { overflow: clip }` or truncate important descriptions and consent copy.
- Validate at 1440 × 900, 1280 × 800, 768 × 1024, 390 × 844, and 320px width, plus 200% browser zoom.

### Composition and visual acceptance

Before expanding a changed pattern across the app, capture its rendered state beside the corresponding brand/video reference at a comparable UI width. Record intentional deviations, including two readable chart columns instead of the video's three small columns. This is a review of the implementation, not another user approval step.

| View | Focal point and content arrangement | Visual check using supplied demo content |
| --- | --- | --- |
| Picker | Search and conversation rows; range/Continue remain attached to selection. One static identity in the shell. | Search and first selectable rows are visible in the first 1280 × 800 viewport. |
| Consent | Readable disclosure with adjacent choice grouping; context is secondary. | Copy remains body-sized with a roughly 30–65 character reading measure, both choices are obvious, and no critical text is collapsed. |
| Progress | LED is the focal point; status/count and pipeline share one composition. | LED, current state, pipeline, and navigation fit at 1280 × 800; on narrow screens they reflow in that reading order. |
| Report | Weekly activity leads into the coordinated analytical grid. Summary is a compact supporting strip. | Summary and activity are visible, and the first feature row begins within the first 1440 × 900 viewport with standard-length demo labels. Long content may increase height. |
| Experimental, expanded | Aligned neutral intervals and evidence context; detail expands below the selected row. | Target at least 50% less height than the current expanded sample at 1440px with details closed, preserving all scores and required context at readable sizes. |

Compare type weight/scale, text measures, black/white purity, alignment, spacing, color concentration, and marks—not just token names. Save both themes and one narrow composition at the end of each visual phase. Perform a subtraction pass on redundant helpers, repeated states, and decorative containers. Do not meet density targets by shrinking explanations, hiding qualifications, or clipping content.

## 5. Analysis progress and LED integration

### 5.1 Port the supplied renderer

1. Copy `matrix.js` and `light-processing.js` from the design kit, retaining source comments and any applicable notices. Record archive path, source checksums, and local modifications in `brand/led/README.md`.
2. Add a narrow TypeScript declaration for the used constructor, settings, signals, progress methods, visibility, and observer cleanup. Keep strict TypeScript settings; do not introduce global `any` declarations or disable checking application-wide.
3. Document the small typography adaptation from the renderer's `PlexMono` fallback to bundled Geist Mono. Invalidate and redraw once the font is ready; add no remote font dependency.
4. Start with a 31 × 31 square grid and ellipse aperture for the progress ring, visually matched to the video. Use the supplied lighting defaults as the starting point and tune only documented settings.
5. Preserve the renderer's white emission on black substrate in both app themes. This is an intentional contained LED surface; other components remain theme-native.
6. Do not import the lab UI, image/video upload features, GSAP, HyperFrames runtime, or video assets into the production bundle.

`LedMatrix` should accept presentation props such as `signal`, `progressPercent`, `paused`, and whether a terminal transition should animate. The parent supplies the accessible status text. Canvas is `aria-hidden` when equivalent semantic content is adjacent.

### 5.2 Lifecycle and performance requirements

- Instantiate once per mounted canvas; release it on unmount, including React Strict Mode remounts.
- `configure()` replaces all settings: merge with `DEFAULTS` or the current settings rather than sending partial objects.
- Clear media with `setSource(null)` and call `setSignal()` only when the signal changes. Repeated polling must not restart the native timeline.
- Update finite progress through `setProgress()`. Never send `NaN` or infinity.
- Call `render(deltaSeconds, animate)` with a delta, capped at 0.1 seconds, at no more than 30fps.
- Schedule no frames while the document is hidden. Stop the host clock while offscreen and restart/invalidate when visible; coordinate this with the renderer's intersection observer.
- Stop terminal animation after the supplied trace/release interval and hold a settled frame. Static measured progress can redraw on value changes without a perpetual clock.
- Honor reduced motion with settled frames and no automatic sweep/trace. A pause control stops decorative motion without stopping polling or factual progress updates.
- On cleanup, cancel RAF, remove media-query/visibility listeners, disconnect the renderer's `resize` and `visibility` observers, and any host observer. The renderer has no `destroy()` method.
- Keep the renderer's device-scale cap of 2 and buffer sizing bounds. Catch initialization/render failures once, stop that instance, and retain usable text/native progress.

### 5.3 Job-to-display mapping

| API state | LED / UI behavior | Numerical meaning |
| --- | --- | --- |
| Initial status request | Quiet static/working signal; “Checking analysis” | No invented progress. |
| `queued` | Supplied queued signal and queued label | No percentage. |
| Loading, sessionizing, features, synthesis | Orbit/working signal and active pipeline step | Backend 0/1 flags are stage status, not useful overall completion. |
| Scoring, valid `total > 0` | Progress ring and `current of total episodes` | Percentage applies only to this scoring stage, including the one-episode case. |
| Experimental, valid `total > 0` | Progress ring and `current of total units complete` | Units are finished work units, not model calls, dimensions, or messages. |
| Unknown/zero total | Indeterminate signal and factual stage label | No fabricated denominator, duration, or percent. |
| `done` | Success trace once with “View report” immediately available, then automatic report entry | Analysis finished; individual report sections may still be not run or failed. |
| Job `error` | Failure trace once, then static cross; error text and existing return action | Only the job status establishes analysis failure. |
| Retrieval/network error | Retain last known stage, show “Unable to update status” and Retry | Do not claim the analysis stopped or failed. |
| Unrecognized future stage | Readable fallback label and indeterminate state | Never mark all known stages complete based on an unknown index. |

Validate/clamp drawing inputs defensively; do not silently turn invalid progress into a false 100%. A stage completing at 100% does not mean the run is complete. Do not interpolate numerical counts ahead of server updates or assign equal percentage weights to the stages.

`status` is authoritative for terminal behavior: a stage name or counter alone cannot establish success. Unknown statuses retain an updating/unknown presentation rather than being promoted to completion.

### 5.4 Pipeline and completion behavior

- Preserve all current stages, including experimental. Give each a plain action label, current/completed/upcoming/skipped state, and concise explanatory text.
- In deterministic-only mode, mark scoring and synthesis “Not run.” Experimental deterministic markers may still run; do not skip that stage merely because the main mode is local.
- The job payload does not establish whether experimental analysis was requested. If matching UI request context is absent, show neutral stage status; resolve detailed section outcomes only from the report.
- The backend can overlap experimental work internally. The public job represents one stage at a time; do not invent a live parallel pipeline diagram.
- Retain approximately 500ms polling after each response, with no overlapping requests. Stop on terminal state or unmount and ignore stale results after job changes. Abort the obsolete GET on retry, ID change, or unmount through an optional internal `AbortSignal` parameter in the frontend client. Preserve cancellation separately from a displayed transport failure. Aborting a read never cancels backend analysis.
- Retry a retrieval failure through the existing GET endpoint. Do not resubmit the analysis. Distinguish missing/deleted jobs from transient transport errors.
- Preserve automatic report entry. On an observed running → done transition, show the supplied check/release for at most 1.6 seconds with “View report” available immediately, then navigate. Reduced motion, a job first loaded as done, and revisiting an already completed job go directly to the report. A single job-scoped timer handles this transition independently of animation callbacks; cancel it on route/ID changes or unmount, and do not navigate a different or hidden screen. On visibility return, reconcile the current route/job before navigating.
- Track terminal transitions per job within the session so revisiting does not replay the animation. Failure remains a settled, readable recovery screen and does not navigate to a report automatically.
- Clear/update the active-job link when terminal status is observed. When status is unknown, use neutral “Return to analysis” copy rather than claiming it is still running.
- Preserve conversation/range context only when it matches the job's conversation and stored job ID. Deep links without context show a useful generic heading. Returning to Conversations is navigation, not cancellation.
- Announce stage changes and terminal/retrieval states through a restrained live region. Use semantic progress with `aria-valuetext` for measured stages; do not announce every animation frame.

## 6. Reports and visualization system

### 6.1 Data-to-visual mapping

| Visualization | Existing source | Allowed interpretation / limits |
| --- | --- | --- |
| Conversation summary | `header` | Label, applied dates, timezone, message totals, episodes, weeks, episodes scored; word totals only when supplied. |
| Weekly activity | `weeks[].messages`, `words`, `episodes`, dates | Paired message-volume bars, with exact speaker counts and contextual words/episodes in the inspector. |
| Episode timeline and selection detail | `episodes[]` already present in both report schemas | Actual episode intervals, initiator, speaker counts, and reported selection metadata. This is completed-report detail, not a live message stream or successful-scoring trace. |
| Weekly small multiples | `series[].points`, `overall`, labels, units, count fields | The existing feature values; preserve approximate labels and sample counts. |
| Scored-pattern diagram | `rubric.items[]` | A position on the existing 1–5 anchors, with sample/availability information and linked evidence. |
| Observation evidence | `observations.items[]` | Supplied narrative, confidence, supporting episode count, and supplied references/quotes. No new interpretation. |
| Experimental comparison | `dimensions[].per_speaker` | Score and uncertainty interval on the existing 0–100 index with confidence, evidence, and basis. |
| Marker contribution display | `contributions[]` | Direction, effective weight, source, value, availability, and linked quotes. Weight is not a signed additive change in the final score. |
| Experimental weekly trend | `trend[]` | Independent trend scale, missing values, and weekly episode/word basis. Not comparable to the overall index. |

The payload supports an episode timeline and the reported `top_signal`/`random` selection categories. It does not expose individual message/turn timestamps, numerical selection ranks, or live throughput. Do not invent those. A simple static pipeline explanation can describe stages; its connectors must not imply measured throughput.

### 6.2 Report overview and information hierarchy

Order the report as:

1. Compact conversation title, applied range, mode/demo context, and any range-clamping notice. Show `run_meta.provider_note` when supplied so mock-generated results are identified even when opened as saved reports outside mock mode.
2. A ruled summary strip with a small set of real totals, then weekly activity.
3. Weekly feature grid with shared speaker legend and week inspection.
4. Scored patterns and evidence-backed observations.
5. Limitations, disclaimer, run details, and existing report controls.
6. The separately bounded experimental section, collapsed by default at the bottom.

At 1440 × 900, the summary and useful activity data should be visible in the first viewport. Do not use oversized introductory whitespace to delay the analytical content.

Add compact section navigation for a long report. Scroll to and focus section headings without changing the hash route or stealing focus on ordinary chart hover. Keep navigation usable on narrow layouts and ensure any sticky content cannot cover focused controls.

The activity overview uses paired vertical bars on a shared zero baseline. Both speakers use the same scale. Do not mirror one speaker into negative values. Show exact messages, words, and episodes for the selected week in accompanying text. Distinguish totals for the complete report from the selected week and any display window.

Within the weekly activity region, add a visible “Episode detail” disclosure. When expanded, render the selected week's actual episode intervals on a time axis with initiator cues and counts available on inspection and in a table. Use `episode_id` to link evidence to the matching interval. Dense or simultaneous intervals use separate lanes or an explicitly labeled count aggregate; never move times to make a prettier diagram. Keep word/message content limited to already supplied evidence quotes.

Use `scored`/`selection` as reported selection metadata. In the current backend, `scored` is derived from membership in the selected set; it does not prove successful/stable ratings for that episode. Label the detail “Selected for scoring,” distinguish `random` from `top_signal` selection without implying a numerical rank, and do not draw a success/quality mark. Do not infer exclusion from `pooled`: sample episodes can be both pooled and selected. If the episode index is absent, omit this disclosure while preserving the weekly overview.

### 6.3 Shared timeline and chart geometry

Create pure helpers before changing the chart markup:

- Build a week lookup and chronological positions once per report. Use returned `start_date` as the primary calendar coordinate and a tested ISO-week conversion when only a week key is available. Do calendar arithmetic with UTC day ordinals to avoid DST shifts; do not reinterpret supplied calendar days in the browser's timezone. Timestamp details preserve the supplied offset and state the report timezone where relevant.
- Preserve calendar spacing across absent weeks. Missing weeks are unknown, not zero. Break a line across null values and omitted calendar intervals; never connect across a missing week simply because adjacent array elements exist.
- Join feature points by week key rather than array index. Different series can omit different weeks.
- Share the horizontal time domain across the main weekly charts and activity overview. Each feature retains a unit-appropriate vertical domain; never overlay unrelated units.
- Use one geometry object for plot bounds, ticks, gridlines, marks, hit testing, and selection. Put ticks in SVG coordinates or position them from those same coordinates; remove the independent flex label row.
- Derive displayed y ticks from the actual plotted domain. Use a zero baseline for these nonnegative features and sensible upper ticks; handle an all-zero series explicitly without division by zero.
- Define vertical scale policy by metric: participation percentages (`initiation_pct`, `double_text_pct`) use 0–100; the three word-rate charts share a common zero-based, rounded upper bound computed from their full-report data so small rates remain legible and comparable. That percentage upper bound cannot exceed 100 and must be positive for an all-zero series. Count, length, and latency features use their own zero-based rounded upper bounds. Freeze those domains across week selection and display-window changes. Label every domain/unit; never imply that equal heights across different units are comparable. Unknown future features use an explicitly labeled observed domain, including negative values if present, rather than silently clipping them.
- Keep exact values untouched. Round only display labels using shared formatters; never average displayed rounded values or compute an overall statistic from weekly means.
- Select x ticks from available width, retaining context at both ends without collisions. Tick reduction does not remove underlying observations.
- Render a visible mark for a single valid point, break null segments, and display a plain empty state when no values exist.

All nine current deterministic features remain available. Group them into activity/participation, response patterns, and language patterns if that improves scanning; maintain explicit stable ordering, and append unknown future features instead of silently dropping them.

Each feature panel includes its supplied title/description, approximate status, overall values for both speakers, a readable plot, and a route to exact weekly values/counts. Do not replace all charts with KPI tiles or hide the analytical grid behind a new tab system.

Treat `Cell.count` as a supplied count whose label depends on the feature, not universally as a denominator. The current backend uses words for word-rate/word-length basis, replies for latency, and turns for follow-up turns. For `initiation_pct` it stores episodes opened by that speaker, while the percentage denominator is the total returned week/report episode count. For `late_night_episodes` it also stores all episodes opened by that speaker, not just late-night episodes. `message_count` uses the message count itself. Preserve these values and use truthful feature-specific labels; never write “n of count” unless the denominator is established. Show counts even for null cells, with the insufficient-data reason. Do not change backend calculations or reconstruct missing percentages from rounded numbers.

### 6.4 Coordinated inspection and long conversations

- Hover provides a temporary week preview; click/tap pins a week. Pointer exit restores the pinned selection.
- Keep the same selected week visible across the activity overview and feature panels. Render panel-local exact values and one shared selected-week summary so the user does not have to scroll back to a remote tooltip. Pointer previews do not enter a live region; announce explicit keyboard/click selection only.
- Provide a labeled keyboard week control with previous/next and Home/End behavior, plus a clear selection action. Do not create one keyboard tab stop per SVG data point.
- Expose week dates, each value, unit, correctly labeled count basis, and missing-data reason in readable text. Null and numeric zero must remain distinct.
- Provide an accessible exact-value table, available through a visible “View data” disclosure, with properly scoped headers and caption. The selected-week interaction must not be the only way to get values.
- For dense timelines, retain all line segments; suppress repetitive point marks at high density while keeping the selected point visible. Hit testing still reaches every observation.
- Start with the complete date range. For reports spanning more than 52 calendar weeks, provide one shared display-range select: All, Latest 52 weeks, Latest 13 weeks, with applied dates visible. It filters plotted weeks only, performs no requests, and keeps full-report totals/overall values explicitly labeled and unchanged. Anchor windows to the report's final week; preserve missing intervals. Clear selection if it falls outside the new window and announce that change. Geometry and hit testing use the same window; the data table offers the full range. Do not resample or recalculate feature values.
- Derive lookups and geometry from immutable report data, avoid repeated `find()` scans per point, and observe container width once per relevant chart container. Do not animate all data points on every selection.

### 6.5 Scored patterns and observations

- Replace repetitive prose-only score rows with compact 1–5 anchor tracks, exact score text, sample counts, and status. The anchors and descriptions remain available next to the relevant pattern.
- Unstable, insufficient-data, failed, and not-run items show their actual status; never draw a plausible numeric position for a missing score.
- Keep each observation's supplied text with confidence and supporting episode count. Use aligned typography and rules to make evidence readable, rather than enlarging each item into a decorative card.
- Place supplied supporting quotes adjacent to their claim, with speaker, timestamp, and episode metadata. Preserve text exactly and wrap long/unbroken content.
- Use `feature_keys` and `item_keys` for optional local navigation to supporting sections only when the referenced item exists. Do not invent new evidence or imply every referenced episode has a quote.
- Progressive disclosure may reduce repeated quote volume, but a visible evidence count/action must make the supporting material discoverable.
- Preserve limitations and disclaimer text in full. Run/provider details remain secondary but reachable.

## 7. Experimental scores

Preserve the existing contract boundary: one collapsed section at the report bottom, banner visible while collapsed, support copy and “How this works” retained, no experimental content mixed into Observations.

### Summary layout

- Keep all twelve current dimensions in their existing families and order.
- Use one aligned row per dimension: label/evidence, speaker comparison tracks, exact scores with uncertainty-band text, confidence, and episode/word basis. Long labels wrap without shrinking excessively.
- Use two compact speaker rows aligned to the same 0–100 coordinate system. Show the interval and marker clearly; retain filled-circle/open-square identity in neutral colors.
- Required context remains visible whenever a score is visible: band, low/medium confidence, evidence strength, and “based on … episodes / … words.” Do not hide those in a tooltip or only inside the drilldown.
- Keep the verbatim scale note near the comparison. Do not add percentile interpretations, threshold lines, gauge treatments, population-average claims, or evaluative high/low score labels.
- When `per_speaker.other` is null, omit that person's score column/row. Do not fill it with zero or an insufficient-data message.
- Preserve the optional Big Five shape behind its explicit toggle, with uncertainty and matching speaker cues; the aligned comparisons remain the primary reading surface.

### Details

- Expand a dimension/speaker to inspect “Why this number,” trend, citations, and evidence. Expanded content participates in document flow and remains usable with keyboard and touch.
- Retain descending effective-weight order with stable ties from `sortedContributions`.
- Show direction as a labeled arrow, weight as a small neutral horizontal length, and the original observed value/unit beside its source label. Encode weight on the same 0–100% length scale for all active markers; do not renormalize a filtered/expanded subset. Do not draw a waterfall that suggests the weights sum to the displayed final score.
- Show unavailable markers as “Not run” or “No data”; do not silently drop them.
- Resolve experimental quote IDs only against `experimental_scores.quotes`. Never substitute a top-level report quote.
- Display supplied evidence notes and citations in the detail area. Do not fetch external literature during normal report rendering.
- Render weekly trends with their own labeled domain and the exact configured trend note. Show bounds, values, missing data, and basis; do not describe a trend as above/below the overall index.
- Preserve `not_run`, `failed`, and `insufficient_data` section/speaker messages and the existing required insufficient-data wording. A failed experimental section must not hide the rest of a successful report.

This phase should materially shorten the default expanded section through alignment and disclosure, while retaining every result and its required qualifications.

## 8. Picker, consent, and supporting screens

### Conversation picker

- Put the task heading, search, count/status, and conversation rows at the top of the content area.
- Retain debounced server search, page size controls, previous/next paging, stale-response protection, and selection across search/pages.
- Align conversation names, message counts, latest dates, and selection cues into readable columns; stack metadata on narrow screens.
- Preserve disabled group conversations and their visible explanation. Do not rely on hover-only tooltips.
- Present the selected conversation, range fields, validation, and Continue action as a coherent group beside or below the list.
- Preserve range bounds, full-range reset, dates-unavailable behavior, and all `conversation-adapter.ts` rules. Use calendar date strings without timezone drift.
- Add appropriate `aria-invalid` and field/error associations. Do not wipe a valid custom date range when refreshing metadata or paging.
- Make initial loading, refresh-in-place, empty catalog, no search matches, and failed load visually distinct. A refresh should preserve useful rows and selection.
- Style saved reports consistently and use accurate active-job/resume copy.

### Consent

- Carry the selected conversation and requested range into the screen through frontend metadata. Preserve old session records and direct-link fallback.
- Arrange the complete primary disclosure and the experimental choices in a clearer hierarchy, with both analysis actions visually associated with their consequences.
- Render all config-supplied strings verbatim. Preserve whitespace/paragraph structure without paraphrasing, truncation, or hidden critical copy.
- Preserve demo-only default selections, non-demo defaults, the dependent “score other” checkbox, `experimental_enabled`, and request consent echoes.
- Keep the two existing submit paths and their request semantics. Preserve busy/disabled/error behavior; prevent duplicate submission.
- The demo provider note remains visible when supplied. Do not describe a configured remote analysis as local.
- Avoid a sticky action bar that covers disclosures or form controls on small screens.

### Access help, saved reports, errors, and deletion

- Apply the same heading, action, spacing, and status treatment to `DiskAccess`, config failures, report loading/not-found, saved reports, and submission errors.
- Keep all existing settings/recheck/reveal/demo callbacks and native behavior untouched.
- Make async report content receive appropriate heading focus once available; do not repeatedly focus the heading on polling or chart updates.
- Retain deletion confirmation and existing delete request. Improve dialog focus containment, initial/return focus, background interaction, pending state, and error visibility.
- Exclude disabled controls from dialog tab cycling. Do not leave users trapped when deletion fails or close the dialog as if deletion succeeded.

## 9. Motion and interaction specification

| Element | Motion | Reduced-motion / static behavior |
| --- | --- | --- |
| Buttons, fields, disclosure cues | Kit's 160ms feedback; focus remains immediate | No transition required. |
| Active progress label | Brief opacity and small vertical transition, approximately 160–240ms | Immediate label update. |
| Indeterminate LED | Supplied quiet queued/orbit signal, bounded clock | Settled frame and readable stage text. |
| Measured LED | Reflect actual server value; optional visual easing cannot exceed it | Immediate actual value. |
| Terminal LED | Native one-time trace and release, then stop | Settled success/failure mark. |
| Report appearance | Short restrained section entrance if useful | Content available immediately. |
| Chart selection | Immediate marker/readout update; no animated numerical interpolation | Identical behavior. |
| Evidence/detail expansion | Immediate or short opacity treatment; no long height choreography | Immediate expansion. |

No count-up animation for factual report totals, sweeping fake analysis, endlessly pulsing completed states, animated logo, or scroll-triggered effects that conceal data. Content visibility and focus must never depend on an animation-end callback.

## 10. Implementation sequence and review gates

Each phase ends with a buildable UI and a small focused diff. Use descriptive commits on `codex/frontend-refurbishment` if committing; implementation does not require a main-branch merge or publication.

Execute the prompt pack through its coordinator Goal. It creates one implementation chat per unit with a separate scoped Goal, waits for the current Goal and required verification to finish, then opens the next chat. At most one unfinished implementation unit may be dispatched. Incomplete checks, interrupted work, or a budget stop cannot advance the queue. The coordinator Goal completes only after every unit, including final validation, is verified complete. See `UI_IMPLEMENTATION_PROMPTS.md` for exact ordering and lifecycle checks.

### Phase 0 — Freeze the reference and test baseline

- Confirm branch and working-tree state, preserve unrelated work, and record current baseline tests/build.
- Retain the existing review captures as the baseline where still current; complete missing mock captures for picker, consent, scoring, report overview, and expanded experimental scores in both themes. Record that the current UI redirects immediately on completion rather than presenting a completed view.
- Record source provenance and the video details being carried forward. Keep heavyweight archives/videos and personal conversation data out of Git.
- Verify the response inventory against the actual schema/samples, including `episodes[]` and count meanings. Measure expanded experimental height with details closed for the comparison target.
- Add deterministic fixture variants needed for boundary states and long timelines, under the frontend fixture directory. Do not edit canonical backend samples to fit the visuals.

**Exit:** reproducible before-state, known contract invariants, and usable mock URLs for review.

### Phase 1 — Establish the shared visual foundation

- Implement shell, task-heading, control, spacing, theme, and speaker conventions.
- Move CSS only as its component changes; remove superseded rules rather than accumulating overrides.
- Fix in-page navigation/focus without changing routes.
- Compare the rendered shell and one complete task composition against the rendered brand reference in both themes and at a narrow width before spreading those decisions through the app.

**Exit:** existing screens still function in both themes and at narrow widths; tokens and supplied identity remain intact.

### Phase 2 — Build the signature progress experience

- Vendor and wrap the LED renderer, implement lifecycle/reduced motion/fallback behavior.
- Add pure stage mapping, extract the single polling hook, and build the compact pipeline.
- Implement correct known/unknown progress, transport-error retry, bounded terminal transition, automatic report entry with an immediate shortcut, and matching run context.

**Exit:** every job state is truthful and navigable; renderer resources stop and clean up; no request or server behavior changes.

### Phase 3 — Build the report overview and chart system

- Implement shared week/domain/axis helpers with focused tests.
- Type the existing episode fields and build the episode-detail disclosure within weekly activity, including selected-episode metadata and evidence linking.
- Build summary, weekly activity, two-column feature grid, linked inspection, long-report display ranges, and exact-value tables.
- Fix null gaps, actual calendar spacing, y-axis mismatch, tick collisions, and long-range readability.

**Exit:** shell + progress + report overview form the first complete visual review milestone. All existing deterministic metrics remain accessible, with exact values and correctly labeled count bases. Check the first-viewport compositions against section 4 before moving on.

### Phase 4 — Refine evidence and experimental analysis

- Implement scored-pattern tracks and better observation/evidence layout.
- Refactor experimental dimensions into compact aligned comparisons and expandable contribution/trend detail.
- Retain every required copy/state/band/confidence/evidence rule, optional shape, and quote boundary.

**Exit:** dense analytical content is readable without repeated oversized blocks, the expanded-section height target is assessed without reducing required text, and all existing experimental contract tests still express and verify their original guarantees.

### Phase 5 — Complete the surrounding journey

- Finish picker, range controls, selection context, consent hierarchy, saved reports, access help, errors, and deletion dialog polish.
- Validate that the entire flow uses the same control and spacing language and preserves request payloads.

**Exit:** the experience is coherent from initial selection through report review and deletion, including failure and local-only paths.

### Phase 6 — Validate and hand off

- Run the focused automated suite and production build, then execute the browser/state matrix below.
- Inspect real motion and resize behavior; still screenshots cannot establish animation quality.
- Smoke-test against the existing API using synthetic/demo data and deterministic-only mode for a no-provider check. Real-provider analysis is not necessary to validate the new rendering.
- Verify the built assets in the existing packaged webview when available, without modifying packaging. Clearly record any host-specific verification that remains untested.
- Update `web/README.md` with preview states, component responsibilities, LED lifecycle, and review instructions.
- Produce before/after mock screenshots and a brief motion capture; confirm final diff is UI-only and all work remains on the feature branch.

**Exit:** acceptance criteria pass, residual limitations are documented, and the implementation is ready for review. Merge/deployment is a separate action.

## 11. Verification strategy

### Automated checks

Run `npm test` and `npm run build` from `web`. Add targeted tests for changed behavior rather than snapshots that merely mirror the markup.

| Area | Required assertions |
| --- | --- |
| Chart helpers | Same geometry for axes/marks, aligned week joins, year-boundary ISO weeks, DST-safe date positions, omitted-week gaps, all-null, all-zero, one-point, dense timeline, fixed policy domains across display windows, no mutation of source data. |
| Main report | All features remain present; exact zero vs null; truthful feature-specific count labels including initiation and late-night counts; counts for null cells; selected-week/window synchronization and reset on report changes; accessible table; unstable/skipped states; range clamp and provider notes. |
| Episode detail | Present/absent index, real timestamps/counts, time overlap, stable IDs, selected week, selected-for-scoring labels without inferred success or rank, pooled+selected combination, missing evidence references, and exact-value table. |
| Stage mapping | Queued, every stage, local skips, experimental unknown/zero/one/many units, invalid progress, unknown stage, job failure, terminal state. |
| Polling and completion | One active loop, obsolete GET aborted, aborted reads not shown as errors, out-of-order retry results ignored, reset/cleanup on ID changes, retry without POST, terminal stop, immediate report CTA, automatic report entry within 1.6s, immediate entry for reduced motion/already-done, and stale/hidden-screen timer guards. |
| LED wrapper | Signal not reset each poll, changed progress passed through, reduced-motion/pause behavior, terminal settling, visibility scheduling, cleanup and rendering fallback. Use a renderer stub in JSDOM; assess actual pixels in the browser. |
| Picker/consent | Existing pagination/search/selection/date rules, exact supplied copy, checkbox dependency/defaults, enabled flags, unchanged request shapes, busy/error behavior. |
| Experimental | Collapsed boundary and banner; all dimensions; band/confidence/evidence/basis; other-null; section/speaker statuses; independent trend scale/note; correct quote source; contribution sorting; no forbidden interpretations. |
| Navigation/dialog | Skip/back-to-top retain route, heading focus after async load, keyboard disclosures, delete cancel/confirm/pending/error and focus recovery. |

Adapt selectors when markup changes, but do not weaken assertions about consent, data meaning, or experimental boundaries to make a redesign pass. Preserve compatibility with both schema 1.0.0 and 1.1.0 reports.

### Browser review matrix

Use existing mock routes, including:

- `?mock=1`, `?mock=1&disk=1`, and the complete mock picker → consent → run journey.
- `?mock=1&freeze=scoring#/run/preview`, `freeze=experimental`, `freeze=done`, and `freeze=error`.
- `?mock=1#/report/sample-full`, `sample-det`, and `sample-clamped`.
- Experimental samples: `sample-exp`, `sample-exp-live`, `sample-exp-real`, `sample-exp-det`, `sample-exp-me`, `sample-exp-failed`, `sample-exp-notrun`, and `sample-exp-thin`.
- Add frontend-only preview cases for queued, retrieval failure/recovery, zero totals, a single week, all-zero values, long labels, and at least 104/260 weekly points. Ensure the completed preview links to an actual mock report.
- Include reports opened outside mock mode with a supplied provider note, an absent episode index, pooled+selected episodes, and null feature cells with nonzero count bases. Preview the long-report display windows and check that full-report totals remain unchanged.

Exercise both themes, standard/reduced motion, keyboard-only and touch/pointer interaction, all target widths, 200% zoom, refresh/deep-link/back navigation, and hidden-tab/offscreen resume. Check no clipped focus rings, chart-label collisions, page overflow, console errors, or unintended network asset requests.

Check text/graphic contrast and focus visibility against the supplied themes, and manually exercise VoiceOver through the stage announcements, week inspector/table, disclosures, and deletion dialog. Check reading order as well as visual order after responsive stacking.

For dense reports, inspect a browser performance recording: no per-frame React render from the LED, no accumulating observers/timers after revisits, no repeated geometry scans on pointer movement, and no sustained animation work when hidden or settled. Compare with the baseline rather than claiming an arbitrary performance score.

Live API smoke verification should validate the existing contract and UI recovery, not create new backend requirements. Avoid screenshots or checked-in artifacts containing personal messages; use the supplied synthetic/demo material for visual review.

## 12. Completion criteria

- [x] Work is on `codex/frontend-refurbishment`; no commits or pushes to `main`.
- [x] No generated imagery, remote fonts, or unnecessary runtime dependencies.
- [x] Supplied brand tokens and static theme assets are preserved and applied consistently.
- [x] The LED ring is integrated into real analysis state with bounded motion, cleanup, accessibility, and fallback behavior.
- [x] Completion preserves automatic report entry, with immediate access and no extra required user decision.
- [x] Progress never invents an overall percentage, elapsed estimate, pipeline throughput, or cancellation behavior.
- [x] The report's first viewport contains useful summary/activity information.
- [x] All existing metrics remain available through readable small multiples, coordinated inspection, and exact data access.
- [x] Existing episode metadata supports an accurate detail timeline; absent data degrades cleanly, and selection is never presented as successful scoring.
- [x] Missing weeks, null values, zero, sample counts, units, approximate labels, and uncertainty retain their meaning.
- [x] Evidence and experimental sections are more compact without removing required context or mixing quote sources.
- [x] Picker, consent, access help, saved reports, errors, and deletion preserve existing behavior and use the same visual language.
- [x] Desktop, narrow layouts, keyboard access, reduced motion, both themes, and long reports pass review.
- [x] Relevant frontend tests and production build pass; live API and host-specific verification status are recorded accurately.
- [x] Documentation, before/after evidence, and a UI-only diff are ready for review.
- [x] Compositions are compared against rendered brand/video references during each visual phase, and the measurable density targets are assessed without hiding required context.

Evidence for these checks is indexed in the unit-6 acceptance table in [UI_IMPLEMENTATION_STATUS.md](UI_IMPLEMENTATION_STATUS.md). The checks include reused valid actual-zoom/touch/reduced-motion/hidden-document evidence, fresh in-app-browser validation and the final table-containment repair. They do not claim actual VoiceOver (stopped by the human) or current-assets packaged-webview verification (installed bundle is older). New table bounds additionally passed at 720×450 CSS pixels; that is reflow, not a new browser-zoom run.

The finished implementation should feel like the same product expressed with the precision of the design kit and the information density of the HyperFrames UI, using only the data and capabilities the application already has.
