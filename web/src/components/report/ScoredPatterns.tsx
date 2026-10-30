import { useId, type ReactNode } from "react";
import type { Quote, Report, RubricItem } from "../../types";
import { speakerLabel } from "../../format";
import { ClaimEvidence } from "./EvidenceQuote";
import { reportReferenceId } from "./references";
import { useContentReveal, useGraphReveal } from "./graph-reveal";
import { ReportDisclosure } from "./ReportDisclosure";
import { SectionStatus } from "./SectionStatus";

export function ScoredPatterns({ rubric, quotes, episodeReference, children }: {
  rubric: Report["rubric"]; quotes: ReadonlyMap<string, Quote>; episodeReference: (id: string) => ReactNode;
  children?: ReactNode;
}) {
  const introduction = useContentReveal<HTMLDivElement>();
  return <section className="section report-evidence" aria-labelledby="rubric-title" data-status={rubric.status}>
    <div className="section-heading"><h2 id="rubric-title" tabIndex={-1}>Scored patterns</h2></div>
    <SectionStatus status={rubric.status} reason={rubric.reason} />
    {children}
    {rubric.status === "ok" ? <>
      <div ref={introduction} className="scored-messages-heading score-fade"><div data-rise-content="" className="scored-messages-title">
        <h3>Scored messages</h3>
        <ReportDisclosure kind="info" label="How scored messages are counted" title="When ratings agree" className="rating-agreement-info">
          <RatingAgreement speaker={rubric.scored_speaker} />
        </ReportDisclosure>
      </div></div>
      {rubric.items.length ? <ul className="pattern-list">{rubric.items.map((item) => <Pattern key={item.key} item={item} quotes={quotes} episodeReference={episodeReference} />)}</ul> : <p>Insufficient data</p>}
    </> : null}
  </section>;
}

function RatingAgreement({ speaker }: { speaker?: string }) {
  return <div className="rating-agreement">
    <p>Each episode is rated twice per pattern. Ratings within one point on the 1–5 scale agree.</p>
    <table className="rating-agreement-examples">
      <caption>Example episode ratings</caption>
      <thead><tr><th scope="col">Rating 1</th><th scope="col">Rating 2</th><th scope="col">Result</th></tr></thead>
      <tbody>
        <tr data-included="true"><td><span className="rating-value">3</span></td><td><span className="rating-value">4</span></td><td><span className="rating-outcome"><i aria-hidden="true" />Included</span></td></tr>
        <tr><td><span className="rating-value">1</span></td><td><span className="rating-value">4</span></td><td><span className="rating-outcome"><i aria-hidden="true" />Left out</span></td></tr>
        <tr><td><span className="rating-value"><span aria-hidden="true">—</span><span className="sr-only">Missing</span></span></td><td><span className="rating-value">3</span></td><td><span className="rating-outcome"><i aria-hidden="true" />Left out</span></td></tr>
      </tbody>
    </table>
    <p>Only agreeing pairs enter that pattern’s mean and episode count. Missing ratings are left out.</p>
    <p className="rating-agreement-scope">Messages scored: {speaker ? speakerLabel(speaker) : "Scope not supplied"}</p>
  </div>;
}

function Pattern({ item, quotes, episodeReference }: {
  item: RubricItem; quotes: ReadonlyMap<string, Quote>; episodeReference: (id: string) => ReactNode;
}) {
  const descriptionId = useId();
  const descriptionReveal = useContentReveal<HTMLDivElement>();
  const resultReveal = useContentReveal<HTMLDivElement>();
  const reveal = useGraphReveal<HTMLDivElement>();
  const validMean = item.status === "ok" && typeof item.mean === "number" && Number.isFinite(item.mean) && item.mean >= 1 && item.mean <= 5;
  const statusText = item.status === "unstable" ? "Not stable enough to report" : item.status === "not_run" ? "Not run"
    : item.status === "failed" ? "Failed" : item.status === "insufficient_data" || item.mean === null ? "Insufficient data"
    : item.status !== "ok" ? item.status : "Score unavailable";
  // Rubric IDs resolve only in the top-level verified report collection.
  const evidence: Quote[] = [], missingIds: string[] = [];
  for (const id of item.quote_ids) { const quote = quotes.get(id); if (quote) evidence.push(quote); else missingIds.push(id); }
  return <li className="pattern-row" data-item-key={item.key} data-status={item.status}>
    <div ref={descriptionReveal} className="pattern-description score-fade"><div data-rise-content="">
      <div className="pattern-title-with-info"><h3 id={reportReferenceId("item", item.key)} tabIndex={-1}>{item.label}</h3>      <ReportDisclosure kind="info" label={`Anchors: ${item.label}`} title="Rating anchors" className="pattern-anchors">
        <dl>{(["1", "3", "5"] as const).map((anchor) => <div key={anchor}><dt>{anchor}</dt><dd>{item.anchors[anchor]}</dd></div>)}</dl>
      </ReportDisclosure></div>
      <p id={descriptionId}>{item.description}</p>
      <p className="evidence-scope">Messages scored: {speakerLabel(item.speaker)}</p>

    </div></div>
    <div ref={resultReveal} className="pattern-result score-fade"><div data-rise-content="">
      {validMean ? <>
        <p className="pattern-mean"><span>{String(item.mean)}</span> / 5 <span className="pattern-mean-label">mean</span></p>
        <div ref={reveal} className={`anchor-track anchor-track-${item.speaker === "other" ? "other" : "me"}`} role="img" aria-label={`${item.label}: mean ${item.mean} on the 1–5 anchors, ${item.n_scored} agreeing episodes`} aria-describedby={descriptionId}>
          <div className="anchor-line" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((anchor) => <span className="anchor-tick" key={anchor} style={{ left: `${(anchor - 1) * 25}%` }}>{anchor}</span>)}
            <span data-graph-ink="" className={`anchor-marker anchor-marker-${item.speaker === "other" ? "other" : "me"}`} style={{ left: `${((item.mean ?? 1) - 1) * 25}%` }} />
          </div>
        </div>
      </> : <p className="pattern-state" role={item.status === "failed" ? "alert" : undefined}>{statusText}</p>}
      {item.reason ? <p className="pattern-reason">{item.reason}</p> : null}
      <p className="pattern-basis">{item.n_scored} agreeing episodes</p>
      <p className="pattern-exclusions">{item.n_null} episodes with a null rating · {item.n_unstable_pairs} unstable pairs</p>
    </div></div>
    <ClaimEvidence reveal quotes={evidence} missingIds={missingIds} episodeReference={episodeReference} />
  </li>;
}
