import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fullReport from "../../docs/sample_report.json";
import { buildAnalysisRequest } from "./analysis-request";
import { OptIn } from "./components/OptIn";
import { DETERMINISTIC_REASON, MODEL_STEP_LABEL } from "./components/ReasoningControl";
import { ReportView } from "./components/ReportView";
import mockConfig from "./fixtures/mock-config.json";
import { mockApi } from "./mock";
import {
  REASONING_DEEP_LABEL,
  REASONING_HINT,
  REASONING_QUICK_LABEL,
  interpretReasoningLevel,
  readReasoningControl,
  reasoningFields,
} from "./reasoning-adapter";
import type { AnalysisRequest, Config, ExperimentalChoice, Report } from "./types";

const choice: ExperimentalChoice = { experimental: false, scoreOther: false };
const levels = mockConfig.reasoning_levels;
const low = levels[1];
const maxLevel = levels[3];

function renderSetup(props: Partial<ComponentProps<typeof OptIn>> = {}) {
  const onOptIn = vi.fn();
  const onLocalOnly = vi.fn();
  render(
    <OptIn
      text="Disclosure"
      busy={false}
      error={null}
      reasoningConfig={mockConfig}
      onOptIn={onOptIn}
      onLocalOnly={onLocalOnly}
      {...props}
    />,
  );
  return { onOptIn, onLocalOnly };
}

function request(llmOptIn: boolean, reasoningLevel: string | null, source: unknown = mockConfig) {
  return buildAnalysisRequest({
    conversationId: "demo",
    isDemo: true,
    dateFrom: "",
    dateTo: "",
    llmOptIn,
    choice,
    config: source as Config | null,
    reasoningLevel,
  });
}

function post(body: AnalysisRequest) {
  return mockApi.createAnalysis(body);
}

