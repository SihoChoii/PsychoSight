import { useId, useMemo } from "react";
import type { ChartInspection } from "../charts/inspection";
import { reportReferenceId } from "./report/references";
import { ReportDisclosure } from "./report/ReportDisclosure";
import { ChartData } from "./report/ChartData";
import { useGraphReveal } from "./report/graph-reveal";
import { hitWeek, usePlotWidth } from "./report/chart-surface";
import { chartGeometry, lineSegments, segmentPath } from "../charts/geometry";
import type { ChartGeometry } from "../charts/geometry";
import type { ChartRow, FeatureChartModel } from "../charts/models";
import { countPhrase, formatAxis, formatCell } from "../format";
import type { Cell, Feature } from "../types";

const selfExplanatoryMetrics = new Set(['message_count', 'avg_words_per_message', 'i_pct', 'we_pct', 'late_night_episodes']);

export function TimelineChart({ model, rows = model.rows, inspection, totalEpisodes }: {
  model: FeatureChartModel; rows?: ChartRow[]; inspection: ChartInspection; totalEpisodes?: number;
}) {
  const { feature, domain } = model;
  const reveal = useGraphReveal<SVGSVGElement>();
  const titleId = reportReferenceId("feature", feature.key), instructionsId = useId();
  const { plot, width } = usePlotWidth();
  const { selectedKey, pinnedKey } = inspection;
  const selected = selectedKey === null ? undefined : model.byWeek.get(selectedKey);

  // Geometry and segmentation depend on the immutable model/width, never pointer state.
  const drawing = useMemo(() => {
    const geometry = chartGeometry(rows, domain, width, model.plotLeft);
    const dense = rows.length > (geometry.right - geometry.left) / 14;
    const series = (["me", "other"] as const).map((side) => {
      const segments = lineSegments(rows, side);
      return { side, path: segments.map((segment) => segmentPath(segment, side, geometry)).join(" "),
        marks: segments.flatMap((segment) => dense && segment.length > 1 ? [] : segment),
      };
    });
    return { geometry, series };
  }, [rows, domain, width, model.plotLeft]);
  const { geometry } = drawing;
  // These contain all observations/table rows. Reuse their elements during local inspection.
  const staticPlot = useMemo(() => <PlotDrawing {...drawing} unit={feature.unit} />, [drawing, feature.unit]);
  const dataTable = useMemo(() => <ChartTable model={model} totalEpisodes={totalEpisodes} />, [model, totalEpisodes]);

  const name = feature.approximate ? `${feature.label}, approximate` : feature.label;
  const information = !selfExplanatoryMetrics.has(feature.key) && feature.description.trim() ? <ReportDisclosure kind="info" label={`About this metric: ${name}`} title={name} className="metric-information">
          <p className="chart-description">{feature.description}</p>
        </ReportDisclosure> : null;
  return (
    <figure className="chart-block" aria-labelledby={titleId} data-feature={feature.key}>
      <div className="metric-heading"><div className="metric-title-with-info"><h3 id={titleId} tabIndex={-1}>{name}</h3>{information}</div></div>
      <div className="metric-toolbar"><p className="metric-unit">{feature.unit}</p><div className="metric-disclosures">{dataTable}</div></div>
      <div className="chart-plot" ref={plot}>
        {model.hasValues ? (
          <svg ref={reveal} viewBox={`0 0 ${geometry.width} ${geometry.height}`} width={geometry.width} height={geometry.height}
            role="img" tabIndex={0} aria-labelledby={titleId} aria-describedby={instructionsId}
            onPointerMove={(event) => { if (event.pointerType !== "touch") inspection.preview(rows[hitWeek(event, geometry) ?? -1]?.week.key ?? null); }}
            onPointerLeave={() => inspection.preview(null)}
            onClick={(event) => {
              inspection.pin(rows[hitWeek(event, geometry) ?? -1]?.week.key ?? null);
            }} onKeyDown={inspection.keyDown}>
            <title>{`${feature.label}. Me: solid line and filled circles. Other: dashed line and open squares. Gaps are unknown or insufficient data.`}</title>
            <g aria-hidden="true">
              {staticPlot}
              {selected ? <g className="chart-selection">
                <line x1={geometry.x(selected.week.day)} x2={geometry.x(selected.week.day)} y1={geometry.top} y2={geometry.bottom} />
                {(["other", "me"] as const).map((side) => <Mark key={side} row={selected} side={side} x={geometry.x(selected.week.day)} y={geometry.y} selected />)}
              </g> : null}
            </g>
          </svg>
        ) : <p className="chart-empty">Insufficient data. No weekly values available.</p>}
      </div>
      {model.hasValues ? <p className="sr-only" id={instructionsId}>Point to preview; click to pin. Focus the chart and use arrow keys, Home/End; Escape clears.</p> : null}
      <div className="chart-inspection-slot">{selected ? <div className="chart-inspector">
        <p>{selected.week.key} · {selected.week.startDate} – {selected.week.endDate}{pinnedKey === selectedKey ? " · Pinned" : ""}</p>
        <dl>
          <div><dt>Me</dt><dd><CellText cell={selected.me} feature={feature} totalEpisodes={selected.week.source?.episodes} /></dd></div>
          <div><dt>Other</dt><dd><CellText cell={selected.other} feature={feature} totalEpisodes={selected.week.source?.episodes} /></dd></div>
        </dl>
      </div> : <div className="metric-overview">
        <p>Full report</p>
        <dl className="metric-summary">
          <div><dt>Me</dt><dd>{formatCell(feature.overall.me, feature.unit)}</dd></div>
          <div><dt>Other</dt><dd>{formatCell(feature.overall.other, feature.unit)}</dd></div>
        </dl>
      </div>}</div>
    </figure>
  );
}

