import { STAGE_ORDER, stageLabel, stageMark } from "../../stages";
import type { Job } from "../../types";

export function StageRail({ job, stale = false }: { job: Job; stale?: boolean }) {
  return <ol className="stages" aria-label={stale ? "Last known analysis stages" : "Analysis stages"}>
    {STAGE_ORDER.map((stage, index) => {
      const mark = stageMark(job.mode, job.status, job.stage, stage);
      const current = mark === "Now" || mark === "Failed" || mark === "Queued";
      return <li key={stage} aria-current={current ? "step" : undefined} data-stage-state={mark}>
        <span className="stage-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <span className="stage-name">{stageLabel(stage)}</span>
        <span className="stage-state">{mark}</span>
      </li>;
    })}
  </ol>;
}
