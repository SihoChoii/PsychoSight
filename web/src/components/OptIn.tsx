import { useState } from "react";
import { formatCalendarDay } from "../format";
import type { ExperimentalChoice } from "../types";
import type { PickerSelection } from "./Picker";

export function OptIn({
  text,
  busy,
  error,
  configError = null,
  configLoading = false,
  onRetryConfig,
  onOptIn,
  onLocalOnly,
  selection = null,
  isDemo = false,
  experimentalEnabled = false,
  experimentalText = null,
  scoreOtherText = null,
  demoProviderNote = null,
}: {
  text: string | null;
  busy: boolean;
  error: string | null;
  configError?: string | null;
  configLoading?: boolean;
  onRetryConfig?: () => void;
  onOptIn: (choice: ExperimentalChoice) => void;
  onLocalOnly: (choice: ExperimentalChoice) => void;
  selection?: PickerSelection | null;
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
  const range = selection
    ? selection.dateFrom && selection.dateTo
      ? `${formatCalendarDay(selection.dateFrom)} to ${formatCalendarDay(selection.dateTo)}`
      : selection.dateFrom
        ? `From ${formatCalendarDay(selection.dateFrom)}`
        : selection.dateTo
          ? `Through ${formatCalendarDay(selection.dateTo)}`
          : "No date range requested"
    : null;

  return (
    <section className="consent-screen" aria-labelledby="page-title">
      <div className="task-heading">
        <h1 id="page-title" tabIndex={-1}>Opt in</h1>
      </div>
      {selection ? (
        <dl className="consent-context" aria-label="Selected conversation and requested range">
          <div><dt>Conversation</dt><dd>{selection.label}{isDemo ? <span className="consent-demo">Demo data</span> : null}</dd></div>
          <div><dt>Requested range</dt><dd>{range}</dd></div>
        </dl>
      ) : (
        <p className="consent-fallback"><a href="#/">Choose a conversation</a> to review its requested range.</p>
      )}
      <div className={`consent-layout${showExperimental ? "" : " consent-layout-single"}`}>
        <section className="consent-disclosure" aria-labelledby="disclosure-title">
          <h2 id="disclosure-title" tabIndex={-1}>AI analysis</h2>
          {text === null ? (
            <p className="decision-copy" role="status">{configError ? "Disclosure unavailable." : "Loading the disclosure."}</p>
          ) : (
            <p id="analysis-disclosure" className="decision-copy" data-testid="opt-in-text">{text}</p>
          )}
          {configError ? <div className="config-recovery">
            <p className="field-error" role="alert">{configError}</p>
            <button type="button" className="button button-secondary" disabled={configLoading} onClick={() => { document.getElementById("disclosure-title")?.focus(); onRetryConfig?.(); }}>Retry disclosure</button>
          </div> : null}
          {demoProviderNote ? (
            <p className="decision-copy demo-provider-note" data-testid="demo-provider-note">{demoProviderNote}</p>
          ) : null}
        </section>
        {showExperimental ? (
          <fieldset className="exp-optin">
            <legend>Experimental scores</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={experimental}
                disabled={busy}
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
                disabled={busy || !experimental}
                onChange={(event) => setScoreOther(event.target.checked)}
              />
              <span>{scoreOtherText}</span>
            </label>
          </fieldset>
        ) : null}
      </div>
      <div className="consent-submit" aria-busy={busy}>
        {error ? <p id="submission-error" className="field-error" role="alert">{error}</p> : null}
        {busy ? <p role="status">Starting analysis.</p> : null}
        <div className="actions">
          <button
            type="button"
            className="button"
            disabled={text === null || busy}
            aria-describedby={error ? "submission-error" : text !== null ? "analysis-disclosure" : undefined}
            onClick={() => onOptIn(choice)}
          >
            {busy ? "Starting" : "Send excerpts and analyze"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            aria-describedby={error ? "submission-error" : undefined}
            onClick={() => onLocalOnly(choice)}
          >
            Deterministic only, no LLM
          </button>
        </div>
      </div>
    </section>
  );
}
