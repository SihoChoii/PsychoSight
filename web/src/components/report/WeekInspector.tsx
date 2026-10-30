import { useId } from "react";
import { formatCalendarDay, formatNumber } from "../../format";
import type { TimelineWeek } from "../../charts/timeline";
import type { ChartInspection } from "../../charts/inspection";

export function WeekActivityValues({ week }: { week: TimelineWeek }) {
  if (!week.source) return <p>No activity data supplied for this week; messages, words and episode counts are unavailable.</p>;
  const { messages, words, episodes } = week.source;
  return <dl className="week-activity-values">
    <div><dt>Me</dt><dd>{formatNumber(messages.me)} messages · {formatNumber(words.me)} words</dd></div>
    <div><dt>Other</dt><dd>{formatNumber(messages.other)} messages · {formatNumber(words.other)} words</dd></div>
    <div><dt>Episodes</dt><dd>{formatNumber(episodes)}</dd></div>
  </dl>;
}

export function WeekInspector({ week, inspection, move, empty }: {
  week?: TimelineWeek; inspection: ChartInspection; move: (key: string) => void; empty: boolean;
}) {
  const instructionsId = useId();
  return <div className="week-inspection" role="group" aria-label="Week inspection" aria-describedby={instructionsId} tabIndex={0} onKeyDown={inspection.keyDown}>
    <div className="week-inspection-heading">
      <p>{week ? <><span>{formatCalendarDay(week.startDate)} – {formatCalendarDay(week.endDate)}</span><span className="week-selection-state">{week.key} · {week.key === inspection.pinnedKey ? "Pinned" : "Preview"}</span></> : <><span>Select a week to explore</span><span className="sr-only">No week selected</span></>}</p>
      <div className="week-actions">
        <button type="button" aria-label="Previous week" onClick={() => move("ArrowLeft")} disabled={empty}><span aria-hidden="true">←</span> Previous</button>
        <button type="button" aria-label="Next week" onClick={() => move("ArrowRight")} disabled={empty}>Next <span aria-hidden="true">→</span></button>
        <button type="button" aria-label="Clear week" onClick={() => inspection.pin(null)} disabled={!week && !inspection.pinnedKey}>Clear</button>
      </div>
    </div>
    <div className="week-value-slot">{week ? <WeekActivityValues week={week} /> : null}</div>
    <p className="sr-only" id={instructionsId}>Point to preview; click or tap to pin across charts. Arrows and Home/End navigate; Escape clears. View data covers the full report.</p>
  </div>;
}
