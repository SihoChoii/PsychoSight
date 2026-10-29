import { apiBase, isMockMode } from "./mode";
import type {
  AnalysisRequest,
  Config,
  ConversationsResponse,
  Job,
  Report,
  SavedAnalysis,
} from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface DiskAccessRecheck {
  granted: boolean;
  relaunch_required: boolean;
  reason: string;
  settings_url: string;
  message: string;
}

export interface DiskAccessOpen {
  opened: boolean;
  url: string;
  reason?: string | null;
}

export interface DiskAccessReveal {
  revealed: boolean;
  reason?: string | null;
}

export interface Client {
  getConfig(): Promise<Config>;
  getConversations(): Promise<ConversationsResponse>;
  listAnalyses(): Promise<SavedAnalysis[]>;
  createAnalysis(body: AnalysisRequest): Promise<{ job_id: string; status: string }>;
  getAnalysis(jobId: string): Promise<Job>;
  getReport(jobId: string): Promise<Report>;
  deleteAnalysis(jobId: string): Promise<{ deleted: boolean; job_id: string }>;
  recheckDiskAccess(): Promise<DiskAccessRecheck>;
  openDiskAccessSettings(): Promise<DiskAccessOpen>;
  revealDiskAccessApp(): Promise<DiskAccessReveal>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("INTERNAL_ERROR", "The local API could not be reached.", 0);
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError("INTERNAL_ERROR", "The local API returned an unreadable response.", response.status);
    }
  }
  if (!response.ok) {
    const body = data as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      body?.error?.code ?? "INTERNAL_ERROR",
      body?.error?.message ?? "The request failed.",
      response.status,
    );
  }
  return data as T;
}

export const httpApi: Client = {
  getConfig: () => request<Config>("/config"),
  getConversations: () => request<ConversationsResponse>("/conversations"),
  listAnalyses: async () => {
    const body = await request<{ analyses: SavedAnalysis[] }>("/analyses");
    return body.analyses;
  },
  createAnalysis: (body) =>
    request<{ job_id: string; status: string }>("/analyses", { method: "POST", body: JSON.stringify(body) }),
  getAnalysis: (jobId) => request<Job>(`/analyses/${encodeURIComponent(jobId)}`),
  getReport: (jobId) => request<Report>(`/analyses/${encodeURIComponent(jobId)}/report`),
  deleteAnalysis: (jobId) =>
    request<{ deleted: boolean; job_id: string }>(`/analyses/${encodeURIComponent(jobId)}`, { method: "DELETE" }),
  recheckDiskAccess: () => request<DiskAccessRecheck>("/disk-access/recheck", { method: "POST" }),
  openDiskAccessSettings: () => request<DiskAccessOpen>("/disk-access/open-settings", { method: "POST" }),
  revealDiskAccessApp: () => request<DiskAccessReveal>("/disk-access/reveal", { method: "POST" }),
};

let clientPromise: Promise<Client> | null = null;

export function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = isMockMode() ? import("./mock").then((mod) => mod.mockApi) : Promise.resolve(httpApi);
  }
  return clientPromise;
}

export function resetClientForTests(): void {
  clientPromise = null;
}
