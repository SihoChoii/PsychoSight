import { useId, useMemo, useState } from "react";
import {
  familyLabel,
  FAMILY_ORDER,
  sectionMessage,
} from "../experimental";
import type { ExperimentalScores } from "../types";
import { SpeakerLegend } from "./SpeakerLegend";
import { DimensionRow } from "./experimental/DimensionRow";
import { BigFiveShape } from "./experimental/BigFiveShape";

export function ExperimentalScores({
  section,
  trendNote,
}: {
  section: ExperimentalScores;
  trendNote: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [shape, setShape] = useState(false);
  const panelId = useId();
  const message = sectionMessage(section);
  const showCharts = section.status === "ok";
  const quoteMap = useMemo(() => new Map(section.quotes.map((quote) => [quote.id, quote])), [section.quotes]);
  const scoredOther = section.dimensions.some((dim) => dim.per_speaker.other !== null);

  return (
    <section className="section exp-card" aria-label={section.title} data-exp-status={section.status}>
      <p className="exp-banner" data-testid="exp-banner">
        {section.banner}
      </p>
      <h2 id="exp-title" aria-label={section.title}><button
        type="button"
        className="exp-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{section.title}</span>
        <span className="exp-toggle-state">{open ? "Hide" : "Show"}</span>
      </button></h2>
      <div id={panelId} hidden={!open}>
        {message ? (
          <p className="exp-state" data-status={section.status}>
            {message}
          </p>
        ) : null}
        {showCharts ? (
          <>
            <p className="exp-scale-note" data-testid="exp-scale-note">
              {section.scale_note}
            </p>
            <SpeakerLegend neutral showOther={scoredOther} />
            {FAMILY_ORDER.map((family) => {
              const dimensions = section.dimensions.filter((dim) => dim.family === family);
              if (dimensions.length === 0) return null;
              return (
                <div className="exp-family" key={family}>
                  <h3>{familyLabel(family)}</h3>
                  {family === "big_five" ? (
                    <div className="exp-shape">
                      <button
                        type="button"
                        className="button button-secondary"
                        aria-pressed={shape}
                        onClick={() => setShape((value) => !value)}
                      >
                        {shape ? "Hide Big Five shape" : "Big Five shape"}
                      </button>
                      {shape ? <BigFiveShape dimensions={dimensions} /> : null}
                    </div>
                  ) : null}
                  {dimensions.map((dim) => (
                    <DimensionRow key={dim.key} dim={dim} quotes={quoteMap} trendNote={trendNote} />
                  ))}
                </div>
              );
            })}
          </>
        ) : null}
      </div>
      <p className="exp-support" data-testid="exp-support">
        {section.footer_support}
      </p>
      <HowItWorks text={section.how_it_works} />
    </section>
  );
}

function HowItWorks({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="exp-how">
      <button type="button" className="exp-how-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        How this works
      </button>
      <div id={panelId} hidden={!open}>
        <p className="exp-how-copy" data-testid="exp-how">
          {text}
        </p>
      </div>
    </div>
  );
}
