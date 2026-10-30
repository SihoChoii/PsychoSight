import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import reportSource from "../../docs/sample_report_deterministic_only.json";
import configSource from "./fixtures/mock-config.json";
import { ApiError } from "./api";
import { App } from "./App";
import type { Client } from "./api";
import type { Config, Report, SavedAnalysis } from "./types";
import { ReportScreen } from "./components/ReportScreen";
import { SavedReports } from "./components/SavedReports";

const mocks = vi.hoisted(() => ({ client: {} as Client }));
vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), getClient: () => Promise.resolve(mocks.client) }));
const report = reportSource as unknown as Report;
const config = configSource as unknown as Config;
const saved: SavedAnalysis[] = [{ job_id: "report/id", conversation_id: "demo", conversation_label: "Synthetic conversation", mode: "deterministic_only", created_at: "2026-10-29T12:00:00Z" }];
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
const catalog = (blocked = false) => ({ body: { conversations: [{ id: "demo", label: "Synthetic demo", supported: true, is_demo: true }], chat_db: { available: !blocked, error: blocked ? { message: "Cannot read Messages." } : null } }, totalHeader: null });
beforeEach(() => {
  sessionStorage.clear(); window.location.hash = "#/";
  mocks.client = { getConfig: vi.fn().mockResolvedValue(config), listAnalyses: vi.fn().mockResolvedValue([]), getConversations: vi.fn().mockResolvedValue(catalog()), getReport: vi.fn().mockResolvedValue(report), deleteAnalysis: vi.fn().mockResolvedValue({ deleted: true, job_id: "one" }) } as unknown as Client;
});

