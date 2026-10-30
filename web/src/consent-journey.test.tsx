import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { getClient } from "./api";
import { OptIn } from "./components/OptIn";
import config from "./fixtures/mock-config.json";
import type { Config } from "./types";

vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), getClient: vi.fn() }));
const create = vi.fn();
const selected = { conversationId: "synthetic", label: "Synthetic boundary conversation", isDemo: false, dateFrom: "2024-02-29", dateTo: "2025-11-02" };
function client(getConfig: () => Promise<Config> = async () => config) {
  vi.mocked(getClient).mockResolvedValue({ getConfig, listAnalyses: async () => [], createAnalysis: create,
    getAnalysis: () => new Promise(() => {}) } as unknown as Awaited<ReturnType<typeof getClient>>);
}
beforeEach(() => {
  sessionStorage.clear(); create.mockReset();
  window.history.replaceState(null, "", "/#/optin");
  create.mockReturnValue(new Promise(() => {})); client();
});

describe("consent journey", () => {
  for (const isDemo of [false, true]) for (const full of [false, true]) for (const experimental of [false, true]) {
    it(`submits actual controls: demo=${isDemo}, full=${full}, experimental=${experimental}`, async () => {
      sessionStorage.setItem("psychosight-selection", JSON.stringify({ ...selected, isDemo }));
      render(<App />);
      const me = await screen.findByRole("checkbox", { name: "Add experimental scores" });
      const other = screen.getByRole("checkbox", { name: "Also score the other person" });
      expect(me).toBeDisabled();
      fireEvent.click(screen.getByRole("checkbox", { name: "Enable AI analysis" }));
      expect(me).toBeChecked();
      expect(other).toHaveProperty("checked", isDemo);
      expect(screen.getByText("Feb 29, 2024 to Nov 2, 2025")).toBeInTheDocument();
      if (!experimental) fireEvent.click(me);
      // Scoring the other person still needs its own choice outside the demo.
      if (experimental && !(other as HTMLInputElement).checked) fireEvent.click(other);
      fireEvent.click(screen.getByRole("button", { name: full ? "Send excerpts and analyze" : "Deterministic only, no LLM" }));
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      const included = full && experimental;
      expect(create).toHaveBeenCalledWith({
        conversation_id: "synthetic", demo: isDemo, llm_opt_in: full, mode: full ? "full" : "deterministic_only",
        date_from: "2024-02-29", date_to: "2025-11-02", experimental_scores: included, score_other: included,
        ...(included ? { experimental_opt_in_text: config.experimental_opt_in_text, score_other_opt_in_text: config.score_other_opt_in_text } : {}),
        // The reasoning slider starts at default_reasoning and is sent only with the LLM opt-in.
        ...(full ? { reasoning_level: config.default_reasoning } : {}),
      });
      expect(screen.getByRole("status")).toHaveTextContent("Starting analysis.");
      expect(me).toBeDisabled(); expect(other).toBeDisabled();
      expect(screen.getByRole("button", { name: /^Starting$/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Deterministic only, no LLM" })).toBeDisabled();
    });
  }
  it.each([false, true])("initializes defaults after a delayed config: demo=%s", async (isDemo) => {
    let resolve: (value: Config) => void = () => {};
    client(() => new Promise((yes) => { resolve = yes; }));
    sessionStorage.setItem("psychosight-selection", JSON.stringify({ ...selected, isDemo }));
    render(<App />); await act(async () => {});
    expect(screen.getByText("Loading the disclosure.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send excerpts and analyze" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deterministic only, no LLM" })).toBeEnabled();
    await act(async () => resolve(config));
    expect(screen.getByRole("checkbox", { name: "Add experimental scores" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Add experimental scores" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable AI analysis" }));
    expect(screen.getByRole("checkbox", { name: "Add experimental scores" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Also score the other person" })).toHaveProperty("checked", isDemo);
    expect(create).not.toHaveBeenCalled();
  });
  it.each([false, true])("submits the default experimental choice only after confirmation: full=%s", async (full) => {
    sessionStorage.setItem("psychosight-selection", JSON.stringify(selected));
    render(<App />);
    await screen.findByRole("checkbox", { name: "Add experimental scores" });
    expect(create).not.toHaveBeenCalled();
    if (full) fireEvent.click(screen.getByRole("checkbox", { name: "Enable AI analysis" }));
    fireEvent.click(screen.getByRole("button", { name: full ? "Send excerpts and analyze" : "Deterministic only, no LLM" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({
      conversation_id: selected.conversationId,
      llm_opt_in: full,
      mode: full ? "full" : "deterministic_only",
      experimental_scores: full,
      ...(full ? { experimental_opt_in_text: config.experimental_opt_in_text } : {}),
      score_other: false,
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty("score_other_opt_in_text");
    if (!full) expect(create.mock.calls[0][0]).not.toHaveProperty("experimental_opt_in_text");
  });
  it("keeps direct-link fallback usable and does not fabricate conversation metadata", async () => {
    render(<App />); await screen.findByTestId("opt-in-text");
    expect(screen.getByRole("link", { name: "Choose a conversation" })).toHaveAttribute("href", "#/");
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deterministic only, no LLM" }));
    expect(location.hash).toBe("#/"); expect(create).not.toHaveBeenCalled();
  });
  it("suspends dependent choices when AI is off and preserves an explicit experimental opt-out", async () => {
    sessionStorage.setItem("psychosight-selection", JSON.stringify(selected));
    render(<App />);
    const experimental = await screen.findByRole("checkbox", { name: "Add experimental scores" });
    const ai = screen.getByRole("checkbox", { name: "Enable AI analysis" });
    const other = screen.getByRole("checkbox", { name: "Also score the other person" });
    const slider = screen.getByRole("slider", { name: "Reasoning" });
    expect(ai).not.toBeChecked();
    expect(experimental).toBeDisabled();
    expect(other).toBeDisabled();
    expect(slider).toBeDisabled();
    expect(experimental).toHaveAccessibleDescription(config.experimental_opt_in_text);
    fireEvent.click(ai);
    fireEvent.keyDown(slider, { key: "End" });
    fireEvent.click(other);
    fireEvent.click(ai);
    expect(experimental).not.toBeChecked();
    expect(other).not.toBeChecked();
    expect(slider).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send excerpts and analyze" })).toBeDisabled();
    fireEvent.click(ai);
    expect(experimental).toBeChecked();
    expect(other).toBeChecked();
    expect(slider).toHaveAttribute("aria-valuetext", "Max (slowest)");
    fireEvent.click(experimental);
    fireEvent.click(ai);
    fireEvent.click(ai);
    expect(experimental).not.toBeChecked();
    expect(other).not.toBeChecked();
    expect(other).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Send excerpts and analyze" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ llm_opt_in: true, experimental_scores: false, score_other: false, reasoning_level: "max" });
  });
  it("requires the AI choice even when the server supplies no reasoning levels", async () => {
    client(async () => ({ ...config, reasoning_levels: [] }));
    sessionStorage.setItem("psychosight-selection", JSON.stringify(selected));
    render(<App />);
    const experimental = await screen.findByRole("checkbox", { name: "Add experimental scores" });
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(experimental).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send excerpts and analyze" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable AI analysis" }));
    fireEvent.click(screen.getByRole("button", { name: "Send excerpts and analyze" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ llm_opt_in: true, experimental_scores: true, score_other: false });
    expect(create.mock.calls[0][0]).not.toHaveProperty("reasoning_level");
  });
  it("renders multiline config verbatim, preserves Other dependency and associates submission errors", () => {
    const onLocal = vi.fn(), onFull = vi.fn();
    render(<OptIn text={"Primary ¶\n\nFull disclosure."} busy={false} error="Try again."
      experimentalEnabled experimentalText={"Me consent.\n\nSecond paragraph."} scoreOtherText={"Other consent.\nExplicit choice."}
      demoProviderNote={"Provider note.\nSecond line."} onLocalOnly={onLocal} onOptIn={onFull} />);
    expect(screen.getByTestId("opt-in-text").textContent).toBe("Primary ¶\n\nFull disclosure.");
    expect(screen.getByTestId("demo-provider-note").textContent).toBe("Provider note.\nSecond line.");
    const [ai, me, other] = screen.getAllByRole("checkbox");
    fireEvent.click(ai);
    expect(other).toHaveAccessibleDescription("Other consent.\nExplicit choice.");
    expect(other).toBeEnabled(); fireEvent.click(other); fireEvent.click(me);
    expect(other).toBeDisabled(); fireEvent.click(me);
    expect(other).not.toBeChecked();
    for (const button of screen.getAllByRole("button")) expect(button).toHaveAttribute("aria-describedby", "submission-error");
    fireEvent.click(screen.getByRole("button", { name: "Send excerpts and analyze" }));
    expect(onFull).toHaveBeenCalledWith({ experimental: true, scoreOther: false }, null);
  });
});
