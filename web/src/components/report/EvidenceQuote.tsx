import { useContentReveal } from "./graph-reveal";
import { ReportDisclosure } from "./ReportDisclosure";
import type { ReactNode } from "react";
import { speakerLabel } from "../../format";
import type { Quote } from "../../types";

/** Presentation only. Each caller supplies quotes from its own explicit collection. */
export function EvidenceQuote({ quote, episodeReference, reveal = false }: {
  quote: Quote; episodeReference?: (id: string) => ReactNode; reveal?: boolean;
}) {
  const fade = useContentReveal<HTMLQuoteElement>();
  const content = <>
    <p className="evidence-quote-text">{quote.text}</p>
    <p className="quote-meta">{speakerLabel(quote.speaker)} · {episodeReference ? episodeReference(quote.episode_id) : quote.episode_id} · <time dateTime={quote.timestamp}>{quote.timestamp}</time></p>
  </>;
  return <blockquote ref={reveal ? fade : undefined} className={`evidence-quote${reveal ? " score-fade" : ""}`} data-quote-id={quote.quote_id}>
    {reveal ? <div data-rise-content="">{content}</div> : content}
  </blockquote>;
}

export function ClaimEvidence({ quotes, missingIds = [], episodeReference, reveal = false, quoteReveal = false }: {
  quotes: Quote[]; missingIds?: string[]; episodeReference: (id: string) => ReactNode; reveal?: boolean; quoteReveal?: boolean;
}) {
  const fade = useContentReveal<HTMLDivElement>();
  const first = quotes[0];
  const content = <>
    <p className="evidence-count">{quotes.length} supplied {quotes.length === 1 ? "quote" : "quotes"}</p>
    {first ? <EvidenceQuote quote={first} episodeReference={episodeReference} reveal={quoteReveal} /> : <p>No quote evidence supplied.</p>}
    {quotes.length > 1 ? <ReportDisclosure label={`View ${quotes.length - 1} more ${quotes.length === 2 ? "quote" : "quotes"}`} title="Supporting quotes" className="evidence-more">
      {quotes.slice(1).map((quote) => <EvidenceQuote key={quote.quote_id} quote={quote} episodeReference={episodeReference} reveal={quoteReveal} />)}
    </ReportDisclosure> : null}
    {missingIds.length ? <p className="evidence-unavailable">Quote evidence unavailable: {missingIds.join(", ")}</p> : null}
  </>;
  return <div ref={reveal ? fade : undefined} className={`claim-evidence${reveal ? " score-fade" : ""}`}>{reveal ? <div data-rise-content="">{content}</div> : content}</div>;
}
