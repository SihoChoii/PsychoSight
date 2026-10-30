import { dismissReportLayers } from "./ReportDisclosure";
export function reportReferenceId(kind: "feature" | "item", key: string): string {
  return `report-${kind}-${encodeURIComponent(key)}`;
}

export function focusReportReference(kind: "feature" | "item", key: string) {
  dismissReportLayers();
  const target = document.getElementById(reportReferenceId(kind, key));
  if (target) {
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "start", behavior: "instant" });
  }
}

export function focusReportResources() {
 dismissReportLayers();
 const heading = document.getElementById('report-details-title');
 heading?.focus({preventScroll:true}); heading?.scrollIntoView?.({block:'start',behavior:'instant'});
}
