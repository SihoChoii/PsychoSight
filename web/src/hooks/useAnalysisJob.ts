import { useEffect, useRef, useState } from "react";
import { ApiError, getClient, isAbortError } from "../api";
import type { Job } from "../types";

export interface RetrievalError {
  kind: "missing" | "transport";
  message: string;
}

interface Snapshot {
  jobId: string;
  job: Job | null;
  error: RetrievalError | null;
  reading: boolean;
  completion: "new" | "existing" | null;
}

function initial(jobId: string): Snapshot {
  return { jobId, job: null, error: null, reading: true, completion: null };
}

/** Reads status only. Aborting this GET never cancels the backend analysis. */
export function useAnalysisJob(jobId: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => initial(jobId));
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const activeRead = useRef<AbortController | null>(null);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => generation.current === currentGeneration;
    setSnapshot((previous) => previous.jobId === jobId
      ? { ...previous, reading: true }
      : initial(jobId));

    async function read() {
      if (!current()) return;
      const controller = new AbortController();
      activeRead.current = controller;
      try {
        const client = await getClient();
        if (!current()) return;
        const next = await client.getAnalysis(jobId, controller.signal);
        if (!current()) return;
        if (next.job_id !== jobId) throw new Error("The status response did not match this analysis.");
        setSnapshot((previous) => ({
          jobId, job: next, error: null, reading: false,
          completion: next.status === "done"
            ? previous.jobId === jobId && (previous.job?.status === "running" || previous.job?.status === "queued")
              ? "new" : "existing"
            : null,
        }));
        if (next.status !== "done" && next.status !== "error") timer = setTimeout(read, 500);
      } catch (error: unknown) {
        if (!current()) return;
        if (isAbortError(error)) {
          setSnapshot((previous) => ({ ...previous, reading: false }));
          return;
        }
        setSnapshot((previous) => ({
          ...(previous.jobId === jobId ? previous : initial(jobId)),
          reading: false,
          error: {
            kind: error instanceof ApiError && error.status === 404 ? "missing" : "transport",
            message: error instanceof Error ? error.message : "The analysis status could not be retrieved.",
          },
        }));
      } finally {
        if (activeRead.current === controller) activeRead.current = null;
      }
    }
    void read();
    return () => {
      ++generation.current;
      clearTimeout(timer);
      activeRead.current?.abort();
      activeRead.current = null;
    };
  }, [jobId, attempt]);

  function retry() {
    // Invalidate synchronously, including responses arriving before effect cleanup.
    ++generation.current;
    activeRead.current?.abort();
    setAttempt((value) => value + 1);
  }

  const state = snapshot.jobId === jobId ? snapshot : initial(jobId);
  return { ...state, initialLoading: !state.job && state.reading, retry };
}
