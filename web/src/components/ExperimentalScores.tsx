import { type CSSProperties, useId, useRef, useState } from "react";
import { basisText, confidenceLabel, familyLabel, FAMILY_ORDER, hasScore, sectionMessage, speakerMessage } from "../experimental";
import type { ExpDimension, ExperimentalScores as Scores, ExpSpeakerScore } from "../types";
import { BigFiveShape } from "./experimental/BigFiveShape";
import { ScoreDetails } from "./experimental/ScoreDetails";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { AnimatedDisclosure } from "./experimental/AnimatedDisclosure";

export function ExperimentalScores({ section, trendNote = null }: { section: Scores; trendNote?: string | null }) {
  const [activeDimension, setActiveDimension] = useState<string | null>(null);
  const familyRefs = useRef(new Map<string, HTMLDivElement>());
  const message = sectionMessage(section);
  const showCharts = section.status === "ok";
  const scoredOther = section.dimensions.some((dim) => dim.per_speaker.other !== null);
  const families = FAMILY_ORDER.filter((family) => section.dimensions.some((dim) => dim.family === family));
  const jumpTo = (family: string) => {
    const heading = familyRefs.current.get(family)?.querySelector("h3");
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start", behavior: "instant" });
  };

  return (
    <section className="section exp-card" aria-labelledby="exp-title" data-exp-status={section.status}>
      <header className="exp-heading">
        <h2 id="exp-title" tabIndex={-1}>{section.title}</h2>
        {showCharts ? (
          <nav className="exp-nav" aria-label="Experimental score families">
            {families.map((family) => (
              <button key={family} type="button" onClick={() => jumpTo(family)}>
                {family === "wellbeing_language" ? "Well-being" : family === "interpersonal" ? "Interpersonal" : "Big Five"}
              </button>
            ))}
          </nav>
        ) : null}
        <p className="exp-banner" data-testid="exp-banner">{section.banner}</p>
      </header>
      {message ? <p className="exp-state" data-status={section.status}>{message}</p> : null}
      {showCharts ? (
        <div className="exp-families">
          {families.map((family) => {
            const dimensions = section.dimensions.filter((dim) => dim.family === family);
            const bigFive = family === "big_five";
            return (
              <div className={`exp-family exp-family-${family}`} key={family}
                ref={(node) => { if (node) familyRefs.current.set(family, node); else familyRefs.current.delete(family); }}>
                <div className="exp-family-heading">
                  <h3 tabIndex={-1}>{familyLabel(family)}</h3>
                  <ScoreLegend showOther={scoredOther} />
                </div>
                <div className={bigFive ? "exp-big-five-layout" : "exp-dimensions"}>
                  {bigFive ? <BigFiveShape dimensions={dimensions} activeDimension={activeDimension} scaleNote={section.scale_note} /> : null}
                  <div className="exp-dimension-list">
                    {dimensions.map((dim, index) => (
                      <DimensionBlock key={dim.key} dim={dim} quotes={section.quotes}
                        revealOrder={index} trendNote={trendNote}
                        onHighlight={bigFive ? setActiveDimension : undefined} />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          {!families.includes("big_five") ? <p className="exp-scale-note" data-testid="exp-scale-note">{section.scale_note}</p> : null}
        </div>
      ) : null}
      <footer className="exp-footer">
        <HowItWorks text={section.how_it_works} />
        <p className="exp-support" data-testid="exp-support">{section.footer_support}</p>
      </footer>
    </section>
  );
}

function ScoreLegend({ showOther }: { showOther: boolean }) {
  return (
    <ul className="exp-legend" aria-label="Speakers">
      <li><span className="exp-cue exp-cue-me" aria-hidden="true" />Me<span className="sr-only">, solid line and filled circle</span></li>
      {showOther ? <li><span className="exp-cue exp-cue-other" aria-hidden="true" />Other person<span className="sr-only">, dashed line and open square</span></li> : null}
    </ul>
  );
}

function HowItWorks({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="exp-how">
      <button type="button" className="exp-how-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        How this works <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <AnimatedDisclosure id={panelId} open={open}>
        <p className="exp-how-copy" data-testid="exp-how">{text}</p>
      </AnimatedDisclosure>
    </div>
  );
}

function DimensionBlock({ dim, quotes, onHighlight, revealOrder, trendNote }: {
  dim: ExpDimension;
  quotes: Scores["quotes"];
  onHighlight?: (key: string | null) => void;
  revealOrder: number;
  trendNote: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const { ref, revealed } = useScrollReveal<HTMLDivElement>();
  const id = useId();
  const name = dim.label.replace(" (experimental language index)", "");
  return (
    <article className="exp-dim" aria-labelledby={`${id}-title`} data-open={open}
      onMouseEnter={() => onHighlight?.(dim.key)} onMouseLeave={() => onHighlight?.(null)}
      onFocus={() => onHighlight?.(dim.key)} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onHighlight?.(null);
      }}>
      <div ref={ref} className="exp-dim-summary" data-revealed={revealed}
        style={{ "--exp-reveal-delay": `${revealOrder * 70}ms` } as CSSProperties}>
        <div className="exp-dim-heading">
          <h4 id={`${id}-title`}>{name}<span className="sr-only"> (experimental language index)</span></h4>
          <button type="button" className="exp-detail-toggle" aria-expanded={open} aria-controls={`${id}-detail`}
            aria-label={`${open ? "Hide" : "Explore"} ${name}: evidence and trends`} onClick={() => { setHasOpened(true); setOpen(!open); }}>
            <span aria-hidden="true">{open ? "−" : "+"}</span>
          </button>
        </div>
        <div className={`exp-pair${dim.per_speaker.other ? "" : " exp-pair-single"}`}>
          <ScoreColumn who="me" speaker={dim.per_speaker.me} />
          {dim.per_speaker.other ? <ScoreColumn who="other" speaker={dim.per_speaker.other} /> : null}
        </div>
      </div>
      <AnimatedDisclosure id={`${id}-detail`} open={open}>
        {hasOpened ? <ScoreDetails dim={dim} quotes={quotes} active={open} trendNote={trendNote} /> : null}
      </AnimatedDisclosure>
    </article>
  );
}

function ScoreColumn({ who, speaker }: { who: "me" | "other"; speaker: ExpSpeakerScore }) {
  const message = speakerMessage(speaker) ?? (!hasScore(speaker) ? 'Score unavailable.' : null);
  return (
    <div className={`exp-speaker exp-speaker-${who}`} data-speaker={who} data-status={speaker.status}>
      <span className="sr-only">{who === "me" ? "Me" : "Other person"}</span>
      {message ? <p className="exp-state" data-status={speaker.status}>{message}</p> : null}
      {hasScore(speaker) ? (
        <>
          <div className="exp-score">
            <span className={`exp-cue exp-cue-${who}`} aria-hidden="true" />
            <span className="exp-score-num">{speaker.score}</span>
            <span className="exp-band-text"><span className="sr-only">Uncertainty </span>band {speaker.band.lo}–{speaker.band.hi}</span>
          </div>
          <ScoreBar score={speaker.score} lo={speaker.band.lo} hi={speaker.band.hi} who={who} />
          <p className="exp-confidence">{confidenceLabel(speaker.confidence)}</p>
        </>
      ) : <p className="exp-basis">{basisText(speaker)}</p>}
    </div>
  );
}

function ScoreBar({ score, lo, hi, who }: { score: number; lo: number; hi: number; who: "me" | "other" }) {
  const left = Math.max(0, Math.min(100, lo));
  const right = Math.max(left, Math.min(100, hi));
  return (
    <div className="exp-bar" aria-hidden="true" data-scale="overall" data-domain="0,100">
      <div className="exp-track">
        <div className="exp-band" style={{ left: `${left}%`, width: `${right - left}%` }} />
        <div className={`exp-meter exp-meter-${who}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
        <div className={`exp-pin exp-pin-${who}`} style={{ "--exp-score-position": `${Math.max(0, Math.min(100, score))}%` } as CSSProperties} />
      </div>
    </div>
  );
}
