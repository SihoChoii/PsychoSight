# Codex implementation prompts for the UI refurbishment

> Execution checkout update, authorized by the human on 2026-10-29: continue the existing sequence in `/Users/sihochoi/Documents/PsychoSight-ui-refurbishment`, a dedicated ordinary clone on `codex/frontend-refurbishment`. The original `/Users/sihochoi/Documents/PsychoSight` checkout is reserved for competing packaging work. Keep the saved PsychoSight project ID `32dda25c-7462-44b8-ba38-58e7e9b642ea` for chat grouping, but explicitly use the dedicated clone for every command and UI artifact. Continue the SAME Unit 2B chat and actual Goal; create no replacement chat. Prior verified units 0/1/2A and their evidence remain valid; the clone was byte-verified and its 147 tests/build passed. This authorization changes the working directory only; all sequence, Goal, UI scope, no-worktree/no-agent/no-image-generation/no-commit/publish rules remain in force.

These prompts implement the revised `UI_REFURBISHMENT_PLAN.md`. This file is an execution guide; creating it does not start implementation.

Use the coordinator Goal prompt below to run the complete sequence. It opens a separate implementation chat for each unit, one at a time, in the same checkout. A unit chat owns exactly one unit and a Goal scoped to that unit. Its execution ends after verified completion; only then may the coordinator open the next chat. Existing chats remain available for inspection.

Each unit prompt can also be pasted into a chat to run just that unit under a Goal. “Complete” means the scoped outcome and its required verification are achieved—not merely that a response ended. Review gates are tests and visual self-review, not routine user approval between units.

## Coordinator Goal prompt — strictly one chat at a time

```text
/goal Complete the PsychoSight UI refurbishment by executing all twelve implementation prompts in separate chats, STRICTLY ONE BY ONE, with a separate scoped Goal per implementation chat and verified completion before the next chat starts.

Work in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Read the Coordinator execution protocol and Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Use their real goal/chat tools and completion checks; do not simulate them with headings or status prose.

This chat is the coordinator. I authorize you to create the twelve implementation chats for this work and send follow-up instructions to the current implementation chat when needed to finish or repair its assigned unit. Use the saved project matching this repository, the same local checkout, and codex/frontend-refurbishment. Resolve its project ID through list_projects. Keep the configured model and reasoning defaults. Do not create worktrees or additional agents.

Run exactly this sequence: 0 → 1 → 2A → 2B → 3A → 3B → 3C → 4A → 4B → 5A → 5B → 6. Unit 0 is prompt 1 of 12. Create ONLY the current unit's chat; do not pre-create or queue later chats. Wait until its actual Goal is complete, its execution has ended, and its evidence passes the coordinator completion check before creating the next chat. Never run two implementation chats at once. The coordinator does not implement concurrently with the unit chat.

If the current unit needs attention, fails verification, stops before completing its Goal, or hits a usage/budget limit, keep the sequence at that unit. Repair or continue in that SAME chat when authorized and supported. Do not skip it, start a replacement in parallel, mark it complete to move on, or bypass user pause/stop or platform limits. Resume from the recorded cursor and actual chat state without duplicate dispatch.

Use the supplied PsychoSigh design/branding package as the primary visual reference and HyperFrames as the motion/data-presentation reference. Preserve the audited API/data meaning. Write clean, efficient React/TypeScript with minimal state, small purposeful components, and focused tests. Finish each unit as a working slice before moving on.

Keep all work on codex/frontend-refurbishment. Scope is UI only. Do not use image generation. Do not commit, push, merge, or deploy unless separately requested.

Keep this coordinator Goal active until all twelve units are verified complete, no implementation chat remains running, and the final unit-6 handoff is recorded. Then mark this Goal complete and report the results with links to the created chats and final artifacts.
```

## Coordinator execution protocol

Goals belong to individual chats; a Goal does not itself migrate into a new chat or automatically dispatch another one. The coordinator therefore owns the sequence Goal, and each implementation chat creates its own scoped Goal. This follows the [official Goals lifecycle](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex); the app's available tool contracts govern chat creation and waiting.

### Fixed queue and concurrency invariant

The coordinator may remain active while waiting, but there must be **at most one unfinished dispatched implementation unit**. A completion announcement, timeout, idle turn, stopped chat, or ledger checkbox alone cannot advance the queue.

| Prompt number | Unit | New implementation chat title |
| --- | --- | --- |
| 1 of 12 | 0 | PsychoSight UI 01/12 — Baseline and references |
| 2 of 12 | 1 | PsychoSight UI 02/12 — Visual foundation |
| 3 of 12 | 2A | PsychoSight UI 03/12 — Job lifecycle |
| 4 of 12 | 2B | PsychoSight UI 04/12 — LED progress |
| 5 of 12 | 3A | PsychoSight UI 05/12 — Chart geometry |
| 6 of 12 | 3B | PsychoSight UI 06/12 — Report and charts |
| 7 of 12 | 3C | PsychoSight UI 07/12 — Episode diagrams |
| 8 of 12 | 4A | PsychoSight UI 08/12 — Evidence |
| 9 of 12 | 4B | PsychoSight UI 09/12 — Experimental comparisons |
| 10 of 12 | 5A | PsychoSight UI 10/12 — Picker and consent |
| 11 of 12 | 5B | PsychoSight UI 11/12 — Recovery and deletion |
| 12 of 12 | 6 | PsychoSight UI 12/12 — Validation and handoff |

