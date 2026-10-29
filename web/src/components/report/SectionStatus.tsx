export function SectionStatus({ status, reason }: { status: string; reason: string | null }) {
  if (status === "ok") return reason ? <p>{reason}</p> : null;
  const label = status === "not_run" ? "Not run." : status === "failed" ? "This section failed."
    : status === "unstable" ? "Not stable enough to report" : status === "insufficient_data" ? "Insufficient data" : status;
  return <p role={status === "failed" ? "alert" : undefined} data-status={status}>{reason ?? label}</p>;
}
