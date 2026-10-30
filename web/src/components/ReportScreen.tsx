import { useEffect, useRef, useState } from "react";
import { ApiError, getClient } from "../api";
import { ACTIVE_JOB_KEY, readSession, removeSession, writeSession } from "../run-context";
import type { Report } from "../types";
import { ReportView } from "./ReportView";

export function ReportScreen({
  jobId,
  trendNote,
  reasoningLevels = [],
}: {
  jobId: string;
  trendNote: string | null;
  reasoningLevels?: readonly { id: string; label: string }[];
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let stopped = false;
    setError(null);
    getClient().then((client) => client.getReport(jobId)).then((next) => {
      if (!stopped) setReport(next);
    }).catch((err: unknown) => {
      if (!stopped) setError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "The report could not be loaded.", 0));
    });
    return () => { stopped = true; };
  }, [jobId, attempt]);

  // Only a retrieval result changes these dependencies. Charts, config and theme never steal focus.
  useEffect(() => {
    if (report || error) document.getElementById("page-title")?.focus();
  }, [report, error]);

  async function remove() {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      const client = await getClient();
      await client.deleteAnalysis(jobId);
      if (readSession(ACTIVE_JOB_KEY) === jobId) removeSession(ACTIVE_JOB_KEY);
      writeSession("psychosight-flash", "Report deleted.");
      // A completed request must not pull someone back from a different page.
      if (mounted.current) window.location.hash = "#/";
    } catch (err: unknown) {
      if (mounted.current) setDeleteError(err instanceof Error ? err.message : "The report could not be deleted.");
    } finally {
      deletingRef.current = false;
      if (mounted.current) setDeleting(false);
    }
  }

  if (error) {
    const notReady = error.code === "REPORT_NOT_READY";
    const notFound = error.code === "NOT_FOUND" || error.status === 404;
    return <section className="focus-task recovery-screen" aria-labelledby="page-title">
      <div className="task-heading"><h1 id="page-title" tabIndex={-1}>{notReady ? "Report not ready" : notFound ? "Report not found" : "Report unavailable"}</h1></div>
      <p className="decision-copy" role="alert">{error.message}</p>
      <div className="actions">
        {notReady ? <a className="button" href={`#/run/${encodeURIComponent(jobId)}`}>View progress</a>
          : <button type="button" className="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>}
        <a className="button button-secondary" href="#/">Conversations</a>
      </div>
    </section>;
  }
  if (!report) return <section className="focus-task recovery-screen" aria-labelledby="page-title">
    <div className="task-heading"><h1 id="page-title" tabIndex={-1}>Report</h1></div>
    <p className="decision-copy" role="status">Loading the report.</p>
    <div className="actions"><a className="button button-secondary" href="#/">Conversations</a></div>
  </section>;
  return <ReportView report={report} deleting={deleting} deleteError={deleteError} trendNote={trendNote} reasoningLevels={reasoningLevels} onDelete={remove} />;
}
