import { formatCell, numericDate, shortDate } from "../format";
import type { Feature, Week } from "../types";

export function TimelineChart({ feature, weeks }: { feature: Feature; weeks: Week[] }) {
  const values = feature.points.flatMap((point) =>
    [point.me.value, point.other.value].filter((value): value is number => value !== null),
  );
  const titleId = `chart-${feature.key}`;
  if (values.length === 0) {
    return (
      <figure className="chart-block" aria-labelledby={titleId}>
        <ChartHeading feature={feature} titleId={titleId} />
        <p>Insufficient data</p>
        <ChartTable feature={feature} weeks={weeks} />
      </figure>
    );
  }

  const dataMax = Math.max(0, ...values);
  const yMax = dataMax === 0 ? 1 : dataMax * 1.1;
  const width = 720;
  const height = 220;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 12;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const xAt = (index: number) =>
    padL + (feature.points.length === 1 ? innerW / 2 : (index / (feature.points.length - 1)) * innerW);
  const yAt = (value: number) => padT + innerH - (value / yMax) * innerH;

  const labels = feature.points.map((point) => {
    const week = weeks.find((item) => item.week === point.week);
    const source = week?.start_date ?? point.week;
    return { full: week ? shortDate(week.start_date) : point.week, short: week ? numericDate(source) : point.week };
  });

  return (
    <figure className="chart-block" aria-labelledby={titleId}>
      <ChartHeading feature={feature} titleId={titleId} />
      <div className="chart-scroll">
        <div className="chart-plot">
          <div className="chart-y" aria-hidden="true">
            <span>{formatAxis(dataMax, feature.unit)}</span>
            <span>0</span>
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId}>
            <title>{`${feature.label}. Solid line with circles is me. Dashed line with squares is the other person. Gaps are insufficient data.`}</title>
            <line className="axis-line" x1={padL} y1={yAt(0)} x2={width - padR} y2={yAt(0)} />
            <path className="series-me" d={pathFor(feature, "me", xAt, yAt)} fill="none" />
            <path className="series-other" d={pathFor(feature, "other", xAt, yAt)} fill="none" />
            {feature.points.map((point, index) => (
              <g key={point.week}>
                {point.me.value !== null ? (
                  <circle className="series-me" cx={xAt(index)} cy={yAt(point.me.value)} r={4} />
                ) : null}
                {point.other.value !== null ? (
                  <rect
                    className="series-other-mark"
                    x={xAt(index) - 4}
                    y={yAt(point.other.value) - 4}
                    width={8}
                    height={8}
                  />
                ) : null}
              </g>
            ))}
          </svg>
        </div>
        <div className="chart-x" aria-hidden="true">
          {labels.map((label, index) => (
            <span key={feature.points[index].week}>
              <span className="x-full">{label.full}</span>
              <span className="x-short">{label.short}</span>
            </span>
          ))}
        </div>
      </div>
      <ChartTable feature={feature} weeks={weeks} />
    </figure>
  );
}

function ChartHeading({ feature, titleId }: { feature: Feature; titleId: string }) {
  const name = feature.approximate ? `${feature.label}, approximate` : feature.label;
  return (
    <>
      <h3 id={titleId}>{name}</h3>
      <p className="chart-description">{feature.description}</p>
    </>
  );
}

function ChartTable({ feature, weeks }: { feature: Feature; weeks: Week[] }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{feature.label}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Me</th>
            <th scope="col">Other</th>
          </tr>
        </thead>
        <tbody>
          {feature.points.map((point) => {
            const week = weeks.find((item) => item.week === point.week);
            return (
              <tr key={point.week}>
                <th scope="row">
                  {point.week}
                  {week ? ` ${week.start_date}` : ""}
                </th>
                <td>{formatCell(point.me, feature.unit)}</td>
                <td>{formatCell(point.other, feature.unit)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function pathFor(
  feature: Feature,
  side: "me" | "other",
  xAt: (index: number) => number,
  yAt: (value: number) => number,
): string {
  let path = "";
  let open = false;
  feature.points.forEach((point, index) => {
    const value = point[side].value;
    if (value === null) {
      open = false;
      return;
    }
    path += `${open ? "L" : "M"}${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)} `;
    open = true;
  });
  return path.trim();
}

function formatAxis(value: number, unit: string): string {
  if (unit.startsWith("%")) return `${trim(value)}%`;
  return trim(value);
}

function trim(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 10) / 10);
}
