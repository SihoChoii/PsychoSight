import { useState } from "react";
import type { ExperimentalChoice } from "../types";

export function OptIn({
  text,
  busy,
  error,
  onOptIn,
  onLocalOnly,
  isDemo = false,
  experimentalEnabled = false,
  experimentalText = null,
  scoreOtherText = null,
  demoProviderNote = null,
}: {
  text: string | null;
  busy: boolean;
  error: string | null;
  onOptIn: (choice: ExperimentalChoice) => void;
  onLocalOnly: (choice: ExperimentalChoice) => void;
  isDemo?: boolean;
  experimentalEnabled?: boolean;
  experimentalText?: string | null;
  scoreOtherText?: string | null;
  demoProviderNote?: string | null;
}) {
  const showExperimental = experimentalEnabled && !!experimentalText && !!scoreOtherText;
  const demoDefault = showExperimental && isDemo;
  const [experimental, setExperimental] = useState(demoDefault);
  const [scoreOther, setScoreOther] = useState(demoDefault);
  const choice: ExperimentalChoice = showExperimental
    ? { experimental, scoreOther: experimental && scoreOther }
    : { experimental: false, scoreOther: false };

  return (
    <section className="focus-task" aria-labelledby="page-title">
      <h1 id="page-title" tabIndex={-1}>
        Opt in
      </h1>
      {text === null ? (
        <p className="decision-copy">Loading the disclosure.</p>
      ) : (
        <p className="decision-copy" data-testid="opt-in-text">
          {text}
        </p>
      )}
      {demoProviderNote ? (
        <p className="decision-copy demo-provider-note" data-testid="demo-provider-note">
          {demoProviderNote}
        </p>
      ) : null}
      {showExperimental ? (
        <fieldset className="exp-optin">
          <legend className="sr-only">Experimental scores</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={experimental}
              onChange={(event) => {
                const next = event.target.checked;
                setExperimental(next);
                if (!next) setScoreOther(false);
              }}
            />
            <span>{experimentalText}</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={experimental && scoreOther}
              disabled={!experimental}
              onChange={(event) => setScoreOther(event.target.checked)}
            />
            <span>{scoreOtherText}</span>
          </label>
        </fieldset>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="actions">
        <button type="button" className="button" disabled={text === null || busy} onClick={() => onOptIn(choice)}>
          {busy ? "Starting" : "Send excerpts and analyze"}
        </button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => onLocalOnly(choice)}>
          Deterministic only, no LLM
        </button>
      </div>
    </section>
  );
}
