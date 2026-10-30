import type { ReactNode } from "react";
import { ReportDisclosure } from "./ReportDisclosure";

/** Tables mount only while their bounded data panel is open. */
export function ChartData({ label, children }: { label: string; children: () => ReactNode }) {
  return <ReportDisclosure label={`View data: ${label}`} triggerText="View data" title={`${label} · full report data`} wide className="chart-data">{children}</ReportDisclosure>;
}