### Dispatch, wait, verify, advance

1. **Initialize or resume the coordinator Goal.** Use `get_goal` and, when needed, `create_goal` with the sequence outcome above. A `/goal` launch may already have created it. Reuse the matching active Goal; do not replace an unrelated unfinished Goal. Set no token budget unless the user requests one. Inspect the coordinator queue record, unit ledger, and any previously dispatched chat before choosing the current unit.
2. **Resolve the shared checkout.** Call `list_projects`, find the project whose saved path matches `/Users/sihochoi/Documents/PsychoSight`, and select its local environment. Confirm the existing feature branch and preserve dirty/untracked files. All unit chats use this same checkout so previous units' uncommitted changes are available. Do not use a detached/default-branch worktree or an unrelated project as a fallback.
3. **Dispatch only the current unit.** Before creation, persist the current unit and a unique dispatch ID in the coordinator-only queue file described below. Use `create_thread` with that project ID, `environment: { type: "local" }`, the corresponding title, and the child prompt constructed below, including the dispatch ID. Leave model/thinking unspecified. Do not create the next chat while this one is starting, running, awaiting verification, or needs attention. If creation returns only a pending client ID, resolve the existing creation through app status/listing before using tools that require a real thread ID; do not repeat creation to recover an uncertain response.
4. **Record identity before further dispatch.** In the coordinator queue, save the returned real thread ID and host when known, prompt number/unit, current sequence cursor, dispatch ID, and state. If a call was interrupted before identity was saved, inspect accessible chats and recover the matching project/title/dispatch ID before creating anything new. If recovery is ambiguous, leave the cursor unchanged and report the ambiguity rather than risking duplicate execution. Only the coordinator writes the queue; unit chats write their evidence into the separate status ledger.
5. **Wait on that one chat.** Use `wait_threads` with a single target and retain its cursor. Use waits no longer than 60 seconds so meaningful updates can be given. After an ordinary timeout or continuing Goal turn, keep waiting on the same target. Use `read_thread` only for completion evidence, a specific problem, or recovery; avoid repeated full-history reads. Do not implement UI or write the unit ledger while the child is actively editing it.
6. **Handle incomplete work in place.** A chat requesting input, returning early, failing a check, or reaching a usage/budget stop is not complete. Keep the sequence cursor unchanged. If a normal follow-up can finish or repair the unit, use the human-authorized `send_message_to_thread` on this same chat after its current turn has ended. Never manufacture a Goal resume or bypass user/platform stops; use the supported lifecycle controls and surface the actual limitation. If tools or project resolution cannot support this workflow, report that obstacle and leave later units undispatched.
7. **Verify completion before advancing.** Require the child receipt below, actual `update_goal` success reporting `complete` in its tool history, an ended child turn with no further work running, and the recorded files/check evidence required for that unit. Read the relevant artifact/diff and check command/evidence records; do not rerun every unchanged passing test. Missing required verification or remaining required work fails this gate. An accurately documented optional host-specific check may remain unperformed if the plan permits it. If implementation is missing, send the same chat a repair instruction and have it create a new scoped repair Goal if the old one was already completed. Do not start the next unit until that repair also passes.
8. **Advance one position.** Only after the completion gate passes, update the cursor and verified unit record, then create the next unit's chat. Repeat steps 3–8. After unit 6 passes, verify all twelve records and no running implementation chat, then call `update_goal` with `status: "complete"` for the coordinator Goal. Retain the unit chats; ending execution does not delete or archive them.

The coordinator and unit chats must obey the actual Goal tools' pause, blocked, completion, and budget rules. Ledger labels such as `needs_attention` do not authorize changing a Goal lifecycle state. Do not mark a Goal complete because a budget is nearly exhausted or because a turn is ending.

### Durable state and ownership

- `/Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_QUEUE.json` is the coordinator's small execution record: workflow ID, fixed ordered unit IDs, current cursor, current dispatch ID/chat ID/host/state, wait cursor, and verified completion records. Persist it before/after dispatch so a resumed coordinator can recover rather than creating a duplicate. Only the coordinator writes it.
- `/Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_STATUS.md` contains unit implementation, test, and visual evidence. Each current unit chat updates only its own record and preserves earlier records. The coordinator reads it for verification after the child ends. It is not a second queue.
- Verify runtime chat/Goal evidence as well as these files on resume. A `complete` label in either file does not itself prove completion. If another coordinator is already handling this same workflow, do not dispatch from a second coordinator.

