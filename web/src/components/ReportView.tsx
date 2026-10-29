import { useState } from "react";
import { formatCellLine, formatDay, formatTimestamp, orderedSeries, speakerLabel } from "../format";
import type { Quote, Report, RubricItem } from "../types";
import { DeleteDialog } from "./DeleteDialog";
import { ExperimentalScores } from "./ExperimentalScores";
import { TimelineChart } from "./TimelineChart";

export function ReportView({
  report,
  deleting,
  deleteError,
  onDelete,
}: {
  report: Report;
  deleting: boolean;
  deleteError: string | null;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { header } = report;
  const range =
    header.date_from && header.date_to ? `${header.date_from} – ${header.date_to}` : "Insufficient data";
  const quotes = new Map(report.quotes.map((quote) => [quote.quote_id, quote]));

  return (
    <>
      <header className="report-intro" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>
          {header.conversation_label}
        </h1>
        {header.is_demo ? <p className="status-line">Demo data</p> : null}
        <p>{range}</p>
        <p>
          {header.message_counts.me} messages from me, {header.message_counts.other} from the other person
        </p>
        <p>{header.episode_count} episodes</p>
      </header>

      <section className="section" aria-labelledby="weeks-title">
        <div className="section-heading">
          <h2 id="weeks-title">Weekly patterns</h2>
        </div>
        <ul className="legend">
          <li>
            <svg aria-hidden="true" viewBox="0 0 56 12" width="56" height="12">
              <line className="series-me" x1="0" y1="6" x2="36" y2="6" />
              <circle className="series-me" cx="46" cy="6" r="4" />
            </svg>
            Me, solid line
          </li>
          <li>
            <svg aria-hidden="true" viewBox="0 0 56 12" width="56" height="12">
              <line className="series-other" x1="0" y1="6" x2="36" y2="6" />
              <rect className="series-other-mark" x="42" y="2" width="8" height="8" />
            </svg>
            Other, dashed line
          </li>
        </ul>
        <p className="chart-description">Gaps in a line are weeks with insufficient data.</p>
        {orderedSeries(report.series).map((feature) => (
          <div className="chart-feature" key={feature.key}>
            <dl className="overall">
              <div>
                <dt>Me</dt>
                <dd>{formatCellLine(feature.overall.me, feature)}</dd>
              </div>
              <div>
                <dt>Other</dt>
                <dd>{formatCellLine(feature.overall.other, feature)}</dd>
              </div>
            </dl>
            <TimelineChart feature={feature} weeks={report.weeks} />
          </div>
        ))}
      </section>

      <section className="section" aria-labelledby="rubric-title" data-status={report.rubric.status}>
        <div className="section-heading">
          <h2 id="rubric-title">Scored patterns</h2>
        </div>
        <SectionStatus status={report.rubric.status} reason={report.rubric.reason} />
        {report.rubric.status === "ok" ? (
          <>
            <ul className="plain-list">
              {report.rubric.items.map((item) => (
                <li key={item.key}>
                  <h3>{item.label}</h3>
                  <RubricValue item={item} />
                  <QuoteList quotes={item.quote_ids.map((id) => quotes.get(id)).filter((quote): quote is Quote => !!quote)} />
                </li>
              ))}
            </ul>
            {report.rubric.items.some((item) => item.anchors) ? (
              <details className="details">
                <summary>Anchors</summary>
                {report.rubric.items.map((item) => (
                  <div key={item.key}>
                    <h3>{item.label}</h3>
                    <p>1. {item.anchors["1"]}</p>
                    <p>3. {item.anchors["3"]}</p>
                    <p>5. {item.anchors["5"]}</p>
                  </div>
                ))}
              </details>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="section" aria-labelledby="observations-title" data-status={report.observations.status}>
        <div className="section-heading">
          <h2 id="observations-title">Observations</h2>
        </div>
        <SectionStatus status={report.observations.status} reason={report.observations.reason} />
        {report.observations.status === "ok" && report.observations.items.length === 0 ? (
          <p>Insufficient data</p>
        ) : null}
        {report.observations.status === "ok" ? (
          <ol className="plain-list">
            {report.observations.items.map((item) => (
              <li key={item.observation_id}>
                <p>{item.text}</p>
                <p className="confidence">Confidence: {item.confidence}</p>
                <p>{item.supporting_episodes} episodes</p>
                <QuoteList quotes={item.quotes} />
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      <section className="section" aria-labelledby="limits-title">
        <div className="section-heading">
          <h2 id="limits-title">{report.limitations_title}</h2>
        </div>
        <ul className="limits">
          {report.limitations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="section">
        <p className="disclaimer">{report.disclaimer}</p>
        <details className="details">
          <summary>Details</summary>
          <dl className="meta-list">
            <div>
              <dt>Run</dt>
              <dd>{report.run_meta.run_id}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{formatDay(report.run_meta.created_at)}</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{header.timezone || "Insufficient data"}</dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{report.run_meta.provider ?? "Not used"}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{report.run_meta.model ?? "Not used"}</dd>
            </div>
          </dl>
        </details>
        {deleteError ? (
          <p className="field-error" role="alert">
            {deleteError}
          </p>
        ) : null}
        <div className="actions">
          <button type="button" className="button button-secondary" onClick={() => setConfirming(true)}>
            Delete report
          </button>
        </div>
      </section>

      {report.experimental_scores ? <ExperimentalScores section={report.experimental_scores} /> : null}

      <DeleteDialog
        open={confirming}
        busy={deleting}
        onCancel={() => setConfirming(false)}
        onConfirm={onDelete}
      />
    </>
  );
}

function SectionStatus({ status, reason }: { status: string; reason: string | null }) {
  if (status === "ok") return null;
  if (status === "not_run") return <p data-status="not_run">{reason ?? "Not run."}</p>;
  if (status === "failed") {
    return (
      <p role="alert" data-status="failed">
        {reason ?? "This section failed."}
      </p>
    );
  }
  return <p data-status="insufficient_data">{reason && reason !== "insufficient data" ? reason : "Insufficient data"}</p>;
}

function RubricValue({ item }: { item: RubricItem }) {
  if (item.status === "unstable") return <p>Not stable enough to report</p>;
  if (item.status === "insufficient_data" || item.status === "not_run" || item.mean === null) {
    return <p>Insufficient data</p>;
  }
  const mean = Number.isInteger(item.mean) ? String(item.mean) : String(Math.round(item.mean * 100) / 100);
  return (
    <p>
      {mean} on the 1–5 anchors, across {item.n_scored} episodes
    </p>
  );
}

function QuoteList({ quotes }: { quotes: Quote[] }) {
  if (quotes.length === 0) return null;
  return (
    <div className="quotes">
      {quotes.map((quote) => (
        <blockquote key={quote.quote_id}>
          <p>{quote.text}</p>
          <p className="quote-meta">
            {speakerLabel(quote.speaker)} · {quote.episode_id} · {formatTimestamp(quote.timestamp)}
          </p>
        </blockquote>
      ))}
    </div>
  );
}
