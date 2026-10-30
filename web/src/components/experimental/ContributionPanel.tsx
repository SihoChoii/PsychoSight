import { useGraphReveal } from "../report/graph-reveal";
import { basisText, directionText, sortedContributions, sourceLabel } from "../../experimental";
import { speakerLabel } from "../../format";
import type { ExpQuote, ExpSpeakerScore } from "../../types";

export function ContributionPanel({ dimKey, who, speaker, quotes }: {
  dimKey: string; who: "me" | "other"; speaker: ExpSpeakerScore; quotes: ReadonlyMap<string, ExpQuote>;
}) {
  const rows = sortedContributions(speaker.contributions);
  const attributedIds = new Set(rows.flatMap((item) => item.quote_ids));
  const remainingIds = speaker.quote_ids.filter((id) => !attributedIds.has(id));
  return <div className="exp-why">
    <h5>Contributions</h5>
    <p className="exp-weight-note">Effective weights use the same 0–100% length scale for every marker. They are input shares, not amounts added to the final number.</p>
    {rows.length ? <ol className="exp-contribs exp-contribution-all" data-testid={`all-${dimKey}-${who}`}>
      {rows.map((item) => <li key={item.marker_key} data-marker={item.marker_key} data-status={item.status} data-weight={item.weight}>
        <div className="exp-contrib-row">
          <div><p className="exp-contrib-title">{item.label}</p><p className="exp-contrib-meta">{sourceLabel(item.source)} · {item.anchor_source}</p></div>
          <p className="exp-direction"><span aria-hidden="true">{item.direction === "down" ? "↓" : "↑"}</span> {directionText(item.direction)}</p>
          <div className="exp-weight">
            <p>{item.status === "ok" ? `${Number((item.weight * 100).toPrecision(12))}% weight` : item.status === "not_run" ? "Not run" : "No data"}</p>
            {item.status === "ok" ? <WeightBar weight={item.weight} /> : null}
          </div>
          <p className="exp-contrib-value">Observed value: {item.status === "ok" && item.value !== null ? `${item.value} ${item.unit}` : "unavailable"}</p>
        </div>
        <ExperimentalQuotes ids={item.quote_ids} quotes={quotes} />
      </li>)}
    </ol> : <p>No contribution data supplied.</p>}
    {remainingIds.length ? <div className="exp-additional-quotes"><h5>Additional supplied evidence</h5><ExperimentalQuotes ids={remainingIds} quotes={quotes} /></div> : null}
    {!attributedIds.size && !remainingIds.length ? <p>No quote evidence supplied.</p> : null}
    <p className="exp-basis">{basisText(speaker)}</p>
  </div>;
}

function ExperimentalQuotes({ ids, quotes }: { ids: string[]; quotes: ReadonlyMap<string, ExpQuote> }) {
  return ids.length ? <div className="exp-quotes">{ids.map((id) => {
    const quote = quotes.get(id);
    return quote ? <blockquote key={id} data-exp-quote-id={id}>
      <p className="exp-quote-text">{quote.text}</p>
      <p className="quote-meta">{speakerLabel(quote.speaker)} · {quote.episode_id} · <time dateTime={quote.ts}>{quote.ts}</time></p>
    </blockquote> : <p key={id}>Quote evidence unavailable: {id}</p>;
  })}</div> : null;
}

function WeightBar({ weight }: { weight: number }) {
 const reveal = useGraphReveal<HTMLDivElement>();
 return <div ref={reveal} className="exp-weight-track" aria-hidden="true"><span data-graph-ink="" style={{width:`${Math.max(0,Math.min(100,weight*100))}%`}} /></div>;
}
