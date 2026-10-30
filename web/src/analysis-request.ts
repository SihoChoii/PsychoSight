import { attachReasoningLevel } from "./reasoning-adapter";
import type { AnalysisRequest, Config, ExperimentalChoice } from "./types";

export function buildAnalysisRequest(input: {
  conversationId: string;
  isDemo: boolean;
  dateFrom: string;
  dateTo: string;
  llmOptIn: boolean;
  choice: ExperimentalChoice;
  config: Config | null;
  reasoningLevel?: string | null;
}): AnalysisRequest {
  const enabled = input.config?.experimental_enabled === true;
  const experimental = enabled && input.choice.experimental;
  const scoreOther = experimental && input.choice.scoreOther;
  const body: AnalysisRequest = {
    conversation_id: input.conversationId,
    llm_opt_in: input.llmOptIn,
    mode: input.llmOptIn ? "full" : "deterministic_only",
    demo: input.isDemo || input.conversationId === "demo",
    experimental_scores: experimental,
    score_other: scoreOther,
    ...(input.dateFrom ? { date_from: input.dateFrom } : {}),
    ...(input.dateTo ? { date_to: input.dateTo } : {}),
  };
  if (experimental && input.config?.experimental_opt_in_text) {
    body.experimental_opt_in_text = input.config.experimental_opt_in_text;
  }
  if (scoreOther && input.config?.score_other_opt_in_text) {
    body.score_other_opt_in_text = input.config.score_other_opt_in_text;
  }
  return attachReasoningLevel(body, {
    config: input.config,
    llmOptIn: input.llmOptIn,
    reasoningLevel: input.reasoningLevel,
  });
}