### Child prompt template

Create each chat with this preamble followed by the selected unit's complete prompt text from this file. Substitute only the current ordinal/unit/title; do not send the full queue as an implementation assignment.

```text
You are the implementation chat for prompt <N> of 12, unit <UNIT>, dispatch <DISPATCH_ID>, in the PsychoSight UI refurbishment. The human requested a separate scoped Goal and STRICTLY ONE-BY-ONE execution. Implement only this unit in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment on codex/frontend-refurbishment.

Read the Shared execution contract and Unit Goal lifecycle in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md, then execute the unit prompt appended below. Use get_goal/create_goal to establish an actual Goal in this chat for this unit's required outcome and verification. Keep that Goal scoped to this unit. Do not merely print a goal, and do not create the next chat, dispatch another agent, or implement a later unit.

Continue working on the current unit until its required implementation and checks are achieved or a genuine limitation requires human attention, following the Goal tools' lifecycle rules. Record evidence and the completion receipt. After actual Goal completion, return the final receipt and END THIS CHAT'S EXECUTION. The coordinator alone verifies the result and opens the next chat. Do not message the coordinator or any other chat; write the agreed ledger record and final response for it to read.

<PASTE THE COMPLETE CURRENT UNIT PROMPT HERE>
```

### Unit Goal lifecycle and receipt

In each unit chat:

1. Read the selected unit, its prerequisites, and shared constraints. Call `get_goal`; reuse a matching unfinished unit Goal or call `create_goal` with the concrete unit outcome plus required verification and boundaries. Do not set a token budget unless requested. Do not replace unrelated unfinished Goals.
2. Perform only this unit, with the code quality, brand-reference, and evidence requirements below. Continue across Goal turns when work remains. Prerequisite checks can fix a small related defect, but do not absorb later units.
3. Record implementation, verification commands/results, evidence paths, branch, unresolved required work, and available chat identity in the shared status ledger. Use `needs_attention` in the ledger for incomplete work; do not emit a success receipt or advance the queue.
4. When the scoped outcome and all required checks are actually satisfied, call `update_goal` with `status: "complete"`. Verify its returned state; never claim completion if it failed. Include that actual result in the receipt. Then end the turn with a final response and perform no next-unit work.

Use this final receipt after successful completion:

```text
UNIT_COMPLETE
prompt_number: <N>/12
unit: <UNIT>
dispatch_id: <DISPATCH_ID, or standalone if run individually>
goal_status: complete (confirmed by update_goal tool result)
branch: codex/frontend-refurbishment
implementation: <brief outcome and changed files>
verification: <exact checks and their results>
visual_evidence: <paths and adopted brand/video references; not applicable for nonvisual work>
remaining_required_work: none
permitted_unperformed_checks: <none, or explicitly optional check with reason>
ledger: /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_STATUS.md
next_unit_started: false
```

The literal receipt is an index to evidence, not proof by itself. The coordinator must verify the recorded Goal tool result and required work before dispatching another chat.

## Shared execution contract

### Scope, references, and branch

- Working directory: `/Users/sihochoi/Documents/PsychoSight-ui-refurbishment`. Before editing, inspect branch/status and applicable `AGENTS.md`. Use the existing `codex/frontend-refurbishment` branch; switch safely if necessary. Preserve unrelated changes and untracked planning files; never reset or discard work to obtain a clean checkout.
- The authoritative specification is `/Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_REFURBISHMENT_PLAN.md`. Read sections 1–4 and the audit in `/Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_REFURBISHMENT_REVIEW.md` once per fresh context, then read the unit's relevant sections. Refer back when needed; do not repeatedly reread the entire archive or all future units.
- Change only frontend code/assets/tests and UI documentation. Keep backend, schemas, scoring, prompts, consent semantics, endpoints, native packaging, provider configuration, and deployment untouched. Frontend types may expose fields already in the response. Internal abort signals may be added without changing the wire contract.
- Keep React/Vite/TypeScript and existing test tooling. Use existing dependencies, CSS, SVG, and the supplied Canvas renderer. No image generation, new chart/motion/UI framework, remote fonts, or copied video runtime. No commits, pushes, merges, or deployment unless explicitly requested.
- Use the design/branding package as the primary visual authority: `README.md`, `PSYCHOSIGH_CHANGES.md`, `brand-kit/v0.1/{agent-design-system.md,brand-guide.md,index.html,tokens.css}`, `comparison/COMPARISON.md`, and relevant app-demo/LED files. Inspect the rendered brand reference, including both themes, before visual implementation. Do not substitute a generic dashboard template.
- Sources are in `/Users/sihochoi/Downloads/frontend-handoff.zip`, including nested `psychosigh-design.zip`, `psychosigh-brand-kit.zip`, and `video-source.zip`. Frames are in `/Users/sihochoi/Downloads/psychosight-main-screens.zip`. Reuse an existing verified extraction or extract outside the checkout; record the actual roots in the status ledger. The actual supplied video is preferred for motion. Use the plan's reference matrix to find the matching source for each view.
- Keep `web/src/brand/tokens.css`, bundled fonts, and supplied theme-specific identity. Regular Geist, Mono for technical data, restrained Iris graphics, thin rules, open black/white canvas. Me: solid + filled circle; Other: dashed + open square. Dense data belongs inside deliberate analytical regions. Critical copy stays readable.
- API/contracts determine data meaning and exact required text. Brand sources determine identity and component language. HyperFrames guides motion, diagrams, and information density. Do not copy simulated numbers, cinematic positions, shortened consent, or unsupported diagrams.

