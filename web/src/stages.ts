import type { Job } from "./types";

export const STAGE_ORDER = ["loading", "sessionizing", "features", "scoring", "synthesis", "experimental", "done"] as const;
export type StageName = (typeof STAGE_ORDER)[number];

export const STAGE_LABEL: Record<StageName, string> = {
  loading: "Loading", sessionizing: "Sessionizing", features: "Features", scoring: "Scoring",
  synthesis: "Synthesis", experimental: "Experimental scores", done: "Report ready",
};

const SKIPPED_WHEN_LOCAL = new Set(["scoring", "synthesis"]);
function knownStage(stage: string): stage is StageName {
  return STAGE_ORDER.some((value) => value === stage);
}

export function stageLabel(stage: string): string {
  return knownStage(stage) ? STAGE_LABEL[stage] : "Analysis in progress";
}

export function stageMark(mode: string, status: string, current: string, stage: string): string {
  if (mode === "deterministic_only" && SKIPPED_WHEN_LOCAL.has(stage)) return "Not run";
  if (status === "queued") return stage === "loading" ? "Queued" : "Upcoming";
  if (status === "done") return stage === "experimental" ? "See report" : "Done";
  if (status !== "running" && status !== "error") return "Unknown";
  if (status === "error" && stage === current) return "Failed";
  if (!knownStage(current) || !knownStage(stage)) return "Unknown";
  if (stage === "done") return status === "error" ? "Not reached" : "Upcoming";
  if (STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(current)) return stage === "experimental" ? "See report" : "Done";
  if (stage === current) return "Now";
  return status === "error" ? "Not reached" : "Upcoming";
}

export function measuredProgress(job: Pick<Job, "status" | "stage" | "progress">) {
  if (job.status !== "running" || (job.stage !== "scoring" && job.stage !== "experimental")) return null;
  const { current, total } = job.progress;
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total) || total <= 0 || current < 0 || current > total) return null;
  return { current, total, percent: (current / total) * 100 };
}

export function progressHeading(job: Job): string {
  if (job.status === "queued") return "Queued";
  if (job.status === "done") return "Report ready";
  if (job.status === "error") return "Analysis stopped";
  if (job.status !== "running") return "Checking analysis status";
  return job.stage === "done" ? "Finalizing analysis" : stageLabel(job.stage);
}

export function progressText(job: Pick<Job, "status" | "stage" | "progress">): string {
  if (job.status === "queued") return "Waiting to start.";
  if (job.status === "done") return "The analysis is complete.";
  if (job.status === "error") return "The analysis stopped.";
  if (job.status !== "running") return `Status: ${job.status}. Checking for updates.`;
  if (!knownStage(job.stage)) return `Processing stage: ${job.stage}. Progress is unavailable.`;
  if (job.stage === "done") return "Waiting for completion status.";
  const measured = measuredProgress(job);
  if (measured) return job.stage === "scoring"
    ? `${measured.current} of ${measured.total} ${measured.total === 1 ? "episode" : "episodes"}.`
    : `${measured.current} of ${measured.total} work ${measured.total === 1 ? "unit" : "units"} complete.`;
  if (job.stage === "scoring" || job.stage === "experimental") return "Progress total is unavailable.";
  return `${stageLabel(job.stage)}.`;
}
