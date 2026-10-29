export function OptIn({
  text,
  busy,
  error,
  onOptIn,
  onLocalOnly,
}: {
  text: string | null;
  busy: boolean;
  error: string | null;
  onOptIn: () => void;
  onLocalOnly: () => void;
}) {
  return (
    <section className="focus-task" aria-labelledby="page-title">
      <h1 id="page-title" tabIndex={-1}>
        Opt in
      </h1>
      {text === null ? (
        <p className="decision-copy">Loading the disclosure.</p>
      ) : (
        <p className="decision-copy" data-testid="opt-in-text">{text}</p>
      )}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="actions">
        <button type="button" className="button" disabled={text === null || busy} onClick={onOptIn}>
          {busy ? "Starting" : "Send excerpts and analyze"}
        </button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={onLocalOnly}>
          Deterministic only, no LLM
        </button>
      </div>
    </section>
  );
}
