export function DiskAccess({ message, onDemo }: { message: string; onDemo: () => void }) {
  const mentionsPath = /Full Disk Access/i.test(message);
  return (
    <section className="focus-task" aria-labelledby="page-title">
      <h1 id="page-title" tabIndex={-1}>
        Full Disk Access
      </h1>
      <p className="decision-copy">{message}</p>
      {mentionsPath ? null : (
        <p className="decision-copy">
          Grant Full Disk Access to the terminal running the backend: System Settings, Privacy &amp; Security, Full
          Disk Access. Then restart it.
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
