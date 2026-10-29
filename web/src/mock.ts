import fullReport from "../../docs/sample_report.json";
import deterministicReport from "../../docs/sample_report_deterministic_only.json";
import liveExperimentalReport from "../../docs/sample_report_experimental.json";
import { ApiError, type Client } from "./api";
import {
  deterministicSection,
  failedSection,
  insufficientSection,
  notRunSection,
  nullOtherSection,
  realLikeSection,
  stubSection,
  withNullOther,
} from "./fixtures/experimental-samples";
import mockConfig from "./fixtures/mock-config.json";
import { queryFlag } from "./mode";
import type { AnalysisRequest, Config, Conversation, ExperimentalScores, Job, Report, SavedAnalysis } from "./types";

const STEP_MS = 450;

interface Step {
  status: Job["status"];
  stage: string;
  current: number;
  total: number;
}

const FULL_STEPS: Step[] = [
  { status: "queued", stage: "loading", current: 0, total: 1 },
  { status: "running", stage: "loading", current: 0, total: 1 },
  { status: "running", stage: "loading", current: 1, total: 1 },
  { status: "running", stage: "sessionizing", current: 0, total: 1 },
  { status: "running", stage: "sessionizing", current: 1, total: 1 },
  { status: "running", stage: "features", current: 0, total: 1 },
  { status: "running", stage: "features", current: 1, total: 1 },
  { status: "running", stage: "scoring", current: 0, total: 40 },
  { status: "running", stage: "scoring", current: 12, total: 40 },
  { status: "running", stage: "scoring", current: 40, total: 40 },
  { status: "running", stage: "synthesis", current: 0, total: 1 },
  { status: "running", stage: "synthesis", current: 1, total: 1 },
  { status: "running", stage: "experimental", current: 0, total: 8 },
  { status: "running", stage: "experimental", current: 1, total: 8 },
  { status: "running", stage: "experimental", current: 2, total: 8 },
  { status: "running", stage: "experimental", current: 3, total: 8 },
  { status: "running", stage: "experimental", current: 4, total: 8 },
  { status: "running", stage: "experimental", current: 5, total: 8 },
  { status: "running", stage: "experimental", current: 6, total: 8 },
  { status: "running", stage: "experimental", current: 7, total: 8 },
  { status: "running", stage: "experimental", current: 8, total: 8 },
  { status: "done", stage: "done", current: 1, total: 1 },
];

const LOCAL_STEPS: Step[] = [
  { status: "queued", stage: "loading", current: 0, total: 1 },
  { status: "running", stage: "loading", current: 0, total: 1 },
  { status: "running", stage: "loading", current: 1, total: 1 },
  { status: "running", stage: "sessionizing", current: 1, total: 1 },
  { status: "running", stage: "features", current: 1, total: 1 },
  { status: "running", stage: "experimental", current: 0, total: 0 },
  { status: "done", stage: "done", current: 1, total: 1 },
];

interface MockJob {
  id: string;
  mode: "full" | "deterministic_only";
  conversationId: string;
  label: string;
  started: number;
  deleted: boolean;
  experimental: boolean;
  scoreOther: boolean;
}

const jobs = new Map<string, MockJob>();
const removedVirtual = new Set<string>();

const DEMO: Conversation = {
  id: "demo",
  label: "Demo conversation (synthetic)",
  message_count: 634,
  latest_date: "2025-11-15T22:10:00-08:00",
  is_group: false,
  supported: true,
  is_demo: true,
  participant_count: 1,
};

const MOCK_CONVERSATIONS: Conversation[] = [
  DEMO,
  {
    id: "demo-jordan",
    label: "Jordan Lee (demo data)",
    message_count: 1204,
    latest_date: "2026-01-18T19:04:00-08:00",
    is_group: false,
    supported: true,
    is_demo: true,
    participant_count: 1,
  },
  {
    id: "demo-group",
    label: "Family chat (demo data)",
    message_count: 86,
    latest_date: "2025-12-02T11:00:00-08:00",
    is_group: true,
    supported: false,
    is_demo: true,
    participant_count: 4,
  },
];

const FDA_MESSAGE =
  "Cannot read the Messages database at ~/Library/Messages/chat.db (FileNotFoundError). On macOS, grant Full Disk Access to the app running the backend (System Settings > Privacy & Security > Full Disk Access), then restart it. You can use the demo conversation meanwhile.";

function diskBlocked(): boolean {
  const flag = queryFlag("disk");
  return flag === "1" || flag === "true";
}

