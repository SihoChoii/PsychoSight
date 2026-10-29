export function reportReferenceId(kind: "feature" | "item", key: string): string {
  return `report-${kind}-${encodeURIComponent(key)}`;
}

export function focusReportReference(kind: "feature" | "item", key: string) {
  const target = document.getElementById(reportReferenceId(kind, key));
  if (target) {
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "start", behavior: "instant" });
  }
}