### Code quality and efficiency

- Implement the smallest complete solution for the selected unit, including its required states. Avoid unrelated cleanup, speculative extension points, unfinished scaffolding, or a general visualization/component framework.
- Extract components for a meaningful responsibility, lifecycle, or reused behavior. Pass explicit typed props; keep state at its nearest shared owner. Do not mirror props/derived values in state or use effects to compute synchronous display data.
- Keep pure geometry/formatting/data adapters separate from effects and DOM work. Preserve immutable report inputs; build indexes once per report instead of repeated `find()` scans or nested passes on pointer movement.
- Use refs for renderer instances, clocks, and transient handles. Clean up timers, observers, event listeners, and obsolete reads, including Strict Mode behavior. Guard asynchronous results by request generation and identity.
- Use memoization only for expensive stable work or demonstrated rerender boundaries. Do not blanket-wrap every component/callback; do not add global stores, deep cloning on every render, or dependency suppression to hide lifecycle bugs.
- Prefer direct imports and native accessible controls. Keep strict TypeScript; no broad `any`, non-null assertions hiding uncertain data, disabled checks, or new validation framework. Type consumed optional fields narrowly and handle absence explicitly.
- Scope CSS to the changed component, reuse tokens, and remove superseded rules. Do not accumulate competing overrides or reorganize all styles before delivering a working view.
- Preserve null versus zero, counts, units, approximations, actual calendar gaps, uncertainty, quote boundaries, and exact disclosure strings. See the audit for episode selection and count-label traps.

### Execution, checks, and continuity

1. Read current code and status for this unit. Confirm any prerequisite work exists in code rather than trusting a checkbox. Repair only a small directly related prerequisite if necessary; report a genuine external blocker instead of fabricating completion.
2. Make the implementation, run targeted checks, and inspect the actual rendered result for visual units. Fix discovered issues within scope. Do not end with another plan or ask permission for ordinary edits/tests.
3. Use the existing frontend test/build commands from `web`: `npm test` and `npm run build`. Target relevant tests while iterating; finish each unit with a production build and the relevant regression tests. Run the full suite at major integrated milestones and unit 6. Reuse unchanged successful results rather than repeatedly running broad checks with no new reason.
4. Use mock/synthetic data for visual work. Reuse a suitable dev server; do not terminate unrelated processes. Capture both themes and one narrow view for visual units; compare against the design package and relevant HyperFrames UI. Inspect motion as motion, not only still images. Save review media outside Git and do not capture personal conversations.
5. Maintain one concise `/Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_STATUS.md` for unit evidence: prompt number/unit, assigned chat identity, implementation/check state, changed files, exact commands/results, visual evidence paths, adopted brand/video references, deliberate deviations, and remaining work. Preserve previous unit records; do not edit the coordinator's queue file or dispatch another unit. Record missing verification honestly. Do not create a second design system or duplicate the plan.
6. Follow the Unit Goal lifecycle above. Finish only the assigned unit with its actual Goal result and receipt, then end the implementation chat's execution. Never start a later unit from a unit chat. Only the coordinator may advance the queue, one verified unit at a time.

## Section coverage and execution order

| Plan section | Implementation units |
| --- | --- |
| 1–3: scope, references, architecture | Shared contract, 0, and every unit |
| 4: visual foundation | 1 and every visual review |
| 5: progress/LED | 2A, 2B |
| 6.1–6.4: reports/charts/inspection | 3A, 3B, 3C |
| 6.5: evidence | 4A |
| 7: experimental scores | 4B |
| 8: surrounding journey | 5A, 5B |
| 9: motion | 2B and relevant visual units; final check in 6 |
| 10: sequencing | This execution order |
| 11: verification | Unit-level checks and 6 |
| 12: completion | 6, based on accumulated evidence |

## Unit 0 — Establish the baseline and reference inventory

