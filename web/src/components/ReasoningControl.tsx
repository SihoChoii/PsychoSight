import { useId, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { REASONING_DEEP_LABEL, REASONING_QUICK_LABEL, type ReasoningControlModel } from "../reasoning-adapter";

export const MODEL_STEP_LABEL = "Enable AI analysis";
export const DETERMINISTIC_REASON = "Enable AI analysis to choose a reasoning level.";

export function clampReasoningIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

/** Page Up / Page Down move by about half the span, and at least one level. */
export function reasoningPageStep(count: number): number {
  if (count <= 1) return 1;
  return Math.max(1, Math.ceil((count - 1) / 2));
}

export function reasoningIndexFromKey(index: number, count: number, key: string): number | null {
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clampReasoningIndex(index - 1, count);
    case "ArrowRight":
    case "ArrowUp":
      return clampReasoningIndex(index + 1, count);
    case "Home":
      return 0;
    case "End":
      return Math.max(0, count - 1);
    case "PageDown":
      return clampReasoningIndex(index - reasoningPageStep(count), count);
    case "PageUp":
      return clampReasoningIndex(index + reasoningPageStep(count), count);
    default:
      return null;
  }
}

export function ReasoningControl({
  control,
  index,
  modelStep,
  busy,
  onIndex,
}: {
  control: ReasoningControlModel;
  index: number;
  modelStep: boolean;
  busy: boolean;
  onIndex: (index: number) => void;
}) {
  const legendId = useId();
  const sliderId = useId();
  const hintId = useId();
  const currentId = useId();
  const descriptionId = useId();
  const keyStepped = useRef(false);

  if (!control.visible) return null;

  const safeIndex = clampReasoningIndex(index, control.levels.length);
  const current = control.levels[safeIndex];
  const disabled = !modelStep || busy;
  const describedBy = [hintId, current.description ? descriptionId : null]
    .filter((id): id is string => id !== null)
    .join(" ");

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.currentTarget.disabled) return;
    const next = reasoningIndexFromKey(safeIndex, control.levels.length, event.key);
    if (next === null) return;
    event.preventDefault();
    keyStepped.current = true;
    onIndex(next);
    queueMicrotask(() => {
      keyStepped.current = false;
    });
  }

  return (
    <fieldset className={disabled ? "reasoning is-disabled" : "reasoning"}>
      <legend id={legendId}>Reasoning</legend>
      <p id={currentId} className="reasoning-current" data-testid="reasoning-current">
        {current.label}
      </p>
      <div className="reasoning-scale">
        <input
          id={sliderId}
          className="reasoning-slider"
          data-testid="reasoning-slider"
          type="range"
          min={0}
          max={Math.max(0, control.levels.length - 1)}
          step={1}
          value={safeIndex}
          disabled={disabled}
          aria-labelledby={legendId}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, control.levels.length - 1)}
          aria-valuenow={safeIndex}
          aria-valuetext={current.label}
          aria-describedby={describedBy}
          onPointerDown={() => {
            keyStepped.current = false;
          }}
          onChange={(event) => {
            if (keyStepped.current) {
              keyStepped.current = false;
              return;
            }
            const next = Number(event.target.value);
            if (!Number.isInteger(next)) return;
            onIndex(clampReasoningIndex(next, control.levels.length));
          }}
          onKeyDown={onKeyDown}
        />
        {control.levels.length > 1 ? (
          <div className="reasoning-ends">
            <span data-testid="reasoning-end-quick">{REASONING_QUICK_LABEL}</span>
            <span data-testid="reasoning-end-deep">{REASONING_DEEP_LABEL}</span>
          </div>
        ) : null}
        <div
          className={control.levels.length === 1 ? "reasoning-ticks is-single" : "reasoning-ticks"}
          style={{ "--tick-count": String(control.levels.length) } as CSSProperties}
        >
          {control.levels.map((level, levelIndex) => (
            <button
              key={`${level.id}-${levelIndex}`}
              type="button"
              className={levelIndex === safeIndex ? "reasoning-tick is-current" : "reasoning-tick"}
              style={{ "--tick-index": String(levelIndex) } as CSSProperties}
              aria-pressed={levelIndex === safeIndex}
              tabIndex={-1}
              disabled={disabled}
              onClick={() => onIndex(levelIndex)}
            >
              <span className="reasoning-tick-mark" aria-hidden="true" />
              <span className="reasoning-tick-label">{level.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="reasoning-copy-slot">
        {control.levels.map((level, levelIndex) => (
          <p
            key={`${level.id}-${levelIndex}`}
            id={levelIndex === safeIndex ? descriptionId : undefined}
            className={`reasoning-description${levelIndex === safeIndex ? "" : " is-reserved"}`}
            data-testid={levelIndex === safeIndex ? "reasoning-description" : undefined}
            aria-hidden={levelIndex !== safeIndex}
          >{level.description}</p>
        ))}
      </div>
      <div className="reasoning-copy-slot">
        {[control.hint, DETERMINISTIC_REASON].map((hint, hintIndex) => {
          const active = modelStep === (hintIndex === 0);
          return (
            <p key={hintIndex} id={active ? hintId : undefined} className={`reasoning-hint${active ? "" : " is-reserved"}`}
              data-testid={active ? "reasoning-hint" : undefined} aria-hidden={!active}>{hint}</p>
          );
        })}
      </div>
    </fieldset>
  );
}
