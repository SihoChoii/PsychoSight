import { useId, useMemo, useState, type CSSProperties } from "react";
import { chartGeometry, lineSegments, segmentPath } from "../../charts/geometry";
import type { ChartRow } from "../../charts/models";
import type { MetricDomain } from "../../charts/scales";
import type { ChartInspection } from "../../charts/inspection";
import type { TimelineWeek } from "../../charts/timeline";
import { formatAxis, formatNumber } from "../../format";
import { ChartAxes } from "../TimelineChart";
import { useGraphReveal } from "./graph-reveal";
import { hitWeek, usePlotWidth } from "./chart-surface";
import { ChartData } from "./ChartData";
import { SpeakerLegend } from "../SpeakerLegend";

export function WeeklyActivity({ rows, domain, plotLeft, inspection, selected }: {
  rows: ChartRow[]; domain: MetricDomain; plotLeft: number;
  inspection: ChartInspection; selected?: TimelineWeek;
}) {
  const { plot, width } = usePlotWidth();
  const reveal = useGraphReveal<SVGSVGElement>();
  const instructions = useId();
  const [view, setView] = useState<"lines" | "bars">("lines");
  const plotHeight = width < 600 ? 260 : 340;
  const geometry = useMemo(() => chartGeometry(rows, domain, width, plotLeft, plotHeight), [rows, domain, width, plotLeft, plotHeight]);
  const series = useMemo(() => (["me", "other"] as const).map((side) => {
    const segments = lineSegments(rows, side);
    return { side, path: segments.map((segment) => segmentPath(segment, side, geometry)).join(" "),
      area: segments.map((segment) => {
        const first = segment[0], last = segment.at(-1);
        return first && last && first !== last
          ? `${segmentPath(segment, side, geometry)} L${geometry.x(last.week.day)} ${geometry.bottom} L${geometry.x(first.week.day)} ${geometry.bottom} Z` : "";
      }).join(" "),
      marks: segments.flatMap((segment) => rows.length <= 32 || segment.length === 1 ? segment : []),
    };
  }), [rows, geometry]);
  const barWidth = Math.max(0.25, Math.min(8, (geometry.right - geometry.left) / Math.max(1, rows.length - 1) * 0.34));
  const gap = Math.min(2, barWidth / 3);
  return <div className="weekly-activity">
    <div className="activity-chart-heading"><p>Messages per week</p>
      <div className="activity-plot-controls"><SpeakerLegend compact />
        <div className="chart-view-toggle" role="group" aria-label="Activity chart view">
          <button type="button" aria-label="Show lines" title="Lines" aria-pressed={view === "lines"} onClick={() => setView("lines")}>
            <svg viewBox="0 0 24 20" width="24" height="20" aria-hidden="true"><path d="M2 15 8 9 13 12 21 3" /></svg>
          </button>
          <button type="button" aria-label="Show bars" title="Bars" aria-pressed={view === "bars"} onClick={() => setView("bars")}>
            <svg viewBox="0 0 24 20" width="24" height="20" aria-hidden="true"><path d="M4 17V11 M11 17V4 M18 17V8" /></svg>
          </button>
        </div>
      </div>
    </div>
    <p className="chart-scale sr-only">Scale: 0–{formatAxis(domain.max, "messages")} messages per speaker · full-report scale</p>
    <div className="chart-plot" ref={plot} style={{ "--activity-height": `${plotHeight}px` } as CSSProperties}>
      {rows.length ? <svg ref={reveal} viewBox={`0 0 ${geometry.width} ${geometry.height}`} width={geometry.width} height={geometry.height}
        role="img" aria-label="Weekly message activity" aria-describedby={instructions} tabIndex={0}
        onPointerMove={(event) => { if (event.pointerType !== "touch") inspection.preview(rows[hitWeek(event, geometry) ?? -1]?.week.key ?? null); }}
        onPointerLeave={() => inspection.preview(null)}
        onClick={(event) => inspection.pin(rows[hitWeek(event, geometry) ?? -1]?.week.key ?? null)} onKeyDown={inspection.keyDown}>
        <title>Weekly messages. Me: solid. Other: dashed. Shared zero baseline; missing activity is unknown.</title>
        <g aria-hidden="true">
          <ChartAxes geometry={geometry} unit="messages" />
          <g data-graph-ink="">
          {view === "lines" ? <>
            {series.map(({ side, area }) => <path key={side} className={`activity-area activity-area-${side}`} d={area} />)}
            {series.map(({ side, path }) => <path key={side} className={`series-${side}`} d={path} />)}
            {[...series].reverse().map(({ side, marks }) => <g key={side}>{marks.map((row) => {
              const value = row[side]?.value;
              if (typeof value !== "number") return null;
              const x = geometry.x(row.week.day), y = geometry.y(value);
              return side === "me" ? <circle key={row.week.key} className="series-me" cx={x} cy={y} r="2.5" />
                : <rect key={row.week.key} className="series-other-mark" x={x - 3} y={y - 3} width="6" height="6" />;
            })}</g>)}
          </> : null}
          {rows.map(({ week }) => {
            if (!week.source) return null;
            const x = geometry.x(week.day);
            return <g key={week.key} data-week={week.key}>
              {view === "bars" ? (["me", "other"] as const).map((side) => {
                const value = week.source!.messages[side];
                const y = geometry.y(value);
                return <rect key={side} className={`activity-bar activity-bar-${side}`} x={side === "me" ? x - gap / 2 - barWidth : x + gap / 2}
                  y={y} width={barWidth} height={Math.max(0, geometry.bottom - y)} />;
              }) : null}
            </g>;
          })}
          </g>
          {selected ? <g className="chart-selection"><line x1={geometry.x(selected.day)} x2={geometry.x(selected.day)} y1={geometry.top} y2={geometry.bottom} />
            {selected.source ? <>
              <rect className="series-other-mark" x={geometry.x(selected.day) - 5} y={geometry.y(selected.source.messages.other) - 5} width="10" height="10" />
              <circle className="series-me" cx={geometry.x(selected.day)} cy={geometry.y(selected.source.messages.me)} r="5" />
            </> : null}
          </g> : null}
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
