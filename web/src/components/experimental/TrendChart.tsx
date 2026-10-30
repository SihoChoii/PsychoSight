import { useGraphReveal } from "../report/graph-reveal";
import { experimentalTrend } from "../../experimental";
import type { ExpTrendPoint } from "../../types";

export function TrendChart({ points, who, trendNote }: { points: ExpTrendPoint[]; who: "me" | "other"; trendNote: string | null }) {
  const reveal = useGraphReveal<SVGSVGElement>();
  const { slots, domain } = experimentalTrend(points);
  const width = 320, height = 140, pad = 6;
  const x = (i: number) => pad + (slots.length === 1 ? 0.5 : i / (slots.length - 1)) * (width - pad * 2);
  const y = (v: number) => domain ? pad + (1 - (v - domain[0]) / (domain[1] - domain[0])) * (height - pad * 2) : 0;
  let path = "", pen = false;
  slots.forEach(({ point }, i) => {
    if (point?.score === null || point?.score === undefined || !Number.isFinite(point.score)) { pen = false; return; }
    path += `${pen ? "L" : "M"}${x(i)} ${y(point.score)} `; pen = true;
  });
  return <div className="exp-trend">
    <h5>Weekly trend · {who === "me" ? "Me" : "Other person"}</h5>
    {trendNote ? <p className="exp-trend-note">{trendNote}</p> : null}
    {domain ? <>
      <p className="exp-trend-domain">Weekly trend domain: {domain[0]}–{domain[1]}</p>
      <div className="exp-trend-plot">
        <div className="exp-trend-y" aria-hidden="true"><span>{domain[1]}</span><span>{domain[0]}</span></div>
        <svg ref={reveal} className="exp-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img"
          aria-label={`Weekly trend for ${who === "me" ? "me" : "the other person"}. Domain ${domain[0]} to ${domain[1]}. Not directly comparable to the overall index.`}
          data-scale="trend" data-ymin={domain[0]} data-ymax={domain[1]}>
          {slots.map(({ week, point }, i) => point?.score === null || !point ? <rect key={week} className="exp-trend-gap" x={x(i)-4} y={0} width={8} height={height} /> : null)}
          <g data-graph-ink=""><path className={`exp-spark-line exp-spark-${who}`} d={path.trim()} />
          {slots.map(({ week, point }, i) => point?.score === null || point?.score === undefined || !Number.isFinite(point.score) ? null :
            who === "me" ? <circle key={week} className="exp-spark-dot" cx={x(i)} cy={y(point.score)} r={3} /> :
              <rect key={week} className="exp-spark-other-mark" x={x(i)-3} y={y(point.score)-3} width={6} height={6} />)}
          </g>
        </svg>
      </div>
      <div className="exp-trend-x" aria-hidden="true"><span>{slots[0]?.week}</span><span>{slots.at(-1)?.week}</span></div>
    </> : <p>No weekly trend.</p>}
    {slots.length ? <div className="exp-table-wrap" role="region" aria-label="Weekly trend values and basis" tabIndex={0}>
      <table><caption>Weekly trend values and basis · own scale</caption>
        <thead><tr><th scope="col">Week</th><th scope="col">Trend value / reason</th><th scope="col">Episodes</th><th scope="col">Words</th></tr></thead>
        <tbody>{slots.map(({ week, point }) => <tr key={week}><th scope="row">{week}</th>
          <td>{point ? point.score === null ? point.reason ?? "No trend value" : point.score : "No data supplied for this week"}</td>
          <td>{point ? point.n_episodes.toLocaleString("en-US") : "Unavailable"}</td><td>{point ? point.n_words.toLocaleString("en-US") : "Unavailable"}</td>
        </tr>)}</tbody>
      </table>
    </div> : null}
  </div>;
}
