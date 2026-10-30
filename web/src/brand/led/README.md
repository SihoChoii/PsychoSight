# Supplied PsychoSigh LED renderer

Source: `/Users/sihochoi/Downloads/frontend-handoff.zip` → `psychosigh-design.zip` → `psychosigh-design/exploration/{matrix.js,light-processing.js}`. Verified extraction: `/private/tmp/psychosight-frontend-review/frontend-handoff/psychosigh-design/psychosigh-design`. The package describes this renderer as unchanged from its Allium v0.1.0 source. Source comments are retained; the two files carry no additional license notice. The handoff is supplied for this project; this record does not infer a blanket redistribution license. Existing bundled Geist/OFL credits stay with `brand/fonts`.

Original SHA-256:

- `matrix.js`: `19b0ae13f28642c95aa4654da5e5bb3f1c8758fff253a9751f03bfe120189223`
- `light-processing.js`: `8ec2b7474d5b73e34e0f61b530b0d573afb670dfd816e1a83fea3fe3e64f6054`

Local adaptations are deliberately small:

1. Replace the native progress graphic's `PlexMono` fallback with the existing bundled `"Geist Mono"`. No font request leaves the app. The host loads that face and invalidates after font readiness.
2. Roll back resize/intersection observers if constructor observation or first rendering throws. This closes a partial-initialization leak before the host can receive an instance. `led-vendor.test.ts` exercises the actual constructor's failure paths.
3. Center progress text on a fixed alphabetic baseline with monospaced advances and no kerning. Floor the visual reading (with floating-point tolerance) so an unfinished stage never rounds up to 100.
4. `matrix.d.ts` projects only the host's used API; it neither disables strict TypeScript nor declares arbitrary exports.

`light-processing.js` is byte-identical. No lab controllers, media upload, GSAP, video runtime or new dependencies are bundled.

`components/progress/LedMatrix.tsx` owns the clock and lifecycle. Settings merge `DEFAULTS` with **81×81, ellipse**, 20% halo and 25% neighboring light. The denser grid preserves numeral detail while the reduced light spill keeps the cores distinct. CSS sizes the circular black substrate at 352px desktop / 272px narrow in both themes. White square cores and dormant lattice remain visible. Configure replaces settings; never pass partial settings.

The host clears media once, changes signals only when the effective signal changes, and sends only finite bounded stage percentages. Invalid measured input uses an indeterminate orbit. Measured rings interpolate forward between received values over 380ms using bounded cubic easing. The first value, stage/job changes, server corrections, pause and reduced motion settle immediately. Idle readings schedule no frames; hidden/offscreen updates settle to the newest known value and never replay. There is no extrapolation, overall percentage or ETA. Semantic progress and the external tabular readout always expose the latest exact counters. The native `time` field is set to its documented settled value of 2 seconds to settle terminal marks without restarting `setSignal`. Terminal animation ends at 1.6 accumulated seconds; automatic report navigation remains on unit 2A's independent deadline.

Animation uses refs/effect-local handles, delta seconds ≤0.1 and ≤30fps. Pause/reduced motion, hidden pages and the renderer's real intersection callbacks suspend it. Resume invalidates and starts a fresh host delta. The renderer's own resize/intersection renders pass through the same failure boundary. Failure retains adjacent text, native progress and actions; the Canvas is decorative. Cleanup cancels RAF, removes listeners, nulls visibility callbacks and disconnects both native observers. There is no `destroy()` method. Font promises check disposal before drawing. Strict Mode mounts and partial-constructor rollback are covered with renderer-stub and native-constructor tests; pixels/motion require browser verification.