describe("report retrieval and deletion recovery", () => {
  it("focuses the asynchronous ready heading once and leaves chart and theme interactions alone", async () => {
    const pending = deferred<Report>(); vi.mocked(mocks.client.getReport).mockReturnValue(pending.promise);
    const view = render(<ReportScreen jobId="one" trendNote={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the report.");
    screen.getByRole("link", { name: "Conversations" }).focus();
    await act(async () => pending.resolve(report));
    expect(document.getElementById("page-title")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Weekly totals" }));
    const next = screen.getByRole("button", { name: "Next week" }); next.focus(); fireEvent.click(next);
    expect(next).toHaveFocus();
    view.rerender(<ReportScreen jobId="one" trendNote="Configuration arrived." />);
    expect(next).toHaveFocus();
    expect(mocks.client.getReport).toHaveBeenCalledExactlyOnceWith("one");
  });
  it("retries a failed GET and ignores a previous route's late response", async () => {
    const pending = deferred<Report>(); vi.mocked(mocks.client.getReport).mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", "Connection lost.", 0)).mockResolvedValue(report);
    const view = render(<ReportScreen key="one" jobId="one" trendNote={null} />);
    view.rerender(<ReportScreen key="two" jobId="two" trendNote={null} />);
    await screen.findByRole("heading", { name: "Report unavailable" });
    await act(async () => pending.resolve(report));
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(document.getElementById("page-title")).toHaveTextContent(report.header.conversation_label));
    expect(document.getElementById("page-title")).toHaveFocus();
    expect(mocks.client.getReport).toHaveBeenLastCalledWith("two");
  });
  it.each([["NOT_FOUND",404,"Report not found"],["REPORT_NOT_READY",409,"Report not ready"]])("handles %s with a route-safe recovery action", async (code,status,title) => {
    vi.mocked(mocks.client.getReport).mockRejectedValue(new ApiError(code,"Supplied failure.",status));
    render(<ReportScreen jobId="encoded/id" trendNote={null} />);
    expect(await screen.findByRole("heading", { name: title })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Conversations" })).toHaveAttribute("href","#/");
    if(code==="REPORT_NOT_READY") expect(screen.getByRole("link",{name:"View progress"})).toHaveAttribute("href","#/run/encoded%2Fid");
  });
  it("keeps an open failed deletion usable without moving focus away", async () => {
    const pending = deferred<{deleted:boolean;job_id:string}>();
    vi.mocked(mocks.client.deleteAnalysis).mockReturnValue(pending.promise);
    render(<ReportScreen jobId="one" trendNote={null} />);
    fireEvent.click(await screen.findByRole("button",{name:"Delete report"}));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Delete report"}));
    await act(async () => pending.reject(new Error("Synthetic storage failure.")));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Synthetic storage failure.");
    expect(within(dialog).getByRole("button",{name:"Cancel"})).toHaveFocus();
    expect(within(dialog).getByRole("button",{name:"Try again"})).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button",{name:"Cancel"}));
    expect(screen.getByRole("alert")).toHaveTextContent("Synthetic storage failure.");
  });
  it("finishes a pending request after leaving without redirecting another page or clearing a different job", async () => {
    const pending = deferred<{deleted:boolean;job_id:string}>();
    vi.mocked(mocks.client.deleteAnalysis).mockReturnValue(pending.promise);
    sessionStorage.setItem("psychosight-active-job","different-job");
    const view = render(<ReportScreen jobId="one" trendNote={null} />);
    fireEvent.click(await screen.findByRole("button",{name:"Delete report"}));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Delete report"}));
    await waitFor(() => expect(mocks.client.deleteAnalysis).toHaveBeenCalledOnce());
    view.unmount(); window.location.hash="#/optin";
    await act(async () => pending.resolve({deleted:true,job_id:"one"}));
    expect(window.location.hash).toBe("#/optin");
    expect(sessionStorage.getItem("psychosight-active-job")).toBe("different-job");
  });
  it("retains pending deletion after dismissal, suppresses duplicate requests, shows failure and recovers", async () => {
    const first = deferred<{deleted:boolean;job_id:string}>(); vi.mocked(mocks.client.deleteAnalysis).mockReturnValueOnce(first.promise).mockResolvedValue({deleted:true,job_id:"one"});
    sessionStorage.setItem("psychosight-active-job","one");
    render(<ReportScreen jobId="one" trendNote={null} />);
    const trigger = await screen.findByRole("button",{name:"Delete report"}); trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button",{name:"Delete report"});
    act(() => { confirm.click(); confirm.click(); });
    await waitFor(() => expect(mocks.client.deleteAnalysis).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole("button",{name:"Deleting report"})).toBeDisabled();
    expect(within(dialog).getByRole("button",{name:"Close"})).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button",{name:"Close"}));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
    expect(screen.getByText("Deleting report. The request is still running.")).toHaveAttribute("role", "status");
    await act(async () => first.reject(new Error("Disk is busy.")));
    expect(screen.getByRole("alert")).toHaveTextContent("Disk is busy.");
    fireEvent.click(trigger);
    const reopened = screen.getByRole("dialog"); expect(within(reopened).getByRole("alert")).toHaveTextContent("Disk is busy.");
    fireEvent.click(within(reopened).getByRole("button",{name:"Try again"}));
    await waitFor(() => expect(window.location.hash).toBe("#/"));
    expect(mocks.client.deleteAnalysis).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem("psychosight-flash")).toBe("Report deleted.");
    expect(sessionStorage.getItem("psychosight-active-job")).toBeNull();
  });
});

describe("supporting app recovery", () => {
  it("keeps the picker available when saved reports fail and retries only the list", async () => {
    vi.mocked(mocks.client.listAnalyses).mockRejectedValueOnce(new Error("Saved list unavailable.")).mockResolvedValue(saved);
    render(<App />);
    expect(await screen.findByRole("button",{name:"Retry saved reports"})).toBeEnabled();
    expect(await screen.findByRole("radio",{name:/Synthetic demo/})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Retry saved reports"}));
    expect(await screen.findByRole("link",{name:/Synthetic conversation/})).toHaveAttribute("href","#/report/report%2Fid");
    expect(mocks.client.getConfig).toHaveBeenCalledTimes(1); expect(mocks.client.getConversations).toHaveBeenCalledTimes(1);
  });
  it("distinguishes saved loading, retained rows, empty and failures", () => {
    const retry = vi.fn(); const v = render(<SavedReports saved={[]} savedLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading saved reports.");
    v.rerender(<SavedReports saved={[]} />); expect(screen.getByText("No saved reports yet.")).toBeInTheDocument();
    v.rerender(<SavedReports saved={saved} savedError="Unavailable." onRetrySaved={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Showing the last loaded saved reports.");
    fireEvent.click(screen.getByRole("button",{name:"Retry saved reports"}));expect(retry).toHaveBeenCalledOnce();
  });
  it("recovers configuration without discarding the selected conversation", async () => {
    window.location.hash = "#/optin";
    sessionStorage.setItem("psychosight-selection",JSON.stringify({conversationId:"demo",label:"Synthetic demo",isDemo:true,dateFrom:"",dateTo:""}));
    vi.mocked(mocks.client.getConfig).mockRejectedValueOnce(new Error("Config unavailable.")).mockResolvedValue(config);
    render(<App />);
    expect(await screen.findByRole("button",{name:"Retry disclosure"})).toBeEnabled();
    expect(screen.getByRole("button",{name:"Send excerpts and analyze"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Deterministic only, no LLM"})).toBeEnabled();
    fireEvent.click(screen.getByRole("button",{name:"Retry disclosure"}));
    await waitFor(() => expect(screen.getByRole("checkbox",{name:"Enable AI analysis"})).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox",{name:"Enable AI analysis"}));
    expect(screen.getByRole("button",{name:"Send excerpts and analyze"})).toBeEnabled();
    expect(screen.getByTestId("opt-in-text")).toHaveTextContent(config.opt_in_text);expect(screen.getByText("Synthetic demo")).toBeInTheDocument();
  });
  it("preserves native access callbacks and refreshes catalog after a granted recheck", async () => {
    vi.mocked(mocks.client.getConversations).mockResolvedValueOnce(catalog(true)).mockResolvedValue(catalog());
    mocks.client.openDiskAccessSettings=vi.fn().mockResolvedValue({opened:true,url:"settings"});
    mocks.client.revealDiskAccessApp=vi.fn().mockResolvedValue({revealed:true});
    mocks.client.recheckDiskAccess=vi.fn().mockResolvedValue({granted:true,message:"Granted."});
    render(<App />);
    fireEvent.click(await screen.findByRole("button",{name:"Open Full Disk Access Settings"}));
    await screen.findByText(/System Settings should be open/);expect(mocks.client.openDiskAccessSettings).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button",{name:"Show in Finder"}));
    await screen.findByText(/PsychoSight is selected in Finder/);expect(mocks.client.revealDiskAccessApp).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button",{name:"Recheck"}));
    expect(await screen.findByRole("radio",{name:/Synthetic demo/})).toBeInTheDocument();
    expect(mocks.client.recheckDiskAccess).toHaveBeenCalledOnce();expect(mocks.client.getConversations).toHaveBeenCalledTimes(2);
  });
});
