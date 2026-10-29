import type { ReactNode } from "react";
import { speakerLabel } from "../../format";
import type { Quote } from "../../types";

/** Presentation only. Each caller supplies quotes from its own explicit collection. */
export function EvidenceQuote({ quote, episodeReference }: {
  quote: Quote; episodeReference?: (id: string) => ReactNode;
}) {
  return <blockquote className="evidence-quote" data-quote-id={quote.quote_id}>
    <p className="evidence-quote-text">{quote.text}</p>
    <p className="quote-meta">{speakerLabel(quote.speaker)} · {episodeReference ? episodeReference(quote.episode_id) : quote.episode_id} · <time dateTime={quote.timestamp}>{quote.timestamp}</time></p>
  </blockquote>;
}

export function ClaimEvidence({ quotes, missingIds = [], episodeReference }: {
  quotes: Quote[]; missingIds?: string[]; episodeReference: (id: string) => ReactNode;
}) {
  const first = quotes[0];
  return <div className="claim-evidence">
    <p className="evidence-count">{quotes.length} supplied {quotes.length === 1 ? "quote" : "quotes"}</p>
    {first ? <EvidenceQuote quote={first} episodeReference={episodeReference} /> : <p>No quote evidence supplied.</p>}
    {quotes.length > 1 ? <details className="evidence-more"><summary>View {quotes.length - 1} more {quotes.length === 2 ? "quote" : "quotes"}</summary>
      {quotes.slice(1).map((quote) => <EvidenceQuote key={quote.quote_id} quote={quote} episodeReference={episodeReference} />)}
    </details> : null}
    {missingIds.length ? <p className="evidence-unavailable">Quote evidence unavailable: {missingIds.join(", ")}</p> : null}
  </div>;
}