function cloneReport(source: Report, job: { id: string; mode: string; conversationId: string; label: string }): Report {
  const report = structuredClone(source);
  report.report_id = job.id;
  report.mode = job.mode;
  report.header.conversation_id = job.conversationId;
  report.header.conversation_label = job.label;
  report.header.is_demo = true;
  report.run_meta.run_id = job.id;
  report.run_meta.mode = job.mode;
  report.run_meta.llm_opt_in = job.mode === "full";
  return report;
}

function withSection(source: Report, section: ExperimentalScores | null, job: { id: string; mode: string; conversationId: string; label: string }): Report {
  const report = cloneReport(source, job);
  if (!section) {
    delete report.experimental_scores;
    return report;
  }
  report.schema_version = "1.1.0";
  report.experimental_scores = structuredClone(section);
  report.run_meta.experimental_opt_in = section.status !== "not_run" || section.reason !== "not requested";
  report.run_meta.score_other_opt_in = section.speakers_scored.some((speaker) => speaker === "other");
  return report;
}

function sourceFor(mode: string): Report {
  return (mode === "deterministic_only" ? deterministicReport : fullReport) as unknown as Report;
}

const DEMO_JOB = {
  conversationId: "demo",
  label: "Demo conversation (synthetic)",
};

function virtualReport(jobId: string): Report | null {
  if (removedVirtual.has(jobId)) return null;
  const full = fullReport as unknown as Report;
  const deterministic = deterministicReport as unknown as Report;
  if (jobId === "sample-full") {
    return cloneReport(full, { id: jobId, mode: "full", ...DEMO_JOB });
  }
  if (jobId === "sample-det") {
    return cloneReport(deterministic, { id: jobId, mode: "deterministic_only", ...DEMO_JOB });
  }
  if (jobId === "sample-exp-live") {
    return cloneReport(liveExperimentalReport as unknown as Report, { id: jobId, mode: "full", ...DEMO_JOB });
  }
  const experimental: Record<string, { mode: "full" | "deterministic_only"; source: Report; section: ExperimentalScores }> = {
    "sample-exp": { mode: "full", source: full, section: stubSection },
    "sample-exp-real": { mode: "full", source: full, section: realLikeSection },
    "sample-exp-det": { mode: "deterministic_only", source: deterministic, section: deterministicSection },
    "sample-exp-me": { mode: "full", source: full, section: nullOtherSection },
    "sample-exp-failed": { mode: "full", source: full, section: failedSection },
    "sample-exp-notrun": { mode: "full", source: full, section: notRunSection },
    "sample-exp-thin": { mode: "full", source: full, section: insufficientSection },
  };
  const match = experimental[jobId];
  if (!match) return null;
  return withSection(match.source, match.section, { id: jobId, mode: match.mode, ...DEMO_JOB });
}

function previewJob(): Job {
  const freeze = queryFlag("freeze") || "scoring";
  const base = {
    job_id: "preview",
    mode: "full",
    conversation_id: "demo",
    created_at: "2025-11-16T06:10:00.000Z",
  };
  if (freeze === "error") {
    return {
      ...base,
      status: "error",
      stage: "scoring",
      progress: { current: 12, total: 40 },
      error: { code: "LLM_UNAVAILABLE", message: "DEEPSEEK_MODEL is not set." },
    };
  }
  const stage = ["loading", "sessionizing", "features", "scoring", "synthesis", "experimental", "done"].includes(freeze)
    ? freeze
    : "scoring";
  if (stage === "done") {
    return { ...base, status: "done", stage: "done", progress: { current: 1, total: 1 }, error: null };
  }
  if (stage === "scoring") {
    return { ...base, status: "running", stage, progress: { current: 12, total: 40 }, error: null };
  }
  if (stage === "experimental") {
    return { ...base, status: "running", stage, progress: { current: 4, total: 8 }, error: null };
  }
  return { ...base, status: "running", stage, progress: { current: 0, total: 1 }, error: null };
}

function jobView(job: MockJob): Job {
  const steps = job.mode === "deterministic_only" ? LOCAL_STEPS : FULL_STEPS;
  const index = Math.min(steps.length - 1, Math.floor((Date.now() - job.started) / STEP_MS));
  const step = steps[index];
  return {
    job_id: job.id,
    status: step.status,
    stage: step.stage,
    progress: { current: step.current, total: step.total },
    mode: job.mode,
    conversation_id: job.conversationId,
    created_at: new Date(job.started).toISOString(),
    error: null,
  };
}

function requireJob(jobId: string): MockJob {
  const job = jobs.get(jobId);
  if (!job || job.deleted) throw new ApiError("NOT_FOUND", `No analysis with id '${jobId}'.`, 404);
  return job;
}

