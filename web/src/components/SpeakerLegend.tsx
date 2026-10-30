/** Shape and line style carry speaker identity even without color. */
export function SpeakerLegend({ neutral = false, showOther = true, compact = false }: { neutral?: boolean; showOther?: boolean; compact?: boolean }) {
  return (
    <ul className={`speaker-legend${neutral ? " speaker-legend-neutral" : ""}`} aria-label="Speakers">
      <li>
        <svg aria-hidden="true" viewBox="0 0 56 12" width="56" height="12">
          <line className="speaker-line" x1="0" y1="6" x2="32" y2="6" />
          <circle className="speaker-circle" cx="46" cy="6" r="4" />
        </svg>
        Me<span className={compact ? "sr-only" : undefined}>, solid line</span><span className="sr-only"> and filled circle</span>
      </li>
      {showOther ? (
        <li className="speaker-other">
          <svg aria-hidden="true" viewBox="0 0 56 12" width="56" height="12">
            <line className="speaker-line" x1="0" y1="6" x2="32" y2="6" />
            <rect className="speaker-square" x="42" y="2" width="8" height="8" />
          </svg>
          Other person<span className={compact ? "sr-only" : undefined}>, dashed line</span><span className="sr-only"> and open square</span>
        </li>
      ) : null}
    </ul>
  );
}
