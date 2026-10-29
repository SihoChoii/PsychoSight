import { useId, useMemo } from "react";
import { chartGeometry } from "../../charts/geometry";
import type { ChartRow } from "../../charts/models";
import type { MetricDomain } from "../../charts/scales";
import type { ChartInspection } from "../../charts/inspection";
import type { TimelineWeek } from "../../charts/timeline";
import { formatAxis, formatNumber } from "../../format";
import { ChartAxes } from "../TimelineChart";
import { hitWeek, usePlotWidth } from "./chart-surface";
import { ChartData } from "./ChartData";

export function WeeklyActivity({ rows, domain, plotLeft, inspection, selected }: {
  rows: ChartRow[]; domain: MetricDomain; plotLeft: number;
  inspection: ChartInspection; selected?: TimelineWeek;
}) {
  const { plot, width } = usePlotWidth();
  const instructions = useId();
  const geometry = useMemo(() => chartGeometry(rows, domain, width, plotLeft, 180), [rows, domain, width, plotLeft]);
  const barWidth = Math.max(0.25, Math.min(8, (geometry.right - geometry.left) / Math.max(1, rows.length - 1) * 0.34));
  const gap = Math.min(2, barWidth / 3);
  return <div className="weekly-activity">
    <p className="chart-scale">Scale: 0–{formatAxis(domain.max, "messages")} messages per speaker · full-report scale</p>
    <div className="chart-plot" ref={plot}>
      {rows.length ? <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} width={geometry.width} height={geometry.height}
        role="img" aria-label="Weekly message activity" aria-describedby={instructions} tabIndex={0}
        onPointerMove={(event) => { if (event.pointerType !== "touch") inspection.preview(rows[hitWeek(event, geometry) ?? -1]?.week.key ?? null); }}
        onPointerLeave={() => inspection.preview(null)}
        onClick={(event) => inspection.pin(rows[hitWeek(event, geometry) ?? -1]?.week.key ?? null)} onKeyDown={inspection.keyDown}>
        <title>Paired weekly message bars. Me: solid. Other: dashed outline. Both start at zero. Missing activity is unknown.</title>
        <g aria-hidden="true">
          <ChartAxes geometry={geometry} unit="messages" />
          {rows.map(({ week }) => {
            if (!week.source) return null;
            const x = geometry.x(week.day);
            return <g key={week.key} data-week={week.key}>
              {(["me", "other"] as const).map((side) => {
                const value = week.source!.messages[side];
                const y = geometry.y(value);
                return <rect key={side} className={`activity-bar activity-bar-${side}`} x={side === "me" ? x - gap / 2 - barWidth : x + gap / 2}
                  y={y} width={barWidth} height={Math.max(0, geometry.bottom - y)} />;
              })}
            </g>;
          })}
          {selected ? <g className="chart-selection"><line x1={geometry.x(selected.day)} x2={geometry.x(selected.day)} y1={geometry.top} y2={geometry.bottom} /></g> : null}
        </g>
      </svg> : <p className="chart-empty">No weekly activity data available.</p>}
    </div>
    <p className="sr-only" id={instructions}>Both speakers share a zero baseline. Focus to inspect with arrow keys, Home/End; Escape clears.</p>

  </div>;
}

export function ActivityData({ weeks }: { weeks: TimelineWeek[] }) {
  return (
    <ChartData label="Weekly activity">{() =>
      <div className="chart-table-scroll" role="region" aria-label="Weekly activity data" tabIndex={0}>
        <table><caption>Weekly activity · Full report</caption>
          <thead><tr><th scope="col">Week</th><th scope="col">Me messages / words</th><th scope="col">Other messages / words</th><th scope="col">Episodes</th></tr></thead>
          <tbody>{weeks.map((week) => <tr key={week.key}>
            <th scope="row">{week.key}<span className="chart-cell-basis">{week.startDate} – {week.endDate}</span></th>
            {(["me", "other"] as const).map((side) => <td key={side}>{week.source ? `${formatNumber(week.source.messages[side])} messages / ${formatNumber(week.source.words[side])} words` : "No data supplied; counts unavailable."}</td>)}
            <td>{week.source ? formatNumber(week.source.episodes) : "No data supplied; count unavailable."}</td>
          </tr>)}</tbody>
        </table>
      </div>
    }</ChartData>
  );
}
