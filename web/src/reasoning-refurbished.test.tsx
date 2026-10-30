import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fullReport from "../../docs/sample_report.json";
import { App } from "./App";
import { ApiError, getClient } from "./api";
import { MODEL_STEP_LABEL } from "./components/ReasoningControl";
import { ReportView } from "./components/ReportView";
import mockConfig from "./fixtures/mock-config.json";
import { readReasoningControl } from "./reasoning-adapter";
import type { Config, Report } from "./types";

vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), getClient: vi.fn() }));
const create = vi.fn();
const selected = { conversationId: "demo", label: "Demo conversation (synthetic)", isDemo: true, dateFrom: "", dateTo: "" };

beforeEach(() => {
  sessionStorage.clear();
  create.mockReset();
  create.mockReturnValue(new Promise(() => {}));
  window.history.replaceState(null, "", "/#/optin");
  sessionStorage.setItem("psychosight-selection", JSON.stringify(selected));
  vi.mocked(getClient).mockResolvedValue({
    getConfig: async () => mockConfig as unknown as Config,
    listAnalyses: async () => [],
    createAnalysis: create,
    getAnalysis: () => new Promise(() => {}),
  } as unknown as Awaited<ReturnType<typeof getClient>>);
});

describe("reasoning slider in the refurbished consent flow", () => {
  it("matches the backend levels and default in psychosight/reasoning.py", () => {
    const source = readFileSync(path.resolve(process.cwd(), "../psychosight/reasoning.py"), "utf8");
    const backend = [...source.matchAll(/\{"id": "([^"]+)", "label": "([^"]+)",\s*"description": "([^"]+)"\}/g)].map(
      (match) => ({ id: match[1], label: match[2], description: match[3] }),
    );
    expect(backend).toHaveLength(4);
    expect(mockConfig.reasoning_levels).toEqual(backend);
    expect(mockConfig.default_reasoning).toBe(source.match(/DEFAULT_REASONING = "([^"]+)"/)?.[1]);
  });

  it("starts at default_reasoning, steps by keyboard, and sends the chosen level", async () => {
    render(<App />);
    const slider = await screen.findByRole("slider", { name: "Reasoning" });
    expect(slider).toHaveAttribute("aria-valuetext", "Low (default)");
    expect(slider).not.toHaveAttribute("tabindex", "-1");
    slider.focus();
    expect(slider).toHaveFocus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuetext", "High");
    fireEvent.keyDown(slider, { key: "End" });
    expect(screen.getByTestId("reasoning-current")).toHaveTextContent("Max (slowest)");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuetext", "Off (fastest)");
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider).toHaveAttribute("aria-valuetext", "High");
    fireEvent.click(screen.getByRole("button", { name: "Send excerpts and analyze" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ llm_opt_in: true, mode: "full", reasoning_level: "high" });
    expect(slider).toBeDisabled();
  });

  it("sends the config default when the slider is untouched", async () => {
    render(<App />);
    await screen.findByRole("slider", { name: "Reasoning" });
    fireEvent.click(screen.getByRole("button", { name: "Send excerpts and analyze" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0].reasoning_level).toBe(readReasoningControl(mockConfig).levels[1].id);
  });

  it("omits reasoning_level for a deterministic-only run", async () => {
    render(<App />);
    const slider = await screen.findByRole("slider", { name: "Reasoning" });
    fireEvent.keyDown(slider, { key: "End" });
    fireEvent.click(screen.getByRole("button", { name: "Deterministic only, no LLM" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).not.toHaveProperty("reasoning_level");
  });

  it("blocks the LLM path while the model step is off", async () => {
    render(<App />);
    const slider = await screen.findByRole("slider", { name: "Reasoning" });
    fireEvent.click(screen.getByRole("checkbox", { name: MODEL_STEP_LABEL }));
    expect(slider).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send excerpts and analyze" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deterministic only, no LLM" })).toBeEnabled();
  });

  it("shows the server's INVALID_REASONING_LEVEL message as the submission error", async () => {
    const message = "reasoning_level 'ultra' is not supported. Valid values: none, low, high, max (default low).";
    create.mockRejectedValue(new ApiError("INVALID_REASONING_LEVEL", message, 422));
    render(<App />);
    await screen.findByRole("slider", { name: "Reasoning" });
    fireEvent.click(screen.getByRole("button", { name: "Send excerpts and analyze" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("slider", { name: "Reasoning" })).toBeEnabled();
  });

  it("shows the level label in the refurbished report overview", () => {
    const report = structuredClone(fullReport) as unknown as Report;
    report.run_meta.reasoning_level = "max";
    render(
      <ReportView report={report} deleting={false} deleteError={null} reasoningLevels={mockConfig.reasoning_levels} onDelete={() => {}} />,
    );
    expect(screen.getByTestId("reasoning-used")).toHaveTextContent("Reasoning Max (slowest)");
  });
});
