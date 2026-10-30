import { useMemo, type ReactNode } from "react";
import type { Feature, Report } from "../../types";
import { ClaimEvidence } from "./EvidenceQuote";
import { focusReportReference } from "./references";
import { SectionStatus } from "./SectionStatus";

export function Observations({ observations, rubric, features, episodeReference }: {
  observations: Report["observations"]; rubric: Report["rubric"]; features: Feature[]; episodeReference: (id: string) => ReactNode;
}) {
  const items = useMemo(() => new Map((rubric.status === "ok" ? rubric.items : []).map((item) => [item.key, item.label])), [rubric]);
  const series = useMemo(() => new Map(features.map((feature) => [feature.key, feature.label])), [features]);
  return <section className="section report-evidence" aria-labelledby="observations-title" data-status={observations.status}>
    <div className="section-heading"><h2 id="observations-title" tabIndex={-1}>Observations</h2></div>
    <SectionStatus status={observations.status} reason={observations.reason} />
    {observations.note ? <p className="evidence-intro">{observations.note}</p> : null}
    {observations.status === "ok" ? observations.items.length ? <ol className="observation-list">{observations.items.map((item) => <li className="observation-row" key={item.observation_id} data-observation-id={item.observation_id}>
      <div className="observation-claim">
        <p className="observation-text">{item.text}</p>
        <p className="observation-basis"><span>Confidence: {item.confidence}</span><span>{item.supporting_episodes} supporting episodes</span></p>
        {item.item_keys.length || item.feature_keys.length ? <div className="evidence-references" aria-label="Related patterns">
          {item.item_keys.map((key) => <Reference key={`item-${key}`} kind="item" itemKey={key} label={items.get(key)} />)}
          {item.feature_keys.map((key) => <Reference key={`feature-${key}`} kind="feature" itemKey={key} label={series.get(key)} />)}
        </div> : null}
        {item.episode_ids.length ? <p className="episode-references">Referenced episodes: {item.episode_ids.map((id) => <span key={id}>{episodeReference(id)} </span>)}</p> : null}
      </div>
      {/* Observation quotes are the supplied embedded report evidence, never experimental lookups. */}
      <ClaimEvidence quoteReveal quotes={item.quotes} episodeReference={episodeReference} />
    </li>)}</ol> : <p>Insufficient data</p> : null}
  </section>;
}

function Reference({ kind, itemKey, label }: { kind: "item" | "feature"; itemKey: string; label?: string }) {
  return label ? <button type="button" className="evidence-reference" onClick={() => focusReportReference(kind, itemKey)}>View {label}</button>
    : <span className="evidence-unavailable">{itemKey} · {kind === "item" ? "Pattern" : "Feature"} unavailable</span>;
}
