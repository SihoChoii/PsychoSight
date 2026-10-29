import type { Cell, Feature, Report } from "../types";
import { formatAxis, orderedSeries } from "../format";
import { buildDomains, countDomain, type MetricDomain } from "./scales";
import { buildTimeline, type TimelineWeek } from "./timeline";

export interface ChartRow {
  week: TimelineWeek;
  me?: Cell;
  other?: Cell;
}

export interface FeatureChartModel {
  feature: Feature;
  domain: MetricDomain;
  rows: ChartRow[];
  byWeek: ReadonlyMap<string, ChartRow>;
  hasValues: boolean;
  plotLeft: number;
}

/** One immutable report adapter: no joins or feature-array scans during inspection. */
export function buildReportCharts(report: Pick<Report, "weeks" | "series">) {
  const timeline = buildTimeline(report.weeks, report.series);
  const domains = buildDomains(report.series);
  // A report-wide gutter keeps time positions aligned across metrics with different units.
  let plotLeft = 40;
  for (const feature of report.series) {
    for (const tick of domains.get(feature.key)?.ticks ?? []) {
      plotLeft = Math.max(plotLeft, formatAxis(tick, feature.unit).length * 8.5 + 22);
    }
  }
  const features: FeatureChartModel[] = orderedSeries(report.series).map((feature) => {
    const points = new Map(feature.points.map((point) => [point.week, point]));
    const rows = timeline.weeks.map((week) => {
      const point = points.get(week.key);
      return { week, me: point?.me, other: point?.other };
    });
    // Every feature was passed to buildDomains, including unknown future features.
    const domain = domains.get(feature.key);
    if (!domain) throw new Error(`Missing chart domain for ${feature.key}`);
    return { feature, domain, rows, plotLeft, byWeek: new Map(rows.map((row) => [row.week.key, row])),
      hasValues: rows.some((row) => [row.me?.value, row.other?.value].some((value) => typeof value === "number" && Number.isFinite(value))),
    };
  });
  const activityRows: ChartRow[] = timeline.weeks.map((week) => ({ week,
    me: week.source ? { value: week.source.messages.me, count: week.source.messages.me } : undefined,
    other: week.source ? { value: week.source.messages.other, count: week.source.messages.other } : undefined,
  }));
  let maximumMessages = 0;
  for (const { week } of activityRows) if (week.source) maximumMessages = Math.max(maximumMessages, week.source.messages.me, week.source.messages.other);
  const activityDomain = countDomain(maximumMessages);
  // Activity can have a larger value than the corresponding legacy/partial feature series.
  for (const tick of activityDomain.ticks) plotLeft = Math.max(plotLeft, formatAxis(tick, "messages").length * 8.5 + 22);
  for (const feature of features) feature.plotLeft = plotLeft;
  return { timeline, features, plotLeft, activityRows, activityDomain };
}
