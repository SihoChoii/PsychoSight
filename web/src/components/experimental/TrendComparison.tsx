import { useId } from "react";
import type { ExpDimension, ExpTrendPoint } from "../../types";
import { experimentalTrend } from "../../experimental";
import { isoWeekDay } from "../../charts/timeline";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { SpeakerLegend } from "../SpeakerLegend";
import { ReportDisclosure } from "../report/ReportDisclosure";

const validValue = (point: ExpTrendPoint) => point.score !== null && Number.isFinite(point.score) && point.score >= 0 && point.score <= 100;

/** Both speakers share one real calendar and one independent trend domain. */
export function TrendComparison({ dim, active, trendNote = null }: { dim: ExpDimension; active: boolean; trendNote?: string | null }) {
  const clipId = useId().replaceAll(":", "");
  const { ref, revealed } = useScrollReveal<SVGSVGElement>();
  const showOther = dim.per_speaker.other !== null;
  const series = (["me", "other"] as const).filter(who => who === "me" || showOther).map(who => {
    const speaker = dim.per_speaker[who];
    const points = speaker?.trend ?? [];
    return { who, points, byWeek: new Map(points.map(point => [point.week, point])), plotted: speaker?.status === 'ok' ? points : [] };
  });
  const supplied = new Map(series.flatMap(({ points }) => points.map(point => [point.week, point] as const)));
  const weeks = experimentalTrend([...supplied.values()]).slots.map(slot => slot.week);
  const values = series.flatMap(({ plotted }) => plotted.flatMap(point => validValue(point) ? [point.score!] : []));
  const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 0;
  const width = 480, height = 160, padX = 8, padY = 12;
  const first = weeks.length ? isoWeekDay(weeks[0]) ?? 0 : 0, last = weeks.length ? isoWeekDay(weeks[weeks.length - 1]) ?? first : first;
  const xAt = (week: string) => first === last ? width / 2 : padX + ((isoWeekDay(week) ?? first) - first) / (last - first) * (width - padX * 2);
  const yAt = (value: number) => max === min ? height / 2 : padY + (max - value) / (max - min) * (height - padY * 2);
  const pathFor = (points: ExpTrendPoint[]) => {
    let path = "", previous: number | null = null;
    for (const point of [...points].sort((a, b) => a.week.localeCompare(b.week))) {
      const day = isoWeekDay(point.week);
      if (!validValue(point) || day === null) { previous = null; continue; }
      path += `${previous !== null && day - previous === 7 ? "L" : "M"}${xAt(point.week).toFixed(1)} ${yAt(point.score!).toFixed(1)} `;
      previous = day;
    }
    return path.trim();
  };
  return <div className="exp-trend">
    <div className="exp-trend-heading"><h5>Trend</h5><SpeakerLegend showOther={showOther} compact /></div>
    {values.length ? <>
      <p className="exp-trend-domain">Weekly trend domain: {min}–{max} · own scale</p>
      <svg ref={ref} className="exp-spark" viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`Weekly trend comparison. Me is a solid line with circles${showOther ? "; the other person is a dashed iris line with squares" : ""}.`}
        data-scale="trend" data-ymin={min} data-ymax={max} data-revealed={active && revealed}>
        <defs><clipPath id={`${clipId}-trend`}><rect className="exp-trend-wipe" width={width} height={height} /></clipPath></defs>
        <g clipPath={`url(#${clipId}-trend)`}>{series.map(({ who, plotted }) => <g key={who} data-speaker={who}>
          <path className={`series-${who}`} d={pathFor(plotted)} fill="none" />
          {plotted.map(point => !validValue(point) || isoWeekDay(point.week) === null ? null : <g key={point.week} data-week={point.week}>
            {who === "me" ? <circle className="series-me" cx={xAt(point.week)} cy={yAt(point.score!)} r="3" /> : <rect className="series-other-mark" x={xAt(point.week) - 3} y={yAt(point.score!) - 3} width="6" height="6" />}
          </g>)}
        </g>)}</g>
      </svg>
      <div className="exp-trend-calendar" aria-hidden="true"><span>{weeks[0]}</span><span>{weeks.at(-1)}</span></div>
    </> : <p>No weekly trend.</p>}
    <ReportDisclosure label="View trend data" title={`${dim.label} · trend data`} wide>
      {trendNote ? <p className="exp-trend-note">{trendNote}</p> : null}
      <div className="exp-table-wrap" role="region" aria-label="Weekly trend values and basis" tabIndex={0}>
        <table><caption>Weekly trend values</caption><thead><tr><th scope="col">Week</th>{series.map(({ who }) => <th scope="col" key={who}>{who === 'me' ? 'Me' : 'Other person'} · value / episodes / words</th>)}</tr></thead>
          <tbody>{weeks.map(week => <tr key={week}><th scope="row">{week}</th>{series.map(({ who, byWeek }) => {
            const point = byWeek.get(week);
            return <td key={who}>{point ? <><span>{validValue(point) ? point.score : point.reason ?? 'No trend value'}</span><span className="exp-trend-basis">{point.n_episodes.toLocaleString('en-US')} episodes · {point.n_words.toLocaleString('en-US')} words</span></> : <><span>No data supplied for this week</span><span className="exp-trend-basis">Episodes and words unavailable</span></>}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
      {!weeks.length ? <p>No weekly trend data supplied.</p> : null}
    </ReportDisclosure>
  </div>;
}
