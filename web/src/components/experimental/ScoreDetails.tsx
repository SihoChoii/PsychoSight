import { evidenceLabel } from "../../experimental";
import type { ExpDimension, ExperimentalScores } from "../../types";
import { TrendComparison } from "./TrendComparison";
import { ContributionCard } from "./ContributionCard";

export function ScoreDetails({ dim, quotes, active, trendNote = null }: {
  dim: ExpDimension;
  quotes: ExperimentalScores["quotes"];
  active: boolean;
  trendNote?: string | null;
}) {
  return (
    <div className="exp-detail-content">
      <p className="exp-evidence">{evidenceLabel(dim.evidence_strength)}</p>
      <p className="exp-note">{dim.evidence_note}</p>
      <TrendComparison dim={dim} active={active} trendNote={trendNote} />
      <div className={`exp-detail-pair${dim.per_speaker.other ? "" : " exp-detail-single"}`}>
        {(["me", "other"] as const).map((who) => {
          const speaker = dim.per_speaker[who];
          if (!speaker) return null;
          return (
            <ContributionCard key={who} dim={dim} who={who} speaker={speaker} quotes={quotes} active={active} />
          );
        })}
      </div>
    </div>
  );
}
