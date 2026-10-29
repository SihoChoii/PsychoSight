import { useId, type ReactNode } from "react";
import type { Quote, Report, RubricItem } from "../../types";
import { speakerLabel } from "../../format";
import { ClaimEvidence } from "./EvidenceQuote";
import { reportReferenceId } from "./references";
import { SectionStatus } from "./SectionStatus";

export function ScoredPatterns({ rubric, quotes, episodeReference }: {
  rubric: Report["rubric"]; quotes: ReadonlyMap<string, Quote>; episodeReference: (id: string) => ReactNode;
}) {
  return <section className="section report-evidence" aria-labelledby="rubric-title" data-status={rubric.status}>
    <div className="section-heading"><h2 id="rubric-title" tabIndex={-1}>Scored patterns</h2></div>
    <SectionStatus status={rubric.status} reason={rubric.reason} />
    {rubric.status === "ok" ? <>
      <p className="evidence-intro">Scored messages: {rubric.scored_speaker ? speakerLabel(rubric.scored_speaker) : "Scope not supplied"}. Each episode is rated twice; counts below are episodes with agreeing ratings for that pattern.</p>
      {rubric.items.length ? <ul className="pattern-list">{rubric.items.map((item) => <Pattern key={item.key} item={item} quotes={quotes} episodeReference={episodeReference} />)}</ul> : <p>Insufficient data</p>}
    </> : null}
  </section>;
}

function Pattern({ item, quotes, episodeReference }: {
  item: RubricItem; quotes: ReadonlyMap<string, Quote>; episodeReference: (id: string) => ReactNode;
}) {
  const descriptionId = useId();
  const validMean = item.status === "ok" && typeof item.mean === "number" && Number.isFinite(item.mean) && item.mean >= 1 && item.mean <= 5;
  const statusText = item.status === "unstable" ? "Not stable enough to report" : item.status === "not_run" ? "Not run"
    : item.status === "failed" ? "Failed" : item.status === "insufficient_data" || item.mean === null ? "Insufficient data"
    : item.status !== "ok" ? item.status : "Score unavailable";
  // Rubric IDs resolve only in the top-level verified report collection.
  const evidence: Quote[] = [], missingIds: string[] = [];
  for (const id of item.quote_ids) { const quote = quotes.get(id); if (quote) evidence.push(quote); else missingIds.push(id); }
  return <li className="pattern-row" data-item-key={item.key} data-status={item.status}>
    <div className="pattern-description">
      <h3 id={reportReferenceId("item", item.key)} tabIndex={-1}>{item.label}</h3>
      <p id={descriptionId}>{item.description}</p>
      <p className="evidence-scope">Messages scored: {speakerLabel(item.speaker)}</p>
      <details className="pattern-anchors"><summary>Anchors<span className="sr-only">: {item.label}</span></summary>
        <dl>{(["1", "3", "5"] as const).map((anchor) => <div key={anchor}><dt>{anchor}</dt><dd>{item.anchors[anchor]}</dd></div>)}</dl>
      </details>
    </div>
    <div className="pattern-result">
      {validMean ? <>
        <p className="pattern-mean"><span>{String(item.mean)}</span> / 5 <span className="pattern-mean-label">mean</span></p>
        <div className={`anchor-track anchor-track-${item.speaker === "other" ? "other" : "me"}`} role="img" aria-label={`${item.label}: mean ${item.mean} on the 1–5 anchors, ${item.n_scored} agreeing episodes`} aria-describedby={descriptionId}>
          <div className="anchor-line" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((anchor) => <span className="anchor-tick" key={anchor} style={{ left: `${(anchor - 1) * 25}%` }}>{anchor}</span>)}
            <span className={`anchor-marker anchor-marker-${item.speaker === "other" ? "other" : "me"}`} style={{ left: `${((item.mean ?? 1) - 1) * 25}%` }} />
          </div>
        </div>
      </> : <p className="pattern-state" role={item.status === "failed" ? "alert" : undefined}>{statusText}</p>}
      {item.reason ? <p className="pattern-reason">{item.reason}</p> : null}
      <p className="pattern-basis">{item.n_scored} agreeing episodes</p>
      <p className="pattern-exclusions">{item.n_null} episodes with a null rating · {item.n_unstable_pairs} unstable pairs</p>
    </div>
    <ClaimEvidence quotes={evidence} missingIds={missingIds} episodeReference={episodeReference} />
  </li>;
}
