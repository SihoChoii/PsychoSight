import { useRef } from "react";

export function ReportNavigation({ limitationsTitle, experimental }: { limitationsTitle: string; experimental: boolean }) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const sections = [["activity-title", "Activity"], ...(experimental ? [["exp-title", "Experimental"]] : []),
    ["weeks-title", "Weekly patterns"], ["feature-summary-title", "Reading the patterns"], ["rubric-title", "Scored patterns"],
    ["observations-title", "Observations"], ["limits-title", limitationsTitle], ["report-details-title", "Report resources"]];
  return <nav className="report-navigation" aria-label="Report sections">
    <details ref={disclosure} onKeyDown={(event) => {
      if (event.key === "Escape" && disclosure.current) {
        disclosure.current.open = false;
        disclosure.current.querySelector("summary")?.focus();
      }
    }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
    }}>
      <summary>Explore report <span aria-hidden="true">⌄</span></summary>
      <div className="report-section-menu">
        {sections.map(([id, label]) => <button key={id} type="button" onClick={() => {
          if (disclosure.current) disclosure.current.open = false;
          const heading = document.getElementById(id);
          if (heading) {
            heading.tabIndex = -1;
            heading.focus({ preventScroll: true });
            heading.scrollIntoView({ block: "start", behavior: "instant" });
          }
        }}>{label}</button>)}
      </div>
    </details>
  </nav>;
}
