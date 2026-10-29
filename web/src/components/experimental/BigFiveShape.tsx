import type { ExpDimension } from "../../types";
import { hasScore } from "../../experimental";

export function BigFiveShape({ dimensions }: { dimensions: ExpDimension[] }) {
  const size = 400;
  const cx = 200;
  const cy = 200;
  const radius = 90;
  const angles = dimensions.map((_, index) => -Math.PI / 2 + (index * 2 * Math.PI) / dimensions.length);
  const point = (angle: number, value: number) => {
    const dist = (Math.max(0, Math.min(100, value)) / 100) * radius;
    return [cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist] as const;
  };
  const polygon = (who: "me" | "other") => {
    const pts = dimensions.map((dim, index) => {
      const speaker = dim.per_speaker[who];
      if (!hasScore(speaker)) return null;
      return point(angles[index], speaker.score);
    });
    if (pts.some((item) => item === null)) return null;
    return pts.flatMap((item) => item ? [`${item[0].toFixed(1)},${item[1].toFixed(1)}`] : []).join(" ");
  };
  const me = polygon("me");
  const other = polygon("other");
  return (
    <div className="exp-radar">
      <p>0–100 experimental index. Uncertainty bands follow each axis; exact values and context remain in the comparisons.</p>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Big Five shape. Me is a solid line and filled circles.${dimensions.some((dim) => dim.per_speaker.other !== null) ? " The other person is a dashed line and open squares." : ""} Same numbers as the comparisons.`}>
        {angles.map((angle, index) => {
          const end = point(angle, 100);
          const dim = dimensions[index];
          const meSpeaker = dim.per_speaker.me;
          const band = hasScore(meSpeaker) ? meSpeaker.band : null;
          const bandA = band ? point(angle, band.lo) : null;
          const bandB = band ? point(angle, band.hi) : null;
          const labelAt = [cx + Math.cos(angle) * 120, cy + Math.sin(angle) * 120];
          const name = dim.label.split(" (")[0];
          return (
            <g key={dim.key}>
              <line className="exp-radar-axis" x1={cx} y1={cy} x2={end[0]} y2={end[1]} />
              {bandA && bandB ? (
                <line className="exp-radar-band" x1={bandA[0]} y1={bandA[1]} x2={bandB[0]} y2={bandB[1]} />
              ) : null}
              {hasScore(dim.per_speaker.other) ? (
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
        {dimensions.map((dim, index) => {
          const a = dim.per_speaker.me, b = dim.per_speaker.other;
          const m = hasScore(a) ? point(angles[index], a.score) : null;
          const o = hasScore(b) ? point(angles[index], b.score) : null;
          return <g key={`marks-${dim.key}`}>
            {m ? <circle className="exp-spark-dot" cx={m[0]} cy={m[1]} r={3} /> : null}
            {o ? <rect className="exp-spark-other-mark" x={o[0]-3} y={o[1]-3} width={6} height={6} /> : null}
          </g>;
        })}
        {me ? <polygon className="exp-radar-me" points={me} /> : null}
        {other ? <polygon className="exp-radar-other" points={other} /> : null}
      </svg>
    </div>
  );
}
