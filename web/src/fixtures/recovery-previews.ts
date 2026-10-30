/** Development-only synthetic recovery states. Never wraps the HTTP client. */
import { ApiError, type Client } from "../api";
import type { SavedAnalysis } from "../types";

const saved: SavedAnalysis[] = [{ job_id: "sample-det", conversation_id: "demo", conversation_label: "Synthetic saved conversation with a long label for narrow-screen review", mode: "deterministic_only", created_at: "2026-10-29T12:00:00Z" }];
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const failure = (message: string) => new ApiError("INTERNAL_ERROR", message, 0);

export function withRecoveryPreview(client: Client, state: string | null): Client {
  // The dev root uses Strict Mode, which exercises each initial read twice.
  let reads = 0, deletes = 0, lists = 0, configs = 0, submissions = 0;
  return {
    ...client,
    async getReport(id) {
      if (state === "report-loading") await wait(1800);
      if (state === "report-error" && ++reads <= 2) throw failure("Synthetic report retrieval failed.");
      return client.getReport(id);
    },
    async deleteAnalysis(id) {
      if (state === "delete-failure" && ++deletes === 1) {
        await wait(6000);
        throw failure("Synthetic deletion failed. The saved report is still available.");
      }
      if (state === "delete-pending") await wait(6000);
      return client.deleteAnalysis(id);
    },
    async listAnalyses() {
      if (state === "saved-loading") await wait(1800);
      if (state === "saved-error" && ++lists <= 2) throw failure("Synthetic saved list unavailable.");
      if (state === "saved-refresh" && ++lists === 4) throw failure("Synthetic saved list refresh failed.");
      if (state?.startsWith("saved-")) return saved;
      return client.listAnalyses();
    },
    async getConfig() {
      if (state === "config-error" && ++configs <= 2) throw failure("Synthetic disclosure unavailable.");
      return client.getConfig();
    },
    async createAnalysis(body) {
      if (state === "submission-error" && ++submissions === 1) throw failure("Synthetic analysis submission failed.");
      return client.createAnalysis(body);
    },
  };
}