describe("reasoning control", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders config labels and the selected description, with Quick and Deep as end captions", () => {
    renderSetup();
    const group = screen.getByRole("group", { name: "Reasoning" });
    const slider = within(group).getByRole("slider", { name: "Reasoning" });
    expect(slider).toBeEnabled();
    expect(slider).toHaveAttribute("aria-valuetext", low.label);
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByTestId("reasoning-current")).toHaveTextContent(low.label);
    expect(screen.getByTestId("reasoning-description")).toHaveTextContent(low.description);
    expect(screen.getByTestId("reasoning-hint")).toHaveTextContent(REASONING_HINT);
    expect(screen.getByTestId("reasoning-end-quick")).toHaveTextContent(REASONING_QUICK_LABEL);
    expect(screen.getByTestId("reasoning-end-deep")).toHaveTextContent(REASONING_DEEP_LABEL);
    for (const level of levels) {
      expect(within(group).getByRole("button", { name: level.label })).toBeInTheDocument();
    }
    expect(within(group).getByRole("button", { name: low.label })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: MODEL_STEP_LABEL })).toBeChecked();
    expect(mockConfig.reasoning_effort).toBe(mockConfig.default_reasoning);
    expect(screen.getByTestId("reasoning-hint")).not.toHaveTextContent("8 minutes");
  });

  it("keeps a supplied description verbatim and does not read a hint field", () => {
    renderSetup({
      reasoningConfig: {
        reasoning_levels: [
          { id: "none", label: "Off (fastest)", description: "No extra thinking." },
          { id: "low", label: "Low (default)", description: "SENTINEL ¶ keep this description." },
        ],
        default_reasoning: "low",
        reasoning_hint: "Do not show this hint.",
      },
    });
    expect(screen.getByTestId("reasoning-description")).toHaveTextContent("SENTINEL ¶ keep this description.");
    expect(screen.getByTestId("reasoning-hint")).toHaveTextContent(REASONING_HINT);
    expect(screen.queryByText("Do not show this hint.")).not.toBeInTheDocument();
    expect(screen.getByTestId("reasoning-end-quick")).toHaveTextContent("Quick");
    expect(screen.getByTestId("reasoning-end-deep")).toHaveTextContent("Deep");
  });

  it("moves with arrows, Home, End, Page Up, and Page Down", () => {
    renderSetup();
    const slider = screen.getByRole("slider", { name: "Reasoning" });
    slider.focus();
    expect(slider).toHaveFocus();
    expect(slider).toHaveAttribute("aria-valuetext", "Low (default)");

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuetext", "High");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuetext", "Low (default)");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(slider).toHaveAttribute("aria-valuetext", "High");
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(slider).toHaveAttribute("aria-valuetext", "Low (default)");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuetext", "Off (fastest)");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuetext", "Off (fastest)");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuetext", "Max (slowest)");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuetext", "Max (slowest)");
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(slider).toHaveAttribute("aria-valuetext", "Low (default)");
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider).toHaveAttribute("aria-valuetext", "Max (slowest)");
    fireEvent.keyDown(slider, { key: "Home" });
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider).toHaveAttribute("aria-valuetext", "High");
  });

  it("sends the selected id on the model path and echoes the canonical id", async () => {
    const { onOptIn, onLocalOnly } = renderSetup();
    fireEvent.click(screen.getByRole("button", { name: maxLevel.label }));
    expect(screen.getByTestId("reasoning-current")).toHaveTextContent(maxLevel.label);
    expect(screen.getByTestId("reasoning-description")).toHaveTextContent(maxLevel.description);
    fireEvent.click(screen.getByRole("button", { name: "Send excerpts and analyze" }));
    expect(onOptIn).toHaveBeenCalledWith(choice, "max");
    const sent = request(true, "max");
    expect(sent[reasoningFields.requestLevel]).toBe("max");
    const created = await post(sent);
    expect(created[reasoningFields.requestLevel]).toBe("max");

    const mixedCase = await post({
      conversation_id: "demo",
      llm_opt_in: true,
      mode: "full",
      [reasoningFields.requestLevel]: "HIGH",
    });
    expect(mixedCase[reasoningFields.requestLevel]).toBe("high");

    fireEvent.click(screen.getByRole("button", { name: "Deterministic only, no LLM" }));
    expect(onLocalOnly).toHaveBeenCalledWith(choice, null);
    const local = request(false, "max");
    expect(local).not.toHaveProperty(reasoningFields.requestLevel);
    const quiet = await post(local);
    expect(quiet).not.toHaveProperty(reasoningFields.requestLevel);
  });

  it("records the level on a full report and leaves it null for a deterministic run", async () => {
    const started = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(started);
    const full = await post({ conversation_id: "demo", llm_opt_in: true, mode: "full" });
    expect(full).not.toHaveProperty(reasoningFields.requestLevel);
    const local = await post({ conversation_id: "demo", llm_opt_in: false, mode: "deterministic_only" });
    clock.mockReturnValue(started + 10 * 60 * 1000);
    const fullReport = await mockApi.getReport(full.job_id);
    expect(fullReport.run_meta.reasoning_level).toBe("low");
    expect(fullReport.run_meta.reasoning_effort).toBeNull();
    const localReport = await mockApi.getReport(local.job_id);
    expect(localReport.run_meta.reasoning_level).toBeNull();
    expect(localReport.run_meta.reasoning_effort).toBeNull();
  });

  it("rejects an unknown level and a non-string, and shows the server message", async () => {
    const unknown = interpretReasoningLevel("medium", mockConfig);
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.code).toBe("INVALID_REASONING_LEVEL");
    expect(unknown.message).toBe(
      "reasoning_level 'medium' is not supported. Valid values: none, low, high, max (default low).",
    );
    await expect(
      post({
        conversation_id: "demo",
        llm_opt_in: true,
        [reasoningFields.requestLevel]: "medium",
      }),
    ).rejects.toMatchObject({ code: unknown.code, status: 422, message: unknown.message });

    const typed = interpretReasoningLevel(1, mockConfig);
    expect(typed.ok).toBe(false);
    if (typed.ok) return;
    expect(typed.code).toBe("INVALID_REQUEST");
    expect(typed.message).toBe("Invalid request fields: reasoning_level.");
    await expect(
      post({
        conversation_id: "demo",
        llm_opt_in: true,
        [reasoningFields.requestLevel]: 1 as unknown as string,
      }),
    ).rejects.toMatchObject({ code: typed.code, status: 422, message: typed.message });

    renderSetup({ error: unknown.message });
    expect(screen.getByRole("alert")).toHaveTextContent(unknown.message);
  });

  it("hides the control and sends nothing when config has no levels", async () => {
    renderSetup({ reasoningConfig: { default_reasoning: "low" } });
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Reasoning" })).not.toBeInTheDocument();
    const body = request(true, "low", { opt_in_text: "x" });
    expect(body).not.toHaveProperty(reasoningFields.requestLevel);
    const created = await post(body);
    expect(created).not.toHaveProperty(reasoningFields.requestLevel);
    expect(readReasoningControl({ reasoning_levels: [] }).visible).toBe(false);
    expect(readReasoningControl({ reasoning_levels: "low" }).visible).toBe(false);
    expect(readReasoningControl(null).visible).toBe(false);
  });

  it("disables the slider for a deterministic-only run and does not send a level", () => {
    const { onOptIn } = renderSetup();
    const slider = screen.getByRole("slider", { name: "Reasoning" });
    fireEvent.click(screen.getByRole("checkbox", { name: MODEL_STEP_LABEL }));
    expect(slider).toBeDisabled();
    expect(screen.getByTestId("reasoning-reason")).toHaveTextContent(DETERMINISTIC_REASON);
    expect(screen.getByRole("button", { name: "Send excerpts and analyze" })).toBeDisabled();
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuetext", "Low (default)");
    fireEvent.click(screen.getByRole("button", { name: "Send excerpts and analyze" }));
    expect(onOptIn).not.toHaveBeenCalled();
    expect(request(true, null)).not.toHaveProperty(reasoningFields.requestLevel);
    expect(request(false, "low")).not.toHaveProperty(reasoningFields.requestLevel);
  });

  it("falls back when the default is unknown, and keeps unlabeled level text as the id", () => {
    const unknown = readReasoningControl({
      reasoning_levels: levels,
      default_reasoning: "ultra",
    });
    expect(unknown.levels[unknown.defaultIndex]?.id).toBe("low");
    expect(unknown.hint).toBe(REASONING_HINT);

    const onlyZero = readReasoningControl({
      reasoning_levels: [{ id: "none" }],
      default_reasoning: "missing",
    });
    expect(onlyZero.levels[onlyZero.defaultIndex]?.id).toBe("none");
    expect(onlyZero.levels[0]?.label).toBe("none");

    const strings = readReasoningControl({
      reasoning_levels: ["none", "low", "medium", "high"],
      default_reasoning: "NOPE",
    });
    expect(strings.levels.map((level) => level.label)).toEqual(["none", "low", "medium", "high"]);
    expect(strings.levels[strings.defaultIndex]?.id).toBe("low");

    const noZero = readReasoningControl({
      reasoning_levels: ["medium", "high"],
      default_reasoning: "max",
    });
    expect(noZero.levels[noZero.defaultIndex]?.id).toBe("medium");
    expect(noZero.levels.map((level) => level.label)).toEqual(["medium", "high"]);

    const named = readReasoningControl({
      reasoning_levels: [
        { id: "none", label: "Off (fastest)" },
        { id: "max", label: "Max (slowest)" },
      ],
      default_reasoning: "NoNe",
    });
    expect(named.levels[named.defaultIndex]?.id).toBe("none");
    expect(named.levels.map((level) => level.label)).toEqual(["Off (fastest)", "Max (slowest)"]);

    renderSetup({
      reasoningConfig: {
        reasoning_levels: ["none", "low", "high", "max"],
        default_reasoning: "nope",
      },
    });
    expect(screen.getByTestId("reasoning-current")).toHaveTextContent("low");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "low");
    expect(screen.getByTestId("reasoning-end-quick")).toHaveTextContent("Quick");
    expect(screen.getByTestId("reasoning-end-deep")).toHaveTextContent("Deep");
    expect(screen.getByTestId("reasoning-hint")).toHaveTextContent(REASONING_HINT);
  });

  it("shows the level label in the report header when the run used one", () => {
    const report = structuredClone(fullReport) as unknown as Report;
    report.run_meta.reasoning_level = "max";
    report.run_meta.reasoning_effort = null;
    const view = render(
      <ReportView
        report={report}
        deleting={false}
        deleteError={null}
        reasoningLevels={readReasoningControl(mockConfig).levels}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("reasoning-used")).toHaveTextContent("Reasoning Max (slowest)");
    view.unmount();

    report.run_meta.reasoning_level = null;
    render(
      <ReportView
        report={report}
        deleting={false}
        deleteError={null}
        reasoningLevels={readReasoningControl(mockConfig).levels}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("reasoning-used")).not.toBeInTheDocument();
  });
});
