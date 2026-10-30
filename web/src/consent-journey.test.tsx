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
      const me = await screen.findByRole("checkbox", { name: config.experimental_opt_in_text });
      const other = screen.getByRole("checkbox", { name: config.score_other_opt_in_text });
      expect(me).toBeChecked();
      expect(other).toHaveProperty("checked", isDemo);
      expect(screen.getByText("Feb 29, 2024 to Nov 2, 2025")).toBeInTheDocument();
      if (!experimental) fireEvent.click(me);
      // Scoring the other person still needs its own choice outside the demo.
      if (experimental && !(other as HTMLInputElement).checked) fireEvent.click(other);
      fireEvent.click(screen.getByRole("button", { name: full ? "Send excerpts and analyze" : "Deterministic only, no LLM" }));
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      expect(create).toHaveBeenCalledWith({
        conversation_id: "synthetic", demo: isDemo, llm_opt_in: full, mode: full ? "full" : "deterministic_only",
        date_from: "2024-02-29", date_to: "2025-11-02", experimental_scores: experimental, score_other: experimental,
        ...(experimental ? { experimental_opt_in_text: config.experimental_opt_in_text, score_other_opt_in_text: config.score_other_opt_in_text } : {}),
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
    expect(screen.getByRole("checkbox", { name: config.experimental_opt_in_text })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: config.score_other_opt_in_text })).toHaveProperty("checked", isDemo);
    expect(create).not.toHaveBeenCalled();
  });
  it.each([false, true])("submits the default experimental choice only after confirmation: full=%s", async (full) => {
    sessionStorage.setItem("psychosight-selection", JSON.stringify(selected));
    render(<App />);
    await screen.findByRole("checkbox", { name: config.experimental_opt_in_text });
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: full ? "Send excerpts and analyze" : "Deterministic only, no LLM" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({
      conversation_id: selected.conversationId,
      llm_opt_in: full,
      mode: full ? "full" : "deterministic_only",
      experimental_scores: true,
      experimental_opt_in_text: config.experimental_opt_in_text,
      score_other: false,
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty("score_other_opt_in_text");
  });
  it("keeps direct-link fallback usable and does not fabricate conversation metadata", async () => {
    render(<App />); await screen.findByTestId("opt-in-text");
    expect(screen.getByRole("link", { name: "Choose a conversation" })).toHaveAttribute("href", "#/");
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deterministic only, no LLM" }));
    expect(location.hash).toBe("#/"); expect(create).not.toHaveBeenCalled();
  });
  it("renders multiline config verbatim, preserves Other dependency and associates submission errors", () => {
    const onLocal = vi.fn(), onFull = vi.fn();
    render(<OptIn text={"Primary ¶\n\nFull disclosure."} busy={false} error="Try again."
      experimentalEnabled experimentalText={"Me consent.\n\nSecond paragraph."} scoreOtherText={"Other consent.\nExplicit choice."}
      demoProviderNote={"Provider note.\nSecond line."} onLocalOnly={onLocal} onOptIn={onFull} />);
    expect(screen.getByTestId("opt-in-text").textContent).toBe("Primary ¶\n\nFull disclosure.");
    expect(screen.getByTestId("demo-provider-note").textContent).toBe("Provider note.\nSecond line.");
    const [me, other] = screen.getAllByRole("checkbox");
    expect(other.nextSibling?.textContent).toBe("Other consent.\nExplicit choice.");
    expect(other).toBeEnabled(); fireEvent.click(other); fireEvent.click(me);
    expect(other).toBeDisabled(); fireEvent.click(me);
    expect(other).not.toBeChecked();
    for (const button of screen.getAllByRole("button")) expect(button).toHaveAttribute("aria-describedby", "submission-error");
    fireEvent.click(screen.getByRole("button", { name: "Send excerpts and analyze" }));
    expect(onFull).toHaveBeenCalledWith({ experimental: true, scoreOther: false }, null);
  });
});
