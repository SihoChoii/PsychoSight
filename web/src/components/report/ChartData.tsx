import { useState } from "react";
import type { ReactNode } from "react";

/** Closed long-report tables need no DOM; all original rows mount when requested. */
export function ChartData({ label, children }: { label: string; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="chart-data" open={open}>
    <summary onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }}>View data<span className="sr-only">: {label}</span></summary>
    {open ? children() : null}
  </details>;
}
