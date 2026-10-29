export const STAGE_ORDER = ["loading", "sessionizing", "features", "scoring", "synthesis", "done"] as const;

export type StageName = (typeof STAGE_ORDER)[number];

export const STAGE_LABEL: Record<string, string> = {
  loading: "Loading",
  sessionizing: "Sessionizing",
  features: "Features",
  scoring: "Scoring",
  synthesis: "Synthesis",
  done: "Done",
};

const SKIPPED_WHEN_LOCAL = new Set(["scoring", "synthesis"]);

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

export function stageMark(mode: string, status: string, current: string, stage: string): string {
  if (mode === "deterministic_only" && SKIPPED_WHEN_LOCAL.has(stage)) return "Not run";
  if (status === "done") return "Done";
  if (status === "error" && stage === current) return "Failed";
  const currentIndex = STAGE_ORDER.indexOf(current as StageName);
  const stageIndex = STAGE_ORDER.indexOf(stage as StageName);
  if (currentIndex === -1 || stageIndex === -1) return stage === current ? "Now" : "Upcoming";
  if (stageIndex < currentIndex) return "Done";
  if (stageIndex === currentIndex) return "Now";
  return "Upcoming";
}

export function progressText(job: {
  status: string;
  stage: string;
  progress: { current: number; total: number };
}): string {
  if (job.status === "queued") return "Queued.";
  if (job.status === "done" || job.stage === "done") return "Done.";
  const label = stageLabel(job.stage);
  const { current, total } = job.progress;
  if (job.stage === "scoring" && total > 1) return `${label}. ${current} of ${total} episodes.`;
  if (job.stage === "scoring" && total <= 0) return `${label}. Insufficient data.`;
  return `${label}.`;
}

export function showMeasuredReadout(job: {
  status: string;
  stage: string;
  progress: { current: number; total: number };
}): boolean {
  return job.stage === "scoring" && job.progress.total > 1 && job.status !== "error";
}