```text
Implement unit 0 in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 0 by following the Unit Goal lifecycle in this file. Read and follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Apply plan sections 1–3, phase 0, and the review's corrected data inventory.

Confirm the feature branch and current work. Create/update UI_IMPLEMENTATION_STATUS.md without overwriting existing records. Locate the supplied archives and reuse a verified extraction outside Git. Record design/video roots and relevant source paths; inspect the rendered brand kit in both themes and app-demo rather than relying on token names alone.

Run the current frontend suite/build once, reuse existing current screenshots, and fill missing mock baseline captures. Measure the expanded experimental sample at 1440px with details closed. Record existing failures separately; do not rewrite expectations to conceal them.

Confirm actual response fields against schema/samples, especially episodes[], feature count meanings, provider_note, and experimental statuses. Add only the deterministic frontend preview fixtures needed by later units: zero/null/thin/single-week, omitted weeks, long labels, 104/260 weeks, absent episodes, pooled+selected episodes, provider note, and progress boundary/error cases. Keep fixture metadata coherent and canonical backend samples unchanged. Make preview routes reproducible; completed previews must resolve to a valid report.

Done when references, baseline results, fixture cases, and review routes are recorded and the frontend still builds. Do not restyle production screens in this unit. Then complete only this unit's Goal, return its completion receipt, and end this chat's execution. Do not start the next unit.
```

## Unit 1 — Implement the shared visual foundation

```text
Implement unit 1 in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 1 by following the Unit Goal lifecycle in this file. Follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Prerequisite: unit 0. Apply plan section 4 and phase 1.

Inspect Shell.tsx, main.tsx, app.css, current theme behavior, and the brand-kit rendered website/style.css plus app-demo. Refine the shell, regular type hierarchy, task headings, shared controls, spacing, static identity, navigation alignment, focus styles, and both themes. Remove the duplicate oversized picker identity while retaining its working selection flow. Standardize speaker cues for subsequent charts.

Fix skip/back-to-top behavior so scrolling/focus does not change the hash route. Reuse small UI primitives only where a real responsibility is shared. Move CSS only for components being changed, deleting superseded rules. Preserve the canonical token file and theme persistence; prevent clipped focus and page-level overflow.

Use plan section 4's composition checks: open page framing, useful data density, readable controls, 320px reflow, and 200% zoom. Compare shell plus one complete task screen against the supplied design package in black/white and narrow layouts. HyperFrames video.css/s4/s5 support alignment; the brand package governs identity.

Verify relevant shell/navigation/theme behavior and build. Use browser review for styling rather than brittle CSS snapshots. Record visual evidence and any deliberate reference deviation. Done when the shared foundation is coherent without breaking existing screens. Then complete only this unit's Goal, return its completion receipt, and end this chat's execution. Do not start the next unit.
```

## Unit 2A — Implement job state, polling, and completion behavior

```text
Implement unit 2A in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 2A by following the Unit Goal lifecycle in this file. Follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Prerequisites: 0–1. Apply plan sections 3 and 5.3–5.4, with section 9's completion rules.

Inspect App.tsx RunScreen, api.ts, stages.ts, ProgressView.tsx, and mock progress. Extract one useAnalysisJob hook. Keep ~500ms polling after each response, one active read, obsolete-read abort support, generation guards, state reset on job changes, terminal stop, and complete cleanup. Preserve AbortError semantics rather than presenting canceled reads as transport failures. Retry GET only; never resubmit or cancel backend analysis.

Make status authoritative. Distinguish queued, measured/unknown totals, job failure, missing jobs, transport errors, and unknown future stages. Retain the last known job during a retrieval failure with accurate Retry copy. Local mode skips scoring/synthesis, not necessarily experimental. Scoring counts episodes; experimental counts work units. Never invent overall progress or ETA.

Implement automatic report entry: a newly observed completion has an immediate View report action and at most 1.6s transition; reduced motion/already-done/revisit enters directly. Keep timers job/route scoped and safe across navigation/hidden screens. Provide a usable plain completion state until the LED unit adds the visual. Store optional validated run context only after creation, keyed to the returned job ID; preserve older storage and deep links, and use neutral resume copy when status is unknown.

Test races, abort/retry, obsolete responses, terminal/unknown states, one-item totals, completion timing/navigation, and storage fallback using controlled promises/timers. Build and verify the working mock flow with existing visuals. Then complete only this unit's Goal, return its completion receipt, and end this chat's execution. Do not start the next unit.
```

## Unit 2B — Integrate the LED and polish the progress composition

