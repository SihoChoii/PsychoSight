import { useId, useState } from "react";
import {
  basisText,
  confidenceLabel,
  directionText,
  evidenceLabel,
  familyLabel,
  FAMILY_ORDER,
  quotesFor,
  sectionMessage,
  sortedContributions,
  sourceLabel,
  speakerMessage,
  TREND_NOTE,
} from "../experimental";
import { formatNumber, formatTimestamp, speakerLabel } from "../format";
import type { ExpDimension, ExperimentalScores, ExpSpeakerScore, ExpTrendPoint } from "../types";

export function ExperimentalScores({ section }: { section: ExperimentalScores }) {
  const [open, setOpen] = useState(false);
  const [shape, setShape] = useState(false);
  const panelId = useId();
  const message = sectionMessage(section);
  const showCharts = section.status === "ok";
  const quoteMap = section.quotes;
  const scoredOther = section.dimensions.some((dim) => dim.per_speaker.other !== null);

  return (
    <section className="section exp-card" aria-labelledby="exp-title" data-exp-status={section.status}>
      <p className="exp-banner" data-testid="exp-banner">
        {section.banner}
      </p>
      <button
        type="button"
        className="exp-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <h2 id="exp-title">{section.title}</h2>
        <span className="exp-toggle-state">{open ? "Hide" : "Show"}</span>
      </button>
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
            <ul className="legend exp-legend">
              <li>
                <span className="exp-cue exp-cue-me" aria-hidden="true" />
                Me, filled
              </li>
              {scoredOther ? (
                <li>
                  <span className="exp-cue exp-cue-other" aria-hidden="true" />
                  Other person, outlined
                </li>
              ) : null}
            </ul>
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
                    <DimensionBlock key={dim.key} dim={dim} quotes={quoteMap} />
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

function DimensionBlock({ dim, quotes }: { dim: ExpDimension; quotes: ExperimentalScores["quotes"] }) {
  const other = dim.per_speaker.other;
  return (
    <article className="exp-dim" aria-labelledby={`exp-dim-${dim.key}`}>
      <h4 id={`exp-dim-${dim.key}`}>{dim.label}</h4>
      <p className="exp-chips">
        <span className="exp-chip">{evidenceLabel(dim.evidence_strength)}</span>
      </p>
      <p className="exp-note">{dim.evidence_note}</p>
      <div className={other ? "exp-pair" : "exp-pair exp-pair-single"}>
        <SpeakerColumn who="me" speaker={dim.per_speaker.me} quotes={quotes} dimKey={dim.key} />
        {other ? <SpeakerColumn who="other" speaker={other} quotes={quotes} dimKey={dim.key} /> : null}
      </div>
    </article>
  );
}

function SpeakerColumn({
  who,
  speaker,
  quotes,
  dimKey,
}: {
  who: "me" | "other";
  speaker: ExpSpeakerScore;
  quotes: ExperimentalScores["quotes"];
  dimKey: string;
}) {
  const message = speakerMessage(speaker);
  const confidence = confidenceLabel(speaker.confidence);
  return (
    <div className={`exp-speaker exp-speaker-${who}`} data-speaker={who} data-status={speaker.status}>
      <p className="exp-who">
        <span className={`exp-cue exp-cue-${who}`} aria-hidden="true" />
        {who === "me" ? "Me" : "Other person"}
      </p>
      {message ? <p className="exp-state" data-status={speaker.status}>{message}</p> : null}
      {speaker.status === "ok" && speaker.score !== null && speaker.band ? (
        <>
          <p className="exp-score">
            <span className="exp-score-num">{speaker.score}</span>
            <span className="exp-band-text">
              Uncertainty band {speaker.band.lo}–{speaker.band.hi}
            </span>
          </p>
          <ScoreBar score={speaker.score} lo={speaker.band.lo} hi={speaker.band.hi} who={who} />
          <p className="exp-chips">
            {confidence ? <span className="exp-chip">{confidence}</span> : null}
          </p>
          <p className="exp-basis">{basisText(speaker)}</p>
          <WhyPanel dimKey={dimKey} who={who} speaker={speaker} quotes={quotes} />
          <TrendSpark points={speaker.trend} who={who} />
        </>
      ) : null}
    </div>
  );
}

function ScoreBar({ score, lo, hi, who }: { score: number; lo: number; hi: number; who: "me" | "other" }) {
  const left = Math.max(0, Math.min(100, lo));
  const right = Math.max(left, Math.min(100, hi));
  return (
    <div className="exp-bar" aria-hidden="true">
      <div className="exp-track">
        <div className="exp-band" style={{ left: `${left}%`, width: `${right - left}%` }} />
        <div
          className={`exp-meter exp-meter-${who}`}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
        <div className={`exp-pin exp-pin-${who}`} style={{ left: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
      <div className="exp-axis">
        <span>0</span>
        <span>100</span>
      </div>
    </div>
  );
}

function WhyPanel({
  dimKey,
  who,
  speaker,
  quotes,
}: {
  dimKey: string;
  who: "me" | "other";
  speaker: ExpSpeakerScore;
  quotes: ExperimentalScores["quotes"];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const section = { quotes } as ExperimentalScores;
  const rows = sortedContributions(speaker.contributions);
  return (
    <div className="exp-why">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        Why this number
      </button>
      <div id={panelId} hidden={!open}>
        <ol className="exp-contribs" data-testid={`why-${dimKey}-${who}`}>
          {rows.map((item) => {
            const found = quotesFor(section, item.quote_ids);
            return (
              <li key={item.marker_key} data-status={item.status} data-weight={item.weight}>
                <p className="exp-contrib-title">
                  <span aria-hidden="true">{item.direction === "down" ? "↓" : "↑"}</span>{" "}
                  <span className="sr-only">{directionText(item.direction)}. </span>
                  {item.label}
                </p>
                <p className="exp-contrib-meta">
                  {sourceLabel(item.source)}
                  {item.status === "ok" ? ` · ${Math.round(item.weight * 1000) / 10}% weight` : null}
                  {item.status === "not_run" ? " · Not run" : null}
                  {item.status === "no_data" ? " · No data" : null}
                </p>
                {item.status === "ok" && item.value !== null ? (
                  <p className="exp-contrib-value">
                    {formatNumber(item.value)} {item.unit}
                  </p>
                ) : null}
                {found.length > 0 ? (
                  <div className="quotes">
                    {found.map((quote) => (
                      <blockquote key={quote.id}>
                        <p>{quote.text}</p>
                        <p className="quote-meta">
                          {speakerLabel(quote.speaker)} · {quote.episode_id} · {formatTimestamp(quote.ts)}
                        </p>
                      </blockquote>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function TrendSpark({ points, who }: { points: ExpTrendPoint[]; who: "me" | "other" }) {
  const numbers = points.map((point) => point.score).filter((value): value is number => value !== null);
  if (numbers.length === 0) {
    return (
      <div className="exp-trend">
        <p className="exp-trend-label">Trend</p>
        <p className="exp-trend-note">{TREND_NOTE}</p>
        <p>No weekly trend.</p>
      </div>
    );
  }
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const span = max - min || 1;
  const width = 320;
  const height = 72;
  const padX = 8;
  const padY = 8;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xAt = (index: number) => padX + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
  const yAt = (value: number) => padY + (1 - (value - min) / span) * innerH;
  let d = "";
  let pen = false;
  points.forEach((point, index) => {
    if (point.score === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${xAt(index).toFixed(1)} ${yAt(point.score).toFixed(1)} `;
    pen = true;
  });
  return (
    <div className="exp-trend">
      <p className="exp-trend-label">Trend</p>
      <p className="exp-trend-note">{TREND_NOTE}</p>
      <svg
        className="exp-spark"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Weekly trend for ${who === "me" ? "me" : "the other person"}. Not the same scale as the overall number.`}
        data-scale="trend"
        data-ymin={min}
        data-ymax={max}
      >
        <path className={`exp-spark-line exp-spark-${who}`} d={d.trim()} fill="none" />
        {points.map((point, index) =>
          point.score === null ? null : (
            <circle key={point.week} className={`exp-spark-dot exp-spark-${who}`} cx={xAt(index)} cy={yAt(point.score)} r={who === "me" ? 2.5 : 0} />
          ),
        )}
        {who === "other"
          ? points.map((point, index) =>
              point.score === null ? null : (
                <rect
                  key={`${point.week}-mark`}
                  className="exp-spark-other-mark"
                  x={xAt(index) - 2.5}
                  y={yAt(point.score) - 2.5}
                  width={5}
                  height={5}
                />
              ),
            )
          : null}
      </svg>
      <table className="sr-only">
        <caption>Weekly trend values, not on the overall scale</caption>
        <thead>
          <tr>
            <th>Week</th>
            <th>Trend value</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.week}>
              <td>{point.week}</td>
              <td>{point.score === null ? (point.reason ?? "No trend value") : point.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BigFiveShape({ dimensions }: { dimensions: ExpDimension[] }) {
  const size = 280;
  const cx = 140;
  const cy = 148;
  const radius = 88;
  const angles = dimensions.map((_, index) => -Math.PI / 2 + (index * 2 * Math.PI) / dimensions.length);
  const point = (angle: number, value: number) => {
    const dist = (Math.max(0, Math.min(100, value)) / 100) * radius;
    return [cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist] as const;
  };
  const polygon = (who: "me" | "other") => {
    const pts = dimensions.map((dim, index) => {
      const speaker = dim.per_speaker[who];
      if (!speaker || speaker.score === null) return null;
      return point(angles[index], speaker.score);
    });
    if (pts.some((item) => item === null)) return null;
    return pts.map((item) => `${item![0].toFixed(1)},${item![1].toFixed(1)}`).join(" ");
  };
  const me = polygon("me");
  const other = polygon("other");
  return (
    <div className="exp-radar">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Big Five shape. Me is a solid line. The other person is a dashed line. Same numbers as the bars.">
        {angles.map((angle, index) => {
          const end = point(angle, 100);
          const dim = dimensions[index];
          const meSpeaker = dim.per_speaker.me;
          const band = meSpeaker.status === "ok" ? meSpeaker.band : null;
          const bandA = band ? point(angle, band.lo) : null;
          const bandB = band ? point(angle, band.hi) : null;
          const labelAt = point(angle, 118);
          const name = dim.label.split(" (")[0];
          return (
            <g key={dim.key}>
              <line className="exp-radar-axis" x1={cx} y1={cy} x2={end[0]} y2={end[1]} />
              {bandA && bandB ? (
                <line className="exp-radar-band" x1={bandA[0]} y1={bandA[1]} x2={bandB[0]} y2={bandB[1]} />
              ) : null}
              {dim.per_speaker.other?.status === "ok" && dim.per_speaker.other.band ? (
                <line
                  className="exp-radar-band exp-radar-band-other"
                  x1={point(angle, dim.per_speaker.other.band.lo)[0]}
                  y1={point(angle, dim.per_speaker.other.band.lo)[1]}
                  x2={point(angle, dim.per_speaker.other.band.hi)[0]}
                  y2={point(angle, dim.per_speaker.other.band.hi)[1]}
                />
              ) : null}
              <text className="exp-radar-label" x={labelAt[0]} y={labelAt[1]} textAnchor="middle" dominantBaseline="middle">
                {name}
              </text>
            </g>
          );
        })}
        {me ? <polygon className="exp-radar-me" points={me} /> : null}
        {other ? <polygon className="exp-radar-other" points={other} /> : null}
      </svg>
    </div>
  );
}
