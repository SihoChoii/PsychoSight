export function ReportNavigation({ limitationsTitle, experimental }: { limitationsTitle: string; experimental: boolean }) {
  const sections = [["activity-title", "Activity"], ["weeks-title", "Weekly patterns"], ["rubric-title", "Scored patterns"],
    ["observations-title", "Observations"], ["limits-title", limitationsTitle], ["report-details-title", "Report details"],
    ...(experimental ? [["exp-title", "Experimental"]] : [])];
  return <nav className="report-navigation" aria-label="Report sections">
    {sections.map(([id, label]) => <button key={id} type="button" onClick={() => {
      const heading = document.getElementById(id);
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ block: "start", behavior: "instant" });
      }
    }}>{label}</button>)}
  </nav>;
}
