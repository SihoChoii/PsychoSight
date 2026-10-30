import { useId } from "react";
import { basisText, confidenceLabel, evidenceLabel, hasScore, speakerMessage } from "../../experimental";
import type { ExpDimension, ExpQuote, ExpSpeakerScore } from "../../types";
import { useGraphReveal } from "../report/graph-reveal";
import { ReportDisclosure } from "../report/ReportDisclosure";
import { ContributionPanel } from "./ContributionPanel";
import { TrendChart } from "./TrendChart";

type QuoteIndex = ReadonlyMap<string, ExpQuote>;

export function DimensionRow({ dim, quotes, trendNote }: {
  dim: ExpDimension; quotes: QuoteIndex; trendNote: string | null;
}) {
  return <article className="exp-dim" aria-labelledby={`exp-dim-${dim.key}`}>
    <div className="exp-dim-label">
      <h4 id={`exp-dim-${dim.key}`}>{dim.label}</h4>
      <p className="exp-evidence">{evidenceLabel(dim.evidence_strength)}</p>
      <p className="exp-note">{dim.evidence_note}</p>
    </div>
    <div className="exp-comparisons">
      <SpeakerComparison who="me" speaker={dim.per_speaker.me} dim={dim} quotes={quotes} trendNote={trendNote} />
      {dim.per_speaker.other ? <SpeakerComparison who="other" speaker={dim.per_speaker.other} dim={dim} quotes={quotes} trendNote={trendNote} /> : null}
    </div>
  </article>;
}

function SpeakerComparison({ who, speaker, dim, quotes, trendNote }: {
  who: "me" | "other"; speaker: ExpSpeakerScore; dim: ExpDimension; quotes: QuoteIndex; trendNote: string | null;
}) {
  const whoId = useId();
  const message = speakerMessage(speaker);
  const scored = hasScore(speaker);
  return <div className={`exp-speaker exp-speaker-${who}`} data-speaker={who} data-status={speaker.status}>
    <div className="exp-speaker-summary">
      <div className="exp-speaker-actions">
        <p className="exp-who" id={whoId}><span className={`exp-cue exp-cue-${who}`} aria-hidden="true" />{who === "me" ? "Me" : "Other person"}</p>

        <ReportDisclosure label="Why this number" title={`${dim.label} · ${who === "me" ? "Me" : "Other person"}`} descriptionId={`${whoId} exp-dim-${dim.key}`} className="exp-drilldown">
        <p className="exp-detail-heading">{dim.label} · {who === "me" ? "Me" : "Other person"}</p>
        <ContributionPanel dimKey={dim.key} who={who} speaker={speaker} quotes={quotes} />
        <TrendChart points={speaker.trend} who={who} trendNote={trendNote} />
        <div className="exp-citations"><h5>Research context</h5><p>{dim.evidence_note}</p>
          {dim.citations.length ? <ul>{dim.citations.map((citation, index) => <li key={`${citation.short}-${index}`}>
            {citation.short}{citation.doi ? <> · <a href={`https://doi.org/${encodeURI(citation.doi)}`}>{citation.doi}</a></> : null}
          </li>)}</ul> : <p>No citations supplied.</p>}
        </div>
</ReportDisclosure>
      </div>
      {scored ? <ScoreInterval score={speaker.score} lo={speaker.band.lo} hi={speaker.band.hi} who={who} /> : <div className="exp-no-mark" aria-hidden="true">—</div>}
      <div className="exp-score-context">
        {scored ? <>
          <p className="exp-score"><span className="exp-score-num">{speaker.score}</span><span className="exp-band-text">Uncertainty band {speaker.band.lo}–{speaker.band.hi}</span></p>
          <p className="exp-confidence">{confidenceLabel(speaker.confidence)}</p>
        </> : <p className="exp-state" data-status={speaker.status}>{message ?? "Score unavailable."}</p>}
        <p className="exp-basis">{basisText(speaker)}</p>
      </div>
    </div>

  </div>;
}

function ScoreInterval({ score, lo, hi, who }: { score: number; lo: number; hi: number; who: "me" | "other" }) {
  const reveal = useGraphReveal<HTMLDivElement>();
  return <div ref={reveal} className="exp-bar" aria-hidden="true" data-scale="overall" data-domain="0,100">
    <div className={`exp-track exp-track-${who}`}>
      <div data-graph-ink="" className="exp-band" style={{ left: `${lo}%`, width: `${hi-lo}%` }} />
      <div data-graph-ink="" className={`exp-pin exp-pin-${who}`} style={{ left: `${score}%` }} />
    </div>
    <div className="exp-axis"><span>0</span><span>100</span></div>
  </div>;
}
