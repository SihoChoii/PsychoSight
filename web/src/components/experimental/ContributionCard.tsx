import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { basisText, confidenceLabel, directionText, evidenceLabel, hasScore, quotesFor, sortedContributions, sourceLabel, speakerMessage } from "../../experimental";
import { formatTimestamp, speakerLabel } from "../../format";
import type { ExpDimension, ExperimentalScores, ExpSpeakerScore } from "../../types";
import { AnimatedDisclosure } from "./AnimatedDisclosure";
import { ContributionPanel } from "./ContributionPanel";

const OPEN_EVENT = "psychosight:open-contribution-card";

export function ContributionCard({ dim, who, speaker, quotes, active }: {
  dim: ExpDimension;
  who: "me" | "other";
  speaker: ExpSpeakerScore;
  quotes: ExperimentalScores["quotes"];
  active: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const dismissed = useRef(false);
  const focusRequested = useRef(false);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hasExpanded, setHasExpanded] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const visible = open && active;
  const person = who === "me" ? "Me" : "Other person";
  const name = dim.label.replace(" (experimental language index)", "");
  const rows = sortedContributions(speaker.contributions);
  const preview = rows.slice(0, 5);
  const scored = hasScore(speaker);
  const quoteIndex = useMemo(() => new Map(quotes.map(quote => [quote.id, quote])), [quotes]);
  const section = { quotes } as ExperimentalScores;
  const example = quotesFor(section, rows.flatMap((item) => item.quote_ids))[0];

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const close = (returnFocus = false) => {
    clearTimer();
    dismissed.current = returnFocus;
    setOpen(false);
    setPinned(false);
    setExpanded(false);
    setHasExpanded(false);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  };
  const scheduleClose = () => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      if (!pinned && !card.current?.contains(document.activeElement) && document.activeElement !== trigger.current) close();
    }, 200);
  };
  const focusCard = () => card.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  const show = () => {
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    setOpen(true);
  };

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!active) { setOpen(false); setPinned(false); setExpanded(false); setHasExpanded(false); clearTimer(); }
  }, [active]);

  useLayoutEffect(() => {
    if (!visible) return;
    const place = (event?: Event) => {
      if (!trigger.current || !card.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const scrollingCard = event?.target instanceof Node && card.current.contains(event.target);
      if (event?.type === "scroll" && !scrollingCard && (anchor.bottom <= 0 || anchor.top >= window.innerHeight)) {
        close();
        return;
      }
      const popup = card.current.getBoundingClientRect();
      const gutter = 16;
      const left = anchor.left >= popup.width + gutter * 2
        ? anchor.left - popup.width - gutter
        : Math.max(gutter, Math.min(anchor.left, window.innerWidth - popup.width - gutter));
      const top = Math.max(gutter, Math.min(anchor.top, window.innerHeight - popup.height - gutter));
      setPosition((previous) => previous.left === left && previous.top === top ? previous : { left, top });
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place());
    if (card.current) observer?.observe(card.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !card.current?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
    };
    const anotherCard = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    document.addEventListener(OPEN_EVENT, anotherCard);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      document.removeEventListener(OPEN_EVENT, anotherCard);
    };
  }, [visible]);

  useLayoutEffect(() => {
    if (visible && focusRequested.current) { focusRequested.current = false; focusCard(); }
  }, [visible, pinned]);

  const leaveFocus = (target: EventTarget | null) => {
    if (!(target instanceof Node) || (!trigger.current?.contains(target) && !card.current?.contains(target))) close();
  };
  const tabFromCard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !card.current) return;
    const controls = Array.from(card.current.querySelectorAll<HTMLElement>("button, a[href], summary, [tabindex='0']"))
      .filter((element) => !element.matches(":disabled") && !element.closest("[inert], [hidden]") && element.getClientRects().length);
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault();
      trigger.current?.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
      event.preventDefault();
      const pageControls = Array.from(document.querySelectorAll<HTMLElement>("button, a[href], summary, input, select, [tabindex='0']"))
        .filter((element) => !element.matches(":disabled") && !card.current?.contains(element) && !element.closest("[inert], [hidden]") && element.getClientRects().length);
      const next = pageControls[pageControls.indexOf(trigger.current!) + 1];
      close();
      (next ?? trigger.current)?.focus();
    }
  };

  return (
    <>
      <button ref={trigger} type="button" className={`exp-evidence-trigger exp-evidence-trigger-${who}`}
        aria-label={`Why this number for ${person}`} aria-expanded={visible} aria-haspopup="dialog" aria-controls={visible ? `${id}-card` : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          clearTimer(); dismissed.current = false; show();
        }}
        onPointerLeave={scheduleClose}
        onFocus={() => {
          clearTimer();
          if (dismissed.current) dismissed.current = false;
          else show();
        }}
        onBlur={(event) => leaveFocus(event.relatedTarget)}
        onClick={(event) => {
          if (pinned) { close(true); return; }
          dismissed.current = false;
          focusRequested.current = event.detail === 0;
          setPinned(true); show();
        }}
        onKeyDown={(event) => {
          if ((event.key === "Tab" && !event.shiftKey && visible) || event.key === "ArrowDown") {
            event.preventDefault(); focusRequested.current = true; show(); setPinned(true); focusCard();
          }
        }}>
        <span className="exp-evidence-trigger-heading"><span>{person}</span><span className="exp-evidence-trigger-score">{scored ? speaker.score : '—'}</span></span>
        <span className="exp-evidence-trigger-basis">{basisText(speaker).replace("based on ", "")}</span>
        <span className="exp-evidence-trigger-label">Why this number</span>
      </button>
      {visible ? createPortal(
        <div ref={card} id={`${id}-card`} className={`exp-contribution-card exp-contribution-card-${who}`} role="dialog" aria-modal="false"
          aria-labelledby={`${id}-heading`} style={{ left: position.left, top: position.top }}
          onPointerEnter={clearTimer} onPointerLeave={scheduleClose} onBlur={(event) => leaveFocus(event.relatedTarget)} onKeyDown={tabFromCard}>
          <header className="exp-contribution-heading">
            <div><p>{person} / {name}</p><h5 id={`${id}-heading`}>Why this number</h5></div>
            <button type="button" className="exp-contribution-close" aria-label="Close explanation" onClick={() => close(true)}>×</button>
          </header>
          <div className="exp-contribution-context">
            <span className="exp-contribution-score">{scored ? speaker.score : '—'}</span>
            <div>{scored ? <><p>Band {speaker.band.lo}–{speaker.band.hi}</p><p>{confidenceLabel(speaker.confidence)}</p></> : <p>{speakerMessage(speaker) ?? 'Score unavailable.'}</p>}</div>
            <p>{evidenceLabel(dim.evidence_strength)}</p>
          </div>
          <div className="exp-contribution-axis" aria-hidden="true"><span>Marker</span><span>↓ / ↑</span><span>Weight</span></div>
          <ol className="exp-contribution-preview" data-testid={`why-${dim.key}-${who}`}>
            {preview.map((item) => {
              const extent = Math.max(0, Math.min(1, item.weight)) * 50;
              return (
                <li key={item.marker_key} data-marker={item.marker_key} data-status={item.status} data-weight={item.weight}>
                  <span className="exp-contribution-name">{item.label.replace(" for this dimension", "").replace(" (AI rating)", "")}</span>
                  <span className="exp-contribution-track" aria-hidden="true">
                    {item.status === "ok" ? <span className={`exp-contribution-bar exp-contribution-bar-${item.direction}`}
                      style={{ left: `${item.direction === "down" ? 50 - extent : 50}%`, width: `${extent}%` }} /> : null}
                  </span>
                  <span className="exp-contribution-weight">{item.status === "ok" ? `${Math.round(item.weight * 1000) / 10}%` : item.status === "not_run" ? "Not run" : "No data"}</span>
                  <span className="sr-only">{sourceLabel(item.source)}. {directionText(item.direction)}.</span>
                </li>
              );
            })}
          </ol>
          {example ? <blockquote className="exp-contribution-quote"><p>{example.text}</p><footer>{speakerLabel(example.speaker)} · <time dateTime={example.ts}>{formatTimestamp(example.ts)}</time></footer></blockquote> : null}
          <button className="exp-contribution-more" type="button" aria-expanded={expanded} aria-controls={`${id}-all`} onClick={() => { setHasExpanded(true); setExpanded(!expanded); }}>
            All {rows.length} markers <span aria-hidden="true">{expanded ? "−" : "+"}</span>
          </button>
          <AnimatedDisclosure id={`${id}-all`} open={expanded}>
            {hasExpanded ? <div className="exp-complete-evidence">
              <ContributionPanel dimKey={dim.key} who={who} speaker={speaker} quotes={quoteIndex} />
              <div className="exp-citations"><h5>Research context</h5><p>{dim.evidence_note}</p>
                {dim.citations.length ? <ul>{dim.citations.map((citation, index) => <li key={`${citation.short}-${index}`}>{citation.short}{citation.doi ? <> · <a href={`https://doi.org/${encodeURI(citation.doi)}`}>{citation.doi}</a></> : null}</li>)}</ul> : <p>No citations supplied.</p>}
              </div>
            </div> : null}
          </AnimatedDisclosure>
        </div>, document.body,
      ) : null}
    </>
  );
}
