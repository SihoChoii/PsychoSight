import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import fullReport from "../../docs/sample_report.json";
import deterministicReport from "../../docs/sample_report_deterministic_only.json";
import { ReportView } from "./components/ReportView";
import type { Report } from "./types";

const full = fullReport as unknown as Report;
const deterministic = deterministicReport as unknown as Report;

/** The rich demo fixture has no thin week and no unstable rubric item. Inject those states. */
function withThinWeek(report: Report): Report {
  const next = structuredClone(report);
  const initiation = next.series.find((series) => series.key === "initiation_pct");
  const point = initiation?.points.find((item) => item.week === "2025-W41");
  if (!initiation || !point) throw new Error("sample report is missing the 2025-W41 initiation row");
  point.me = { value: null, count: point.me.count, reason: "insufficient data" };
  point.other = { value: null, count: point.other.count, reason: "insufficient data" };
  const unstable = next.rubric.items[0];
  unstable.status = "unstable";
  unstable.mean = null;
  return next;
}

function renderReport(report: Report, onDelete = vi.fn()) {
  render(<ReportView report={report} deleting={false} deleteError={null} onDelete={onDelete} />);
  return onDelete;
}

describe("report rendering", () => {
  it("shows Insufficient data for null weeks and keeps a real zero", () => {
    renderReport(withThinWeek(full));
    const summary = screen.getByText(": Episodes opened", { exact: true }).closest("summary");
    if (!summary) throw new Error("Missing Episodes opened data disclosure");
    fireEvent.click(summary);
    const table = screen.getByRole("table", { name: "Episodes opened" });
    const row = within(table).getByRole("row", { name: /2025-W41/ });
    expect(within(row).getAllByText("Insufficient data").length).toBeGreaterThan(0);
    expect(within(row).queryByText("0")).not.toBeInTheDocument();
    expect(screen.getAllByText(/0 episodes/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: full.limitations_title })).toBeInTheDocument();
    expect(screen.getByText(full.disclaimer)).toBeInTheDocument();
    expect(screen.getAllByText("Confidence: high").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Confidence: medium").length).toBeGreaterThan(0);
    expect(screen.getByText("Not stable enough to report")).toBeInTheDocument();
    expect(screen.getByText(/Median reply time, approximate/)).toBeInTheDocument();
  });

  it("renders not_run LLM sections as a skipped result", () => {
    renderReport(deterministic);
    const reason = deterministic.rubric.reason ?? "";
    expect(reason.length).toBeGreaterThan(0);
    expect(screen.getAllByText(reason).length).toBe(2);
    expect(screen.getAllByText(reason)[0]).toHaveAttribute("data-status", "not_run");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryAllByText(/Confidence:/)).toHaveLength(0);
    expect(screen.getByText(deterministic.disclaimer)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: deterministic.limitations_title })).toBeInTheDocument();
  });

  it("asks before deleting a report", () => {
    const onDelete = renderReport(deterministic);
    fireEvent.click(screen.getByRole("button", { name: "Delete report" }));
    const dialog = screen.getByRole("dialog", { name: "Delete report" });
    expect(within(dialog).getByText(/evidence quotes/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete report" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete report" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
