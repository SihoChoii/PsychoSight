import { STAGE_ORDER, stageLabel, stageMark, type StageName } from "../../stages";
import type { Job } from "../../types";

const DESCRIPTION: Record<StageName, string> = {
  loading: "Read the selected messages.",
  sessionizing: "Group messages into episodes.",
  features: "Compute weekly patterns.",
  scoring: "Score selected episodes.",
  synthesis: "Write observations from evidence.",
  experimental: "Optional indices; outcomes in the report.",
  done: "Open the completed report.",
};

export function StageRail({ job, stale = false }: { job: Job; stale?: boolean }) {
  return <ol className="stages" aria-label={stale ? "Last known analysis stages" : "Analysis stages"}>
    {STAGE_ORDER.map((stage, index) => {
      const mark = stageMark(job.mode, job.status, job.stage, stage);
      const current = mark === "Now" || mark === "Failed" || mark === "Queued";
      return <li key={stage} aria-current={current ? "step" : undefined} data-stage-state={mark}>
        <span className="stage-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <div><span className="stage-name">{stageLabel(stage)}</span>
          <p className="stage-description">{DESCRIPTION[stage]}</p></div>
        <span className="stage-state">{mark}</span>
      </li>;
    })}
  </ol>;
}