```text
Implement unit 2B in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 2B by following the Unit Goal lifecycle in this file. Follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Prerequisite: 2A. Apply all of plan section 5 and the motion/composition requirements in sections 4 and 9.

Read the design package's LED_MATRIX.md and actual matrix.js/light-processing.js API; inspect app-demo progress and HyperFrames s6-progress plus the actual 70–80s motion reference. Vendor the supplied renderer with provenance and narrow types. Keep changes minimal, including the documented switch to bundled Geist Mono. Start at 31×31, ellipse, black substrate in both themes; tune only documented settings.

Build a small LedMatrix wrapper and compact StageRail around the real job adapter from 2A. Keep Canvas decorative beside equivalent text/semantic progress. Do not restart signals on every poll. configure replaces settings; merge defaults. render takes delta seconds, max 0.1, at no more than 30fps. Use refs, never per-frame React state. Static progress redraws on changes; settled terminal states stop scheduling.

Honor pause/reduced motion, hidden/offscreen suspension and resume, font-ready redraw, Strict Mode, initialization/render fallback, and observer/listener/RAF cleanup. The renderer has no destroy(). Use finite actual stage percentages only. Keep the static wordmark untouched. Present current stage/count, all real stage states, matching context, immediate report access, and accurate failure/retry actions.

Use renderer-stub tests for lifecycle/state and a real browser for pixels/motion. Inspect queued, scoring, experimental, done, error, local mode, canvas failure, both themes, and narrow view. Confirm ring/stages/actions fit the desktop task composition and no work accumulates after revisits. Run related tests/build and record reference comparisons. Then complete only this unit's Goal, return its completion receipt, and end this chat's execution. Do not start the next unit.
```

## Unit 3A — Build and integrate correct chart geometry

```text
Implement unit 3A in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 3A by following the Unit Goal lifecycle in this file. Follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Prerequisite: 2B. Apply plan sections 6.1, 6.3, and the data rules in 6.4.

Inspect TimelineChart.tsx, format.ts, types.ts, the actual feature schema/samples, and the audit's count-label finding. Build small pure timeline/scale/format helpers and integrate them into the existing chart so this unit delivers working corrected charts rather than unused scaffolding. Use app-demo charts and HyperFrames s8 as visual references for readable axes and marks.

Join by week keys, use returned calendar dates with UTC day arithmetic and tested ISO-week fallback, preserve missing calendar intervals, and break paths across null/omitted weeks. Use the same geometry for axes, marks, selection, and hit testing; remove independently spaced x labels and the y-axis/domain mismatch. Handle all-null, all-zero, one point, and dense series.

Implement the exact metric domain policy from the plan: 0–100 participation; one common bounded zero-based scale for the three word rates; separate zero-based count/length/latency scales. Domains remain stable across week/window selection. Preserve exact values, units, approximate labels, and all features. Labels must distinguish supplied basis counts from true denominators, especially initiation and late-night counts; show count/reason for null cells.

Index lookups once per report and avoid array scans during interaction. Test date/domain/segment/format invariants with independently specified expected results. Verify actual chart readability at desktop/narrow sizes, then run related report/format tests and build. Then complete only this unit's Goal, return its completion receipt, and end this chat's execution. Do not start the next unit.
```

## Unit 3B — Implement the report overview and coordinated charts

```text
Implement unit 3B in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 3B by following the Unit Goal lifecycle in this file. Follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Prerequisite: 3A. Apply plan sections 6.2–6.4 and section 4's report composition.

Inspect ReportView.tsx and the integrated chart helpers. Compare the design package's report/app-demo layout and HyperFrames s8-report. Build a compact overview with actual applied dates, totals, mode/demo context, range-clamp notice, and supplied provider_note. Lead into paired weekly message bars and a readable two-column feature grid; retain all nine metrics, descriptions, approximations, and count bases. Preserve existing lower report sections for later units.

Own selected week and display window once at ReportView. Coordinate activity and feature panels using the same time domain. Hover previews, click/tap pins, pointer exit restores pin; provide keyboard previous/next/Home/End and clear selection. Keep panel-local exact values plus a shared summary; do not announce pointer movement. Reset on report changes. Offer accessible View data tables with full-range values/counts/reasons.

For >52 calendar weeks, implement All/Latest 52/Latest 13 windows anchored to the final report week. Show applied dates; preserve overall full-report totals and fixed y domains. Clear an out-of-window selection explicitly. No API requests, resampling, or recomputed overall metrics. Reduce repetitive marks at high density while preserving lines/data access. Add in-page section navigation without modifying the hash route.

Verify 1/104/260 weeks, missing data, 0 vs null, provider/range notes, keyboard/touch, both themes, narrow widths, and 200% zoom. Inspect performance before adding memoization. Complete the first shell/progress/report visual milestone with rendered brand/video comparisons, report interaction tests, full frontend suite, and build. Then complete only this unit's Goal, return its completion receipt, and end this chat's execution. Do not start the next unit.
```

## Unit 3C — Add episode diagrams from the existing report payload

