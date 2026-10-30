import { useMemo } from 'react';
import type { Report } from '../../types';
import { buildFeatureSummaries, measuredValue, summaryValue } from '../../charts/feature-summaries';
import { focusReportReference } from './references';

export function FeatureSummary({ report }: { report: Report }) {
  const summaries = useMemo(() => buildFeatureSummaries(report), [report.series]);
  return <section className="section feature-summary" aria-labelledby="feature-summary-title">
    <div className="section-heading"><h2 id="feature-summary-title" tabIndex={-1}>Reading the patterns</h2>
      <p className="feature-summary-intro">A whole-conversation summary of the measurements above.</p>
    </div>
    {summaries.length ? <div className="feature-summary-grid">{summaries.map(summary => <article key={summary.key} className="feature-summary-card" aria-labelledby={`summary-${summary.key}`} data-summary={summary.key}>
      <h3 id={`summary-${summary.key}`}>{summary.title}</h3>
      <div className="feature-summary-measures">
        {summary.key === 'pronouns' ? <table className="summary-pronouns"><caption className="sr-only">Whole-conversation pronoun rates</caption><thead><tr><th scope="col"><span className="sr-only">Word group</span></th><th scope="col">Me</th><th scope="col">Other</th></tr></thead><tbody>
          {summary.metrics.map(({ label, feature }) => <tr key={feature.key}><th scope="row">{label}</th>{(['me', 'other'] as const).map(side => <td key={side} data-speaker={side} data-available={measuredValue(feature.overall[side], feature) !== null}>{summaryValue(feature.overall[side], feature)}</td>)}</tr>)}
        </tbody></table> : <dl className="summary-pair">{(['me', 'other'] as const).map(side => {
          const feature = summary.metrics[0].feature;
          return <div key={side} data-speaker={side}><dt><i aria-hidden="true"/>{side === 'me' ? 'Me' : 'Other person'}</dt><dd data-available={measuredValue(feature.overall[side], feature) !== null}>{summaryValue(feature.overall[side], feature)}</dd></div>;
        })}</dl>}
        <p className="summary-unit">{summary.unit}</p>
      </div>
      <p className="summary-reading">{summary.reading}</p>
      <p className="summary-context">{summary.context}</p>
      <div className="summary-actions">
        <div className="summary-trends">{summary.metrics.map(({ label, feature }) => <button key={feature.key} type="button" aria-label={`View weekly pattern: ${feature.label}`} onClick={() => focusReportReference('feature', feature.key)}>{summary.metrics.length > 1 ? `View ${label.toLowerCase()}` : 'View weekly pattern'}</button>)}</div>

      </div>
    </article>)}</div> : <p className="summary-empty">Feature summaries are unavailable in this saved report.</p>}
    {summaries.length ? <p className="feature-summary-note">These measurements describe this conversation. Context and intent still need a human reading.</p> : null}
  </section>;
}
