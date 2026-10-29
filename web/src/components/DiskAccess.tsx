export function DiskAccess({ message, onDemo }: { message: string; onDemo: () => void }) {
  const hasSteps = /System Settings/i.test(message);
  return (
    <section className="focus-task" aria-labelledby="page-title">
      <h1 id="page-title" tabIndex={-1}>
        Full Disk Access
      </h1>
      <p className="decision-copy">{message}</p>
      {hasSteps ? null : (
        <p className="decision-copy">
          Grant Full Disk Access to PsychoSight.app, or to the terminal if you started the backend there. System
          Settings, Privacy &amp; Security, Full Disk Access. Then quit and reopen it.
        </p>
      )}
      <div className="actions">
        <button type="button" className="button" onClick={onDemo}>
          Try demo conversation
        </button>
      </div>
    </section>
  );
}
