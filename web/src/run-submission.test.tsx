import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { getClient } from "./api";
import config from "./fixtures/mock-config.json";
import type { PickerSelection } from "./components/Picker";
import type { ExperimentalChoice } from "./types";

vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), getClient: vi.fn() }));
const selection = { conversationId: "demo", label: "Alex (synthetic)", isDemo: true, dateFrom: "2025-01-01", dateTo: "2025-03-01" };
const choice = { experimental: false, scoreOther: false };
vi.mock("./components/Picker", () => ({ Picker: ({ onContinue, activeJobId }: { onContinue: (value: PickerSelection) => void; activeJobId: string | null }) =>
  <><button onClick={() => onContinue(selection)}>Choose</button>{activeJobId ? <span>Return to analysis</span> : null}</> }));
vi.mock("./components/OptIn", () => ({ OptIn: ({ onLocalOnly, onOptIn, error }: { onLocalOnly: (value: ExperimentalChoice) => void; onOptIn: (value: ExperimentalChoice) => void; error: string | null }) =>
  <><button onClick={() => onLocalOnly(choice)}>Local</button><button onClick={() => onOptIn(choice)}>Full</button>{error ? <p role="alert">{error}</p> : null}</> }));
const createAnalysis = vi.fn();
async function flush() { await act(async () => {}); }
async function navigate(hash: string) {
  await act(async () => { window.history.replaceState(null, "", `/${hash}`); window.dispatchEvent(new HashChangeEvent("hashchange")); });
}
beforeEach(() => {
  vi.restoreAllMocks(); sessionStorage.clear(); window.history.replaceState(null, "", "/#/");
  createAnalysis.mockReset();
  vi.mocked(getClient).mockResolvedValue({ getConfig: async () => config, listAnalyses: async () => [], createAnalysis,
    getAnalysis: () => new Promise(() => {}) } as unknown as Awaited<ReturnType<typeof getClient>>);
});
afterEach(() => vi.restoreAllMocks());

describe("run context creation boundary", () => {
  it.each(["Local", "Full"])("stores context only after successful %s creation, using the returned ID", async (path) => {
    let resolve: (value: { job_id: string; status: string }) => void = () => {};
    createAnalysis.mockReturnValue(new Promise((yes) => { resolve = yes; }));
    render(<App />); await flush(); fireEvent.click(screen.getByText("Choose")); await navigate("#/optin");
    fireEvent.click(screen.getByText(path)); await flush();
    expect(Object.keys(sessionStorage).some((key) => key.startsWith("psychosight-run-context:"))).toBe(false);
    await act(async () => resolve({ job_id: "returned-id", status: "queued" }));
    expect(location.hash).toBe("#/run/returned-id");
    expect(JSON.parse(sessionStorage.getItem("psychosight-run-context:returned-id") ?? "null")).toEqual({ ...selection, version: 1, jobId: "returned-id" });
    expect(createAnalysis).toHaveBeenCalledTimes(1);
    expect(createAnalysis.mock.calls[0][0]).toMatchObject({ conversation_id: "demo", llm_opt_in: path === "Full", date_from: "2025-01-01", date_to: "2025-03-01" });
  });
  it("does not store context or navigate on creation failure", async () => {
    createAnalysis.mockRejectedValue(new Error("offline"));
    sessionStorage.setItem("psychosight-selection", JSON.stringify(selection));
    await navigate("#/optin"); render(<App />); await flush(); fireEvent.click(screen.getByText("Local")); await flush();
    expect(location.hash).toBe("#/optin"); expect(screen.getByRole("alert")).toHaveTextContent("could not be started");
    expect(sessionStorage.getItem("psychosight-active-job")).toBeNull();
    expect(Object.keys(sessionStorage).some((key) => key.startsWith("psychosight-run-context:"))).toBe(false);
  });
  it("continues an in-memory journey when session storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("disabled"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    createAnalysis.mockResolvedValue({ job_id: "without-storage", status: "queued" });
    render(<App />); await flush(); fireEvent.click(screen.getByText("Choose")); await navigate("#/optin");
    fireEvent.click(screen.getByText("Local")); await flush(); expect(location.hash).toBe("#/run/without-storage");
    await navigate("#/run/without-storage"); expect(screen.getByRole("heading", { name: "Checking analysis" })).toBeInTheDocument();
  });
});


it("guards both submit paths synchronously, then permits retry after a failure", async () => {
  let reject: (reason: Error) => void = () => {};
  createAnalysis.mockReturnValueOnce(new Promise((_, no) => { reject = no; }));
  sessionStorage.setItem("psychosight-selection", JSON.stringify(selection));
  await navigate("#/optin"); render(<App />); await flush();
  act(() => {
    fireEvent.click(screen.getByText("Local"));
    fireEvent.click(screen.getByText("Full"));
    fireEvent.click(screen.getByText("Local"));
  });
  await flush();
  expect(createAnalysis).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("offline")));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  createAnalysis.mockResolvedValueOnce({ job_id: "retry-success", status: "queued" });
  fireEvent.click(screen.getByText("Full")); await flush();
  expect(createAnalysis).toHaveBeenCalledTimes(2);
  expect(location.hash).toBe("#/run/retry-success");
});
