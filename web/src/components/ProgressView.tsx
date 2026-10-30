import { useState } from "react";
import type { Signal } from "../brand/led/matrix.js";
import { LedMatrix } from "./progress/LedMatrix";
import { StageRail } from "./progress/StageRail";
import type { RetrievalError } from "../hooks/useAnalysisJob";
import type { RunContext } from "../run-context";
import { measuredProgress, progressHeading, progressText, stageLabel } from "../stages";
import type { Job } from "../types";

interface Props {
  job: Job | null;
  context?: RunContext | null;
  error?: RetrievalError | null;
  retrying?: boolean;
  onRetry?: () => void;
  reportHref?: string;
  animateCompletion?: boolean;
  onBack: () => void;
}

export function ProgressView({ job, context, error, retrying, onRetry, reportHref, animateCompletion = false, onBack }: Props) {
  const [paused, setPaused] = useState(false);
  const missing = error?.kind === "missing";
  const heading = missing ? "Analysis not found" : error ? "Unable to update status" : job ? progressHeading(job) : "Checking analysis";
  const text = job ? progressText(job) : "Checking the analysis.";
  const measured = job && !missing ? measuredProgress(job) : null;
  // Announce stage changes, not every count or animation frame.
  const announcement = error ? heading : job ? `${heading}${job.status === "running" ? "" : `: ${text}`}` : heading;
  const signal: Signal = job?.status === "done" ? "success" : job?.status === "error" ? "failure"
    : measured ? "progress" : job?.status === "queued" ? "queued" : "orbit";
  const showDisplay = !error && job && ["running", "queued", "done", "error"].includes(job.status);
  const hasMotion = showDisplay && (signal === "queued" || signal === "orbit" || signal === "progress");

  return (
    <section className="progress-task" aria-labelledby="page-title" data-motion-paused={paused || undefined}>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <div className="progress-composition">
        <div className="progress-status">
          <h1 id="page-title" tabIndex={-1}>{heading}</h1>
          {context ? <p className="progress-context">{context.label}<span>
            {context.dateFrom || context.dateTo ? `Requested range: ${context.dateFrom || "Start"} – ${context.dateTo || "End"}` : "Full conversation"}
          </span></p> : null}
          <div className="progress-detail">
            {error ? <div role="alert">
              <p className="decision-copy">{missing
                ? "This analysis is unavailable. It may have been deleted."
                : "The latest status could not be retrieved. Retry checks this analysis again."}</p>
              <p className="field-error">{error.message}</p>
            </div> : null}
            {measured ? <div className="progress-measure">
              <p className="progress-percentage"><span>{Math.floor(measured.percent + 1e-9)}%</span> <span className="progress-scope">{error ? "last known stage progress" : "of this stage"}</span></p>
              <progress value={measured.current} max={measured.total} aria-label={`${stageLabel(job?.stage ?? "")} progress`}
                aria-valuetext={error ? `Last known: ${text}` : text} />
            </div> : null}
            {!missing && (job || !error) && (measured || error || job?.status !== "running") ? <p className="decision-copy progress-count">
              {error && job ? `Last known status: ${progressHeading(job)}. ${text}` : text}
            </p> : null}
            {!missing && job?.status === "running" && !measured && text !== `${heading}.` ? <p className="decision-copy progress-count">{text}</p> : null}
            {!missing && job?.status === "error" && job.error ? <p className="field-error" role="alert">
              {job.error.message} <span className="meta">{job.error.code}</span>
            </p> : null}
          </div>
          <div className="actions">
            {job?.status === "done" && reportHref ? <a className="button" href={reportHref}>View report</a> : null}
            {error && !missing && onRetry ? <button type="button" className="button" onClick={onRetry} disabled={retrying}>
              {retrying ? "Checking status…" : "Retry"}
            </button> : null}
            <button type="button" className="button button-secondary" onClick={onBack}>Conversations</button>
          </div>
        </div>
        <div className="progress-visual">
          {showDisplay ? <LedMatrix signal={signal} progressPercent={measured?.percent}
            progressKey={`${job.job_id}:${job.stage}`} paused={paused} animateTerminal={job.status === "error" || animateCompletion} /> : null}
          <div className="progress-motion">
            {hasMotion ? <button type="button" className="motion-toggle" aria-pressed={paused}
              onClick={() => setPaused(!paused)}>{paused ? "Resume motion" : "Pause motion"}</button> : null}
          </div>
        </div>
      </div>
      {job && !missing ? <StageRail job={job} stale={Boolean(error)} /> : null}
    </section>
  );
}
