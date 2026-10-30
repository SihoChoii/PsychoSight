import { useEffect, useRef } from "react";
import { useAnalysisJob } from "../hooks/useAnalysisJob";
import { parseHash } from "../routes";
import { clearActiveJob, hasSeenCompletion, readRunContext, rememberCompletion } from "../run-context";
import { ProgressView } from "./ProgressView";

/** Completion navigation has its own clock; it never depends on decorative animation. */
export function RunScreen({ jobId }: { jobId: string }) {
  const { job, error, reading, completion, retry } = useAnalysisJob(jobId);
  const deadline = useRef<{ jobId: string; time: number } | null>(null);
  const status = job?.status;
  const reportHref = `#/report/${encodeURIComponent(jobId)}`;

  useEffect(() => {
    if (status === "done" || status === "error" || error?.kind === "missing") clearActiveJob(jobId);
    if (status !== "done") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (deadline.current?.jobId !== jobId) {
      const direct = completion !== "new" || hasSeenCompletion(jobId) || media.matches;
      deadline.current = { jobId, time: Date.now() + (direct ? 0 : 1600) };
      rememberCompletion(jobId);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    function reconcile() {
      clearTimeout(timer);
      const route = parseHash(window.location.hash);
      if (document.hidden || route.name !== "run" || route.jobId !== jobId) return;
      const remaining = media.matches ? 0 : (deadline.current?.time ?? 0) - Date.now();
      if (remaining <= 0) window.location.hash = reportHref;
      else timer = setTimeout(reconcile, remaining);
    }
    reconcile();
    document.addEventListener("visibilitychange", reconcile);
    media.addEventListener("change", reconcile);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", reconcile);
      media.removeEventListener("change", reconcile);
    };
  }, [jobId, status, completion, error?.kind, reportHref]);

  return <ProgressView job={job} context={job ? readRunContext(job) : null} error={error} retrying={reading}
    onRetry={retry} reportHref={reportHref} animateCompletion={completion === "new"} onBack={() => { window.location.hash = "#/"; }} />;
}
