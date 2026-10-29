import { useEffect, useState } from "react";
import { STAGE_ORDER, progressText, showMeasuredReadout, stageLabel, stageMark } from "../stages";
import type { Job } from "../types";

export function ProgressView({ job, onBack }: { job: Job | null; onBack: () => void }) {
  const current = !job ? "loading" : job.status === "queued" ? "loading" : job.stage;
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    if (!job || job.status === "error") return;
    setAnnounced(stageLabel(current));
  }, [job, current]);

  if (!job) {
    return (
      <section className="focus-task" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>
          Loading
        </h1>
        <p className="decision-copy">Checking the analysis.</p>
      </section>
    );
  }

  const text = progressText(job);
  const measured = showMeasuredReadout(job);
  const showBar = job.progress.total > 0 && job.status !== "error" && job.status !== "done";

  return (
    <section className="focus-task" aria-labelledby="page-title">
      <h1 id="page-title" tabIndex={-1}>
        {job.status === "error" ? "Stopped" : stageLabel(current)}
      </h1>
      <p className="sr-only" aria-live="polite">
        {announced}
      </p>
      <p className="decision-copy">{job.status === "error" ? "The analysis stopped." : text}</p>
      {measured ? (
        <p className="pixel-readout" aria-hidden="true">
          {job.progress.current}/{job.progress.total}
        </p>
      ) : null}
      {showBar ? (
        <progress
          value={Math.min(job.progress.current, job.progress.total)}
          max={job.progress.total}
          aria-valuetext={text}
        />
      ) : null}
      <ol className="stages">
        {STAGE_ORDER.map((stage) => {
          const mark = stageMark(job.mode, job.status, current, stage);
          const now = mark === "Now" || (job.status === "error" && stage === current);
          return (
            <li key={stage} aria-current={now ? "step" : undefined}>
              <span className="stage-name">{stageLabel(stage)}</span>
              <span className="stage-state">{mark}</span>
            </li>
          );
        })}
      </ol>
      {job.status === "error" && job.error ? (
        <p className="field-error" role="alert">
          {job.error.message} <span className="meta">{job.error.code}</span>
        </p>
      ) : null}
      <div className="actions">
        <button type="button" className="button button-secondary" onClick={onBack}>
          Conversations
        </button>
      </div>
    </section>
  );
}
