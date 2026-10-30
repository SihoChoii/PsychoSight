import { useId } from "react";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import type { ExpDimension } from "../../types";
import { hasScore } from "../../experimental";

const CENTER = [360, 292] as const;
const RADIUS = 220;
const pointAt = (angle: number, score: number) => {
  const distance = (Math.max(0, Math.min(100, score)) / 100) * RADIUS;
  return [CENTER[0] + Math.cos(angle) * distance, CENTER[1] + Math.sin(angle) * distance] as const;
};
const coordinates = (points: readonly (readonly number[])[]) => points.map((point) => point.join(",")).join(" ");

/** Motion reveals the measured geometry on each return to view. It never animates or invents a score. */
export function BigFiveShape({ dimensions, activeDimension, scaleNote }: {
  dimensions: ExpDimension[];
  activeDimension: string | null;
  scaleNote: string;
}) {
  const id = useId().replaceAll(":", "");
  const { ref, revealed } = useScrollReveal<SVGSVGElement>();

  const angles = dimensions.map((_, index) => -Math.PI / 2 + index * Math.PI * 2 / dimensions.length);
  const pointsFor = (who: "me" | "other") => dimensions.map((dim, index) => {
    const speaker = dim.per_speaker[who];
    return hasScore(speaker) ? pointAt(angles[index], speaker.score) : null;
  });
  const me = pointsFor("me");
  const other = pointsFor("other");
  const complete = (points: typeof me) => points.length >= 3 && points.every((point) => point !== null);
  const mePolygon = complete(me) ? coordinates(me as NonNullable<typeof me[number]>[]) : null;
  const otherPolygon = complete(other) ? coordinates(other as NonNullable<typeof other[number]>[]) : null;
  const hasOther = dimensions.some((dim) => dim.per_speaker.other !== null);
  const missingProfile = !mePolygon || (hasOther && !otherPolygon);

  return (
    <div className="exp-radar-stage">
      <svg ref={ref} className="exp-radar" viewBox="0 0 720 590" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>Big Five shape</title>
        <desc id={`${id}-desc`}>Experimental language indexes on a 0–100 scale. Me is a solid line with circles{hasOther ? "; the other person is a dashed line with squares" : ""}. Exact values and uncertainty bands are alongside the chart. Missing scores are not connected.</desc>
        <defs>
          <pattern id={`${id}-cells`} width="7" height="7" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill="var(--iris)" />
          </pattern>
          <radialGradient id={`${id}-ink`}>
            <stop offset="0" stopColor="var(--iris)" stopOpacity="0.3" />
            <stop offset="1" stopColor="var(--iris)" stopOpacity="0.06" />
          </radialGradient>
        </defs>
        <g aria-hidden="true">
          {[20, 40, 60, 80, 100].map((level) => (
            <polygon key={level} points={coordinates(angles.map((angle) => pointAt(angle, level)))} className="exp-radar-grid" />
          ))}
          {angles.map((angle, index) => {
            const end = pointAt(angle, 100);
            const label = [CENTER[0] + Math.cos(angle) * RADIUS * 1.22, CENTER[1] + Math.sin(angle) * RADIUS * 1.22];
            const active = dimensions[index].key === activeDimension;
            return (
              <g key={dimensions[index].key} className="exp-radar-axis-group" data-active={active}>
                <line x1={CENTER[0]} y1={CENTER[1]} x2={end[0]} y2={end[1]} className="exp-radar-axis" />
                <rect x={end[0] - 2} y={end[1] - 2} width="4" height="4" className="exp-radar-tick" />
                <text x={label[0]} y={label[1]} dy="0.35em" textAnchor="middle" className="exp-radar-label">
                  <tspan className="exp-radar-name">{dimensions[index].label.split(" (")[0]}</tspan>
                  <tspan className="exp-radar-initial">{dimensions[index].label[0]}</tspan>
                </text>
              </g>
            );
          })}
          {[0, 50, 100].map((level) => <text key={level} x={CENTER[0] + 10} y={CENTER[1] - RADIUS * level / 100 + 5} className="exp-radar-scale">{level}</text>)}
        </g>
        <g className="exp-radar-reveal" data-revealed={revealed}>
          {mePolygon ? <>
            <polygon points={mePolygon} fill={`url(#${id}-ink)`} className="exp-radar-fill" />
            <polygon points={mePolygon} fill={`url(#${id}-cells)`} className="exp-radar-texture" />
            <polygon points={mePolygon} pathLength="1" className="exp-radar-me" />
          </> : null}
          {otherPolygon ? <polygon points={otherPolygon} className="exp-radar-other" /> : null}
          {(["me", "other"] as const).map((who) => (who === "me" ? me : other).map((point, index) => {
            if (!point) return null;
            const active = dimensions[index].key === activeDimension;
            return (
              <g key={`${who}-${dimensions[index].key}`} className="exp-radar-node" data-active={active}>
                <circle cx={point[0]} cy={point[1]} r="15" className="exp-radar-halo" />
                {who === "me" ? <circle cx={point[0]} cy={point[1]} r="5" className="exp-radar-me-dot" />
                  : <rect x={point[0] - 5} y={point[1] - 5} width="10" height="10" className="exp-radar-other-dot" />}
              </g>
            );
          }))}
        </g>
      </svg>
      <p className="exp-scale-note" data-testid="exp-scale-note">{scaleNote}</p>
      {missingProfile ? <p className="exp-radar-missing">Only available scores are plotted.</p> : null}
    </div>
  );
}