```text
Implement unit 3C in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 3C by following the Unit Goal lifecycle in this file. Follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Prerequisite: 3B. Apply plan sections 3, 6.1–6.2 and audit finding 1.

Read the actual episodes[] schema, sample payloads, and episode_index implementation before extending the frontend type. The field already exists on the wire; do not change backend/schema/API. Use the brand kit's report/diagram language and HyperFrames s7-pipeline as composition references without copying its unsupported message/turn diagrams.

Add a visible Episode detail disclosure within weekly activity, showing the selected week's actual episode intervals, initiator cues, counts, and exact metadata in an accessible table/inspector. Give the disclosure a useful initial week when opened without an explicit selection. Use stable episode IDs and existing report selection state. Render actual timestamps/offsets; handle narrow views and overlapping/dense intervals without moving times. If aggregating for readability, label count/interval aggregation and retain exact episode access.

Display scored/selection as Selected for scoring with the supplied random/top_signal category, never successful/stable scoring or a numerical rank. Pooled and selected can coexist. Evidence links resolve real episode IDs and supplied quotes only; preserve selected-week/window behavior and announce explicit changes. Missing episode index or missing reference degrades cleanly without hiding the weekly report.

Test present/absent index, overlaps, pooled+selected, missing references, exact metadata and reset behavior. Inspect the actual diagram against brand/video sources and run relevant report tests/build. Then complete only this unit's Goal, return its completion receipt, and end this chat's execution. Do not start the next unit.
```

## Unit 4A — Refine scored patterns, observations, and evidence

```text
Implement unit 4A in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 4A by following the Unit Goal lifecycle in this file. Follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Prerequisite: 3C. Apply plan section 6.5 with sections 4/9's visual and motion rules.

Inspect current rubric/observation rendering, report contracts, and quote lookup. Use the design package's evidence/report treatments, HyperFrames s7 rubric/evidence and s8 observations as references. Replace repetitive prose-only score layout with compact 1–5 anchor tracks, exact means, true sample counts, speaker scope, and accessible descriptions/anchors.

Preserve unstable, insufficient, failed, and not-run states; never plot a missing score. Put each supplied observation beside its confidence, supporting episode count, and related verbatim quote evidence. Use alignment and rules, with explicit evidence disclosures where useful. Resolve top-level report evidence only against its proper collection; do not introduce experimental quotes or new interpretation. Reference navigation uses existing feature/item/episode IDs and degrades on absence.

Keep limitation/disclaimer copy complete and visible, with secondary run details and controls reachable. Quote text wraps safely; preserve timestamp context. Extract shared presentation only where it reduces actual duplication, leaving evidence-source lookup explicit. Avoid ornamental cards, confidence color judgments, and animation that hides reading content.

Test missing/unstable/skipped states, exact quote source/text and evidence navigation. Inspect long content, both themes, desktop/narrow and keyboard disclosure/focus. Run relevant report tests/build and record rendered brand/video comparisons. Then complete only this unit's Goal, return its completion receipt, and end this chat's execution. Do not start the next unit.
```

## Unit 4B — Implement compact experimental comparisons and details

```text
Implement unit 4B in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 4B by following the Unit Goal lifecycle in this file. Follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Prerequisite: 4A. Apply plan section 7 and the experimental contract without loosening it.

Inspect ExperimentalScores.tsx, experimental.ts, all experimental fixtures/tests, and docs/EXPERIMENTAL_CONTRACT.md. Use the brand package's neutral typography/structure and relevant app-demo, plus HyperFrames experimental e2-bars/e3-drilldown/e4-caveats and exp.css. Preserve one collapsed section at the report bottom with visible banner/support, separate from Observations, and no share/export features.

Implement aligned neutral interval comparisons for all 12 dimensions in family order. Each displayed score keeps exact score, band, low/medium confidence, evidence and episode/word basis visible. Me is filled-circle; Other open-square, omitted when null. Preserve full scale note, labels, evidence notes, How this works, statuses, and optional Big Five shape. Never add good/bad colors, gauges, thresholds, percentile/norm claims, or score high/low labels.

Expand dimension/speaker details for contributions, trend, citations, and quotes. Keep stable descending effective-weight order, direction and source/value labels, weights on a consistent 0–100% length scale without renormalizing subsets, and unavailable markers. No additive waterfall interpretation. Experimental quotes resolve only within experimental_scores.quotes. Trend uses its own labeled domain, exact trend note, gaps, values, and basis; never compare its height to the overall index. Render citations already supplied without fetching content.

Verify all existing experimental samples/contract assertions, null Other, failed/not-run/thin/deterministic results, and keyboard/touch. Compare expanded height against unit 0's baseline: target at least 50% reduction at 1440px with details closed without shrinking or hiding required text. Run experimental and relevant report tests/build; inspect both themes/narrow layout. Then complete only this unit's Goal, return its completion receipt, and end this chat's execution. Do not start the next unit.
```

## Unit 5A — Polish picker, range selection, and consent

