import { useEffect, useRef } from "react";

export function DiskAccess({
  message,
  note,
  busy,
  onOpenSettings,
  onRecheck,
  onReveal,
  onDemo,
}: {
  message: string;
  note: string | null;
  busy: boolean;
  onOpenSettings: () => void;
  onRecheck: () => void;
  onReveal: () => void;
  onDemo: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  return (
    <section className="focus-task access-screen" aria-labelledby="page-title">
      <div className="task-heading"><h1 id="page-title" tabIndex={-1} ref={heading}>
        Full Disk Access
      </h1></div>
      <p className="decision-copy">{message}</p>
      <ol className="access-steps">
        <li>Choose Open Full Disk Access Settings.</li>
        <li>Turn on PsychoSight. If it is not in the list, choose Show in Finder and drag PsychoSight into the list.</li>
        <li>Quit PsychoSight and open it again.</li>
      </ol>
      {note ? (
        <p className="status-line access-note" role="status">
          {note}
        </p>
      ) : null}
      <div className="actions access-actions" aria-busy={busy}>
        <button type="button" className="button" disabled={busy} onClick={onOpenSettings}>
          Open Full Disk Access Settings
        </button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={onRecheck}>
          Recheck
        </button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={onReveal}>
          Show in Finder
        </button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={onDemo}>
          Try demo conversation
        </button>
      </div>
    </section>
  );
}
