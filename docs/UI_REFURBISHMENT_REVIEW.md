# Review of the UI refurbishment plan

Reviewed on 2026-10-29, on `codex/frontend-refurbishment`.

Verdict: the architecture and UI-only boundary are sound, but the first draft needed corrections before implementation. The most consequential omission was existing episode data that can support the richer diagrams requested. All findings below have been incorporated into `UI_REFURBISHMENT_PLAN.md`; no application code was changed by this review.

## Findings and revisions

### 1. P1 — The data inventory overlooked the existing episode index

The first plan mapped visualizations from the incomplete frontend `Report` interface. It omitted episode-level report data and proposed only a static pipeline explanation. That would miss a useful opportunity to reflect the video's diagrams despite the data already being available.

Evidence: `schemas/report.schema.json` requires `episodes[]` for both report versions. `psychosight/features.py::episode_index` provides episode ID, start/end, ISO week, initiator, per-speaker messages/words, pooled/late-night flags, and selection metadata. All three checked-in complete report samples contain 191 episodes. `web/src/types.ts` omits the field; `api.ts` returns the full JSON without stripping it.

Revision: type the existing fields in the frontend and add an episode-detail disclosure inside weekly activity, tied to the selected week and evidence IDs. Keep message-level timestamps and numerical selection ranks out because those are unavailable. Degrade cleanly when the index is absent.

Semantic constraint: `episode_index` sets `scored` from membership in the selection map, not verified rating success. Display “Selected for scoring,” with the supplied `random`/`top_signal` category. A pooled flag does not establish exclusion from scoring; the samples contain pooled and selected episodes.

### 2. P1 — Counts could be mislabeled as percentage denominators

The first plan used “denominator/count” and “exact values and denominators” without defining what each field means. A generic inspector could consequently show an incorrect mathematical basis while appearing precise.

Evidence: `_feature_cells` in `psychosight/features.py` computes initiation percentage from opened episodes divided by all episodes, but sets its cell `count` to the speaker's opened episodes. The late-night count also carries all episodes opened as its basis. Words-per-message carries words, not a message denominator. Other features use words, turns, replies, or message totals as appropriate.

Revision: add feature-specific count labels, distinguish supplied count basis from a true denominator, retain counts/reasons for null cells, and test initiation/late-night semantics explicitly. Use existing week/header totals only where they establish a real denominator. Do not change backend calculations.

### 3. P2 — Completion introduced an unnecessary required user action

The first plan replaced automatic report entry with an indefinite completion screen requiring a click. That contradicted its stated preservation of the existing journey and added a behavioral decision to a UI refurbishment.

Evidence: `App.tsx::RunScreen` currently navigates as soon as status is done. The reference LED's success trace/release settles after approximately 1.45 seconds.

Revision: preserve automatic entry after a maximum 1.6-second completion transition, with an immediate “View report” shortcut. Reduced motion and a job first loaded as done enter the report immediately. Navigation is job/route scoped and cleaned up independently of animation callbacks. Failure remains a recovery screen.

### 4. P2 — Scale and dense-report interactions were left to implementation judgment

Allowing any data-responsive percentage scale and deferring a display-window control until late validation could produce inconsistent comparisons and rework. The first draft also did not explicitly distinguish a selected week, plotted window, and full-report overall statistics.

Revision: specify 0–100 participation scales, a common zero-based scale for the three word-rate charts, and stable per-metric domains across selection/window changes. Long reports start with All weeks and offer Latest 52/13-week display windows. Full-report totals remain labeled and unchanged; selection resets are explicit. Dates use calendar arithmetic without DST drift. Unknown future signed data is not clipped by a nonnegative assumption.

### 5. P2 — Visual success was less defined than technical success

The plan was much more specific about modules and tests than the actual compositions. Its blanket reduction of section spacing could also compress the entire product rather than creating deliberate density inside analytical regions. A matching token file is insufficient proof of brand alignment.

Evidence: the supplied `brand-kit/v0.1/agent-design-system.md` requires rendered comparison, an open canvas, contextual density, readable consequences, and a subtraction pass. The HyperFrames `s8-report` composition coordinates charts, evidence, and metadata rather than treating every value as an isolated card.

Revision: add a per-screen composition table, first-viewport checks, an expanded-experimental height target, and rendered comparison gates during each phase. Preserve body-sized critical copy and open page framing. Allow component/CSS extraction only as the view changes; do not make an extensive structural refactor a prerequisite.

### 6. P2 — Polling and session cleanup needed concrete race handling

“Ignore stale responses” alone did not define retry generations, transport cancellation, state reset on ID changes, or completion-timer cleanup. A response from an earlier read could overwrite the current job after a retry or navigation.

Evidence: the current `RunScreen` uses one loop with a stopped flag, and `getAnalysis` has no abort parameter. The existing fetch helper wraps transport errors, so cancellation must be kept distinct when abort support is added.

Revision: use generation guards, reset per-job state, add an optional internal abort signal for GET status reads, and cancel timers/observers on route/ID change and unmount. Preserve endpoint/request payloads. Validate optional UI session metadata and tolerate storage failure. Add race, retry, and terminal-transition assertions to the test plan.

### 7. P2 — Saved-report provider provenance was not explicitly visible

The plan preserved the consent screen's demo-provider note but did not require `run_meta.provider_note` in a saved report. Its provenance could be lost when the report is reopened outside mock mode.

Evidence: this field is defined in the schema, documented in `docs/REPORT_SCHEMA.md`, and already typed in the frontend. It distinguishes offline mock-generated model sections from real-provider results.

Revision: render a supplied report provider note near the overview, independent of the current mock-mode flag, and verify that state with a UI fixture.

## What remains strong

- The scope stays within the frontend and existing server capabilities.
- The supplied LED renderer is reused with its actual API, bounded clock, reduced motion, cleanup, and text fallback.
- Main and experimental results keep their distinct evidence and interpretation boundaries.
- The plan preserves null-versus-zero, uncertainty bands, consent text, both themes, and schema compatibility.
- No generated imagery or additional UI/chart/motion framework is required.

## Review limits and readiness

This was a source/contract and design-plan review. It checked the plan against the actual schema, report samples, relevant frontend/backend implementation, supplied design guidance, and video composition source. It did not establish that the future visual result or animations pass acceptance; those require the rendered implementation.

Only planning documents changed. Application tests/build were not rerun for these documentation changes. The prior baseline result remains historical evidence, not a new test run.

The revised plan is ready for implementation in the stated phases. Review the first complete shell/progress/report slice before extending its visual patterns, using the plan's comparison gates rather than adding another planning cycle.