```text
Implement unit 5A in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 5A by following the Unit Goal lifecycle in this file. Follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Prerequisite: 4B. Apply plan section 8's picker/consent requirements and section 4's composition checks.

Inspect Picker.tsx, OptIn.tsx, conversation-adapter.ts, analysis-request.ts, related App state and tests. Reference brand-kit lists/forms/focused tasks, app-demo, and HyperFrames s4-picker/s5-consent/e1-optin. Put search and real rows near the top; align labels/counts/dates with responsive stacking. Keep selected conversation, date range and Continue coherently grouped.

Preserve debounced server search, paging, stale-response protection, selection across pages, unsupported group explanations, range bounds/reset, missing dates, and valid custom ranges. Make initial load, refreshing rows, empty catalog, no results, and retry states distinct. Add correct field/error associations without rewriting adapter rules. Style saved reports and use accurate resume-job wording.

Carry matching conversation/range context into a readable consent composition, with full config strings verbatim and body-sized required copy. Preserve checkbox defaults/dependency, enabled flags, demo provider note, exact consent echoes, local/full request shapes, busy/error states, and duplicate-submit protection. Use both existing submit paths; no new analysis decisions or changed provider semantics. Keep critical disclosure visible, including narrow layouts.

Verify existing picker/opt-in tests plus request-payload regressions for demo/non-demo, local/full, experimental on/off and Other dependency. Inspect full mock journey in both themes, keyboard, dates/timezone boundaries and narrow widths. Build and record comparisons to both brand and video references. Then complete only this unit's Goal, return its completion receipt, and end this chat's execution. Do not start the next unit.
```

## Unit 5B — Finish recovery, asynchronous focus, and deletion UI

```text
Implement unit 5B in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 5B by following the Unit Goal lifecycle in this file. Follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Prerequisite: 5A. Apply plan section 8's supporting-screen requirements and sections 4/9/11.

Inspect DiskAccess.tsx, DeleteDialog.tsx, App loaders/errors/saved-report lifecycle, and existing tests. Use brand-kit focused tasks, controls, state/error guidance and app-demo as the primary references. Match the shell/heading/action language already implemented instead of creating another pattern.

Polish access help, config/submission errors, report loading/not-found/retrieval failures, saved-report status, and deletion. Preserve every existing native settings/recheck/reveal/demo callback and request behavior. Focus an asynchronously loaded page heading once when ready; do not steal focus on chart interaction or polling.

Keep the existing deletion confirmation and request. Correct initial/return focus, focus containment, disabled-control handling, background interaction, pending/error visibility and Escape/backdrop behavior. Pending dismissal must not imply request cancellation; deletion failures retain a usable recovery path. Use a native or existing accessible primitive when it simplifies the solution; do not install a dialog library for this.

Test confirm/cancel/pending/failure and focus recovery, async page focus, route-preserving in-page navigation, and access callbacks. Inspect keyboard/VoiceOver and narrow/zoomed layouts in both themes. Run affected tests and the integrated full frontend suite/build. Then complete only this unit's Goal, return its completion receipt, and end this chat's execution. Do not start the next unit.
```

## Unit 6 — Verify the complete UI and prepare the handoff

```text
Implement unit 6 in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment. Create or reuse an actual Goal scoped only to unit 6 by following the Unit Goal lifecycle in this file. Follow the Shared execution contract in /Users/sihochoi/Documents/PsychoSight-ui-refurbishment/docs/UI_IMPLEMENTATION_PROMPTS.md. Prerequisites: all earlier units verified in code. Apply plan sections 9–12; finish the implementation rather than writing another plan.

Inspect the final diff and close in-scope integration defects. Run npm test and npm run build from web. Execute the complete mock/state matrix, schemas 1.0.0/1.1.0, both themes, all target viewports, 320px reflow, 200% zoom, keyboard/touch/VoiceOver, reduced motion/pause, hidden/offscreen resume, deep links, and long/missing/zero/thin data. Confirm report request semantics and exact experimental/consent copy remain intact.

Compare the built UI with the rendered PsychoSigh brand package and the relevant HyperFrames compositions/motion. Confirm the first-viewport and density goals without tiny copy, clipped focus, hidden qualifications, or generic card styling. Record before/after mock screenshots and a short motion capture outside Git. Inspect console/network failures.

Record a representative long-report performance trace. Check no per-frame React LED state, work after terminal/hidden states, accumulating resources on revisits, repeated geometry scans on pointer movement, or unnecessary requests. Fix measured issues with the smallest change; do not add speculative memoization/caching/dependencies.

Smoke-test existing API integration with synthetic demo data and explicitly deterministic/no-LLM/no-experimental/no-Other flags to avoid provider calls. Do not touch private message data, backend config, or packaging. Verify the existing packaged webview only if available; label unavailable checks unperformed without inventing success.

Update web/README.md and the concise status ledger with architecture, reference provenance, preview states, maintenance details, results and actual remaining limits. Mark plan acceptance items only with evidence; do not relabel an omitted required check as passed. Confirm all changed files are UI scope and the branch is codex/frontend-refurbishment. Deliver the completed reviewable UI and validation summary without committing, pushing, merging, or deploying unless separately requested. Complete this unit's Goal, return its completion receipt, and end this chat's execution. The coordinator verifies all twelve results and completes its own sequence Goal.
```
