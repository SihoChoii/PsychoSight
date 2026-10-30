import type { PickerSelection } from "./components/Picker";
import type { Job } from "./types";

export const ACTIVE_JOB_KEY = "psychosight-active-job";
const CONTEXT_PREFIX = "psychosight-run-context:";
const COMPLETED_PREFIX = "psychosight-completed:";
const completedThisSession = new Set<string>();

export function readSession(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export function writeSession(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* Optional UI metadata. */ }
}

export function removeSession(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* Optional UI metadata. */ }
}

function calendarDate(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isSelection(value: unknown): value is PickerSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as Partial<PickerSelection>;
  return typeof selection.conversationId === "string" && selection.conversationId.length > 0
    && typeof selection.label === "string" && selection.label.trim().length > 0
    && typeof selection.isDemo === "boolean"
    && calendarDate(selection.dateFrom) && calendarDate(selection.dateTo)
    && (!selection.dateFrom || !selection.dateTo || selection.dateFrom <= selection.dateTo);
}

export interface RunContext extends PickerSelection {
  version: 1;
  jobId: string;
}

/** Call only after creation, using the ID returned by the API. */
export function rememberRunContext(jobId: string, selection: PickerSelection): void {
  if (!jobId || !isSelection(selection)) return;
  const context: RunContext = {
    version: 1, jobId, conversationId: selection.conversationId, label: selection.label,
    isDemo: selection.isDemo, dateFrom: selection.dateFrom, dateTo: selection.dateTo,
  };
  writeSession(CONTEXT_PREFIX + jobId, JSON.stringify(context));
}

export function readRunContext(job: Pick<Job, "job_id" | "conversation_id">): RunContext | null {
  try {
    const value: unknown = JSON.parse(readSession(CONTEXT_PREFIX + job.job_id) ?? "null");
    if (!isSelection(value)) return null;
    const context = value as Partial<RunContext>;
    return context.version === 1 && context.jobId === job.job_id && context.conversationId === job.conversation_id
      ? context as RunContext : null;
  } catch { return null; }
}

export function clearActiveJob(jobId: string): void {
  if (readSession(ACTIVE_JOB_KEY) === jobId) removeSession(ACTIVE_JOB_KEY);
}

export function hasSeenCompletion(jobId: string): boolean {
  return completedThisSession.has(jobId) || readSession(COMPLETED_PREFIX + jobId) === "1";
}

export function rememberCompletion(jobId: string): void {
  completedThisSession.add(jobId);
  writeSession(COMPLETED_PREFIX + jobId, "1");
}
