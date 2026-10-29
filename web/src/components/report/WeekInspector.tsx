import { useId } from "react";
import { formatNumber } from "../../format";
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
      <p>{week ? `${week.key} · ${week.startDate} – ${week.endDate} · ${week.key === inspection.pinnedKey ? "Pinned" : "Preview"}` : "No week selected"}</p>
      <div className="week-actions">
        <button type="button" onClick={() => move("ArrowLeft")} disabled={empty}>Previous week</button>
        <button type="button" onClick={() => move("ArrowRight")} disabled={empty}>Next week</button>
        <button type="button" onClick={() => inspection.pin(null)} disabled={!week && !inspection.pinnedKey}>Clear week</button>
      </div>
    </div>
    {week ? <WeekActivityValues week={week} /> : null}
    <p className="chart-instructions" id={instructionsId}>Point to preview; click or tap to pin across charts. Arrows and Home/End navigate; Escape clears. View data covers the full report.</p>
  </div>;
}