function PlotDrawing({ geometry, series, unit }: {
  geometry: ChartGeometry;
  series: { side: "me" | "other"; path: string; marks: ChartRow[] }[];
  unit: string;
}) {
  return <>
      <ChartAxes geometry={geometry} unit={unit} />
      <g data-graph-ink="">
      {series.map(({ side, path }) => <path key={side} className={`series-${side}`} d={path} />)}
      {/* Hollow squares first keep coincident zero/identical observations visible for both speakers. */}
      {[...series].reverse().map(({ side, marks }) => <g key={side}>
        {marks.map((row) => <Mark key={row.week.key} row={row} side={side} x={geometry.x(row.week.day)} y={geometry.y} />)}
      </g>)}
      </g>
  </>;
}

export function ChartAxes({ geometry, unit }: { geometry: ChartGeometry; unit: string }) {
  return <>
      {geometry.yTicks.map((tick) => <g key={tick.value}>
        <line className="axis-line" x1={geometry.left} x2={geometry.right} y1={tick.y} y2={tick.y} />
        <text className="chart-tick" x={geometry.left - 10} y={tick.y} dy="0.35em" textAnchor="end">{formatAxis(tick.value, unit)}</text>
      </g>)}
      {geometry.xTicks.map((tick) => <g key={tick.key}>
        <line className="axis-line" x1={tick.x} x2={tick.x} y1={geometry.bottom} y2={geometry.bottom + 5} />
        <text className="chart-tick" x={tick.x} y={geometry.bottom + 23} textAnchor={tick.anchor}>
          {tick.label}<tspan className="chart-tick-year" x={tick.x} dy="17">{tick.year}</tspan>
        </text>
      </g>)}

  </>;
}

function Mark({ row, side, x, y, selected = false }: {
  row: ChartRow; side: "me" | "other"; x: number; y: (value: number) => number; selected?: boolean;
}) {
  const value = row[side]?.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const radius = side === "me" ? selected ? 5 : 3 : selected ? 6 : 4;
  return side === "me"
    ? <circle className="series-me" cx={x} cy={y(value)} r={radius} />
    : <rect className="series-other-mark" x={x - radius} y={y(value) - radius} width={radius * 2} height={radius * 2} />;
}

function CellText({ cell, feature, totalEpisodes }: { cell?: Cell; feature: Feature; totalEpisodes?: number }) {
  if (!cell) return <>No data supplied for this week; count unavailable.</>;
  const count = countPhrase(cell, feature, totalEpisodes);
  return <><span>{formatCell(cell, feature.unit)}</span>{count ? <span className="chart-cell-basis">{count}</span> : null}
    {cell.value === null ? <span className="chart-cell-basis">Reason: {cell.reason ?? "insufficient data"}</span> : null}</>;
}

function ChartTable({ model, totalEpisodes }: { model: FeatureChartModel; totalEpisodes?: number }) {
  const { feature, rows } = model;
  return (
    <ChartData label={feature.label}>{() => <><div className="chart-overall-data">
        <h3>Full report overall</h3>
        <dl className="overall">
          <div><dt>Me</dt><dd><CellText cell={feature.overall.me} feature={feature} totalEpisodes={totalEpisodes} /></dd></div>
          <div><dt>Other</dt><dd><CellText cell={feature.overall.other} feature={feature} totalEpisodes={totalEpisodes} /></dd></div>
        </dl>
      </div><div className="chart-table-scroll" role="region" aria-label={`${feature.label} weekly data`} tabIndex={0}>
        <table aria-label={feature.label}>
          <caption>{feature.label} · Full report weekly data</caption>
          <thead><tr><th scope="col">Week</th><th scope="col">Me ({feature.unit})</th><th scope="col">Other ({feature.unit})</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.week.key}>
            <th scope="row">{row.week.key}<span className="chart-cell-basis">{row.week.startDate} – {row.week.endDate}</span></th>
            <td><CellText cell={row.me} feature={feature} totalEpisodes={row.week.source?.episodes} /></td>
            <td><CellText cell={row.other} feature={feature} totalEpisodes={row.week.source?.episodes} /></td>
          </tr>)}</tbody>
        </table>
      </div></>}
    </ChartData>
  );
}