export const mockApi: Client = {
  async getConfig() {
    return mockConfig as Config;
  },

  async getConversations() {
    if (diskBlocked()) {
      return {
        conversations: [DEMO],
        chat_db: { available: false, error: { code: "FULL_DISK_ACCESS_REQUIRED", message: FDA_MESSAGE } },
      };
    }
    return { conversations: MOCK_CONVERSATIONS, chat_db: { available: true, error: null } };
  },

  async listAnalyses() {
    const saved: SavedAnalysis[] = [];
    for (const job of jobs.values()) {
      if (job.deleted) continue;
      const view = jobView(job);
      if (view.status !== "done") continue;
      saved.push({
        job_id: job.id,
        conversation_id: job.conversationId,
        conversation_label: job.label,
        mode: job.mode,
        created_at: view.created_at,
      });
    }
    return saved.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  },

  async createAnalysis(body: AnalysisRequest) {
    const conversation = MOCK_CONVERSATIONS.find((item) => item.id === body.conversation_id);
    if (!conversation) throw new ApiError("NOT_FOUND", `No conversation with id '${body.conversation_id}'.`, 404);
    if (!conversation.supported || conversation.is_group) {
      throw new ApiError("GROUP_CHAT_UNSUPPORTED", "Group chats are not supported. Choose a 1:1 conversation.", 400);
    }
    if (body.mode === "full" && body.llm_opt_in !== true) {
      throw new ApiError("LLM_OPT_IN_REQUIRED", "mode 'full' needs llm_opt_in=true.", 400);
    }
    if (body.score_other && !body.experimental_scores) {
      throw new ApiError(
        "EXPERIMENTAL_CONSENT_REQUIRED",
        "Scoring the other person requires the experimental scores consent.",
        422,
      );
    }
    const mode = body.mode === "deterministic_only" || body.llm_opt_in === false ? "deterministic_only" : "full";
    const id = `demo-${Math.random().toString(16).slice(2, 10)}`;
    jobs.set(id, {
      id,
      mode,
      conversationId: conversation.id,
      label: conversation.label,
      started: Date.now(),
      deleted: false,
      experimental: body.experimental_scores === true,
      scoreOther: body.experimental_scores === true && body.score_other === true,
    });
    return { job_id: id, status: "queued" };
  },

  async getAnalysis(jobId: string) {
    if (jobId === "preview") return previewJob();
    return jobView(requireJob(jobId));
  },

  async getReport(jobId: string) {
    const virtual = virtualReport(jobId);
    if (jobId === "sample-full" || jobId === "sample-det" || jobId.startsWith("sample-exp")) {
      if (!virtual) throw new ApiError("NOT_FOUND", `No report with id '${jobId}'.`, 404);
      return virtual;
    }
    if (jobId === "preview") {
      const view = previewJob();
      if (view.status !== "done") {
        throw new ApiError("REPORT_NOT_READY", `Analysis '${jobId}' is still ${view.status} (stage ${view.stage}).`, 409);
      }
      return cloneReport(sourceFor(view.mode), {
        id: jobId,
        mode: view.mode,
        conversationId: "demo",
        label: "Demo conversation (synthetic)",
      });
    }
    const job = requireJob(jobId);
    const view = jobView(job);
    if (view.status === "error") {
      throw new ApiError(view.error?.code ?? "INTERNAL_ERROR", view.error?.message ?? "Analysis failed.", 409);
    }
    if (view.status !== "done") {
      throw new ApiError("REPORT_NOT_READY", `Analysis '${jobId}' is still ${view.status} (stage ${view.stage}).`, 409);
    }
    const base = sourceFor(job.mode);
    if (!job.experimental) return withSection(base, notRunSection, job);
    const section = job.mode === "deterministic_only" ? deterministicSection : stubSection;
    return withSection(base, job.scoreOther ? section : withNullOther(section), job);
  },

  async deleteAnalysis(jobId: string) {
    if (jobId === "sample-full" || jobId === "sample-det" || jobId.startsWith("sample-exp") || jobId === "preview") {
      if (removedVirtual.has(jobId)) throw new ApiError("NOT_FOUND", `No analysis with id '${jobId}'.`, 404);
      removedVirtual.add(jobId);
      return { deleted: true, job_id: jobId };
    }
    const job = jobs.get(jobId);
    if (!job || job.deleted) throw new ApiError("NOT_FOUND", `No analysis with id '${jobId}'.`, 404);
    job.deleted = true;
    return { deleted: true, job_id: jobId };
  },
};
