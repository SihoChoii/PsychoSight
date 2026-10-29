import { describe, expect, it } from "vitest";
import { buildAnalysisRequest } from "./analysis-request";
import config from "./fixtures/mock-config.json";

// Assert complete wire bodies so presentation changes cannot silently add consent or fields.
describe("analysis request consent matrix", () => {
  for (const isDemo of [false, true]) for (const llmOptIn of [false, true]) {
    for (const enabled of [false, true]) for (const experimental of [false, true]) for (const scoreOther of [false, true]) {
      it(`demo=${isDemo}, AI=${llmOptIn}, enabled=${enabled}, experimental=${experimental}, Other=${scoreOther}`, () => {
        const experimentalText = "First paragraph.\n\nExact experimental consent ¶";
        const otherText = "Exact Other consent.\nKeep whitespace.";
        const result = buildAnalysisRequest({
          conversationId: "a-conversation", isDemo, llmOptIn, dateFrom: "2024-02-29", dateTo: "2025-11-02",
          choice: { experimental, scoreOther },
          config: { ...config, experimental_enabled: enabled, experimental_opt_in_text: experimentalText, score_other_opt_in_text: otherText },
        });
        const active = enabled && experimental;
        expect(result).toEqual({
          conversation_id: "a-conversation", demo: isDemo, llm_opt_in: llmOptIn,
          mode: llmOptIn ? "full" : "deterministic_only",
          date_from: "2024-02-29", date_to: "2025-11-02",
          experimental_scores: active, score_other: active && scoreOther,
          ...(active ? { experimental_opt_in_text: experimentalText } : {}),
          ...(active && scoreOther ? { score_other_opt_in_text: otherText } : {}),
        });
      });
    }
  }
  it("supports a legacy demo identifier, no config and omitted dates", () => {
    expect(buildAnalysisRequest({ conversationId: "demo", isDemo: false, dateFrom: "", dateTo: "", llmOptIn: false,
      choice: { experimental: true, scoreOther: true }, config: null })).toEqual({
      conversation_id: "demo", demo: true, llm_opt_in: false, mode: "deterministic_only", experimental_scores: false, score_other: false,
    });
  });
});
