import { fireEvent, render as renderDOM, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportView } from "./components/ReportView";
import { uiPreviewReport } from "./fixtures/ui-previews";
import type { Report } from "./types";

function report(name: string) { return uiPreviewReport(`ui-${name}`)!; }
// These regression cases exercise the retained weekly tools, now disclosed below the timeline.
function render(ui: Parameters<typeof renderDOM>[0]) {
  const result = renderDOM(ui);
  const openTools = () => { const button = screen.queryByRole('button', { name: 'Weekly totals' }); if (button && button.getAttribute('aria-expanded') === 'false') fireEvent.click(button); };
  openTools();
  return { ...result, container: result.baseElement, rerender: (next: Parameters<typeof result.rerender>[0]) => { result.rerender(next); openTools(); } };
}

const props = (data: Report) => ({ report: data, deleting: false, deleteError: null, onDelete: vi.fn() });
const group = () => screen.getByRole("group", { name: "Week inspection" });
const activity = () => screen.getByRole("img", { name: "Weekly message activity" });
const panels = (container: HTMLElement) => [...container.querySelectorAll("figure[data-feature]")];
const axisLabels = (container: HTMLElement) => panels(container).map(panel => [...panel.querySelectorAll('.chart-tick')].map(el => el.textContent ?? '').filter(label => /^-?[\d.,]+(?:e[+-]?\d+)?%?$/i.test(label)));
const windowControl = () => screen.getByLabelText("Chart display window");

function plotBounds(svg: Element) {
  svg.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 720, bottom: 240, width: 720, height: 240, toJSON() {} });
}
function preview(svg: Element, x: number) {
  const event = new MouseEvent("pointermove", { bubbles: true, clientX: x });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  fireEvent(svg, event);
}

describe("coordinated report inspection", () => {
  it("shares click/preview/restore across activity and all nine panels without live pointer announcements", () => {
    const { container } = render(<ReportView {...props(report("omitted-weeks"))} />);
    const svg = activity(); plotBounds(svg);
    fireEvent.click(svg, { clientX: 60 });
    expect(group()).toHaveTextContent("2025-W32");
    for (const panel of panels(container)) expect(panel.querySelector(".chart-inspector")).toHaveTextContent("2025-W32");
    const announcement = screen.getByRole("status").textContent;
    preview(svg, 274); // third calendar week, omitted everywhere
    expect(group()).toHaveTextContent("2025-W34");
    expect(group()).toHaveTextContent("No activity data supplied");
    for (const panel of panels(container)) expect(panel.querySelector(".chart-inspector")).toHaveTextContent("No data supplied");
    expect(screen.getByRole("status").textContent).toBe(announcement);
    fireEvent.pointerLeave(svg);
    expect(group()).toHaveTextContent("2025-W32");
    expect(group()).toHaveTextContent("Pinned");
    const feature = panels(container)[1].querySelector('svg[role="img"]')!; plotBounds(feature);
    fireEvent.click(feature, { clientX: 708 });
    expect(group()).toHaveTextContent("2025-W38");
    expect(screen.getByRole("status")).toHaveTextContent("Pinned 2025-W38");
  });

  it("supports central previous/next, keyboard Home/End/arrows and clear without one tab stop per week", () => {
    const { container } = render(<ReportView {...props(report("omitted-weeks"))} />);
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(group()).toHaveTextContent("2025-W32");
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(group()).toHaveTextContent("2025-W33");
    fireEvent.keyDown(group(), { key: "End" });
    expect(group()).toHaveTextContent("2025-W38");
    fireEvent.keyDown(activity(), { key: "ArrowLeft" });
    expect(group()).toHaveTextContent("2025-W37");
    fireEvent.keyDown(group(), { key: "Home" });
    expect(group()).toHaveTextContent("2025-W32");
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(group()).toHaveTextContent("2025-W32");
    fireEvent.keyDown(group(), { key: "Escape" });
    expect(group()).toHaveTextContent("No week selected");
    expect(screen.getByRole("status")).toHaveTextContent("Week selection cleared");
    expect(container.querySelectorAll("svg [tabindex]")).toHaveLength(0);
  });

  it.each(["104-weeks", "260-weeks"])("windows %s while keeping full totals/domains/tables and clearing an outside pin", (name) => {
    const data = report(name), { container } = render(<ReportView {...props(data)} />);
    fireEvent.click(screen.getByRole('button',{name:'Report information'}));
    const totalsText = container.querySelector(".report-totals")!.textContent;
    const scales = axisLabels(container);
    fireEvent.keyDown(activity(), { key: "Home" });
    fireEvent.change(windowControl(), { target: { value: "52" } });
    expect(windowControl()).toHaveValue("52");
    expect(group()).toHaveTextContent("No week selected");
    expect(screen.getByRole("status")).toHaveTextContent("outside the display window");
    expect(container.querySelectorAll(".weekly-activity [data-week]")).toHaveLength(52);
    fireEvent.keyDown(activity(), { key: "End" });
    expect(group()).toHaveTextContent(data.weeks.at(-1)!.week);
    fireEvent.change(windowControl(), { target: { value: "13" } });
    expect(group()).toHaveTextContent(data.weeks.at(-1)!.week);
    expect(container.querySelectorAll(".weekly-activity [data-week]")).toHaveLength(13);
    expect(container.querySelector(".report-totals")!.textContent).toBe(totalsText);
    expect(axisLabels(container)).toEqual(scales);
    fireEvent.click(within(panels(container)[0] as HTMLElement).getByText("View data", { exact: false }));
    const table = within(screen.getByRole("dialog", { name: /full report data/ })).getByRole("table");
    const feature = data.series.find(feature => feature.key === (panels(container)[0] as HTMLElement).dataset.feature)!;
    const overall = document.querySelector('.chart-overall-data')!;
    expect(overall).toHaveTextContent(String(feature.overall.me.value));
    expect(overall).toHaveTextContent(String(feature.overall.other.value));
    expect(within(table).getAllByRole("row")).toHaveLength(data.weeks.length + 1);
    expect(table).toHaveTextContent(data.weeks[0].week);
    fireEvent.change(windowControl(), { target: { value: "all" } });
    expect(container.querySelectorAll(".weekly-activity [data-week]")).toHaveLength(data.weeks.length);
  });

  it("clears a missing pin after a same-ID immutable model refresh before switching windows", () => {
    const original = report("260-weeks");
    const { rerender } = render(<ReportView {...props(original)} />);
    fireEvent.keyDown(activity(), { key: "End" });
    expect(group()).toHaveTextContent("2030-W30");

    // A refreshed body retains the report identity but no longer contains the pinned week.
    const refreshed = { ...report("104-weeks"), report_id: original.report_id };
    rerender(<ReportView {...props(refreshed)} />);
    expect(group()).toHaveTextContent("No week selected");
    expect(screen.getByRole("button", { name: "Clear week" })).toBeEnabled();
    fireEvent.change(windowControl(), { target: { value: "13" } });
    expect(windowControl()).toHaveValue("13");
    expect(screen.getByRole("status")).toHaveTextContent("Week selection cleared because it is outside the display window.");
    expect(screen.getByRole("button", { name: "Clear week" })).toBeDisabled();

    // Returning to All must not restore the stale key; new inspection still works.
    fireEvent.change(windowControl(), { target: { value: "all" } });
    expect(group()).toHaveTextContent("No week selected");
    fireEvent.keyDown(activity(), { key: "End" });
    expect(group()).toHaveTextContent("2027-W30");
    expect(screen.getByRole("status")).toHaveTextContent("Pinned 2027-W30");
  });

  it("uses calendar span rather than the number of returned weeks for long-report controls", () => {
    const data = report("104-weeks"); data.weeks = [data.weeks[0], data.weeks[103]];
    data.series.forEach((feature) => { feature.points = [feature.points[0], feature.points[103]]; });
    render(<ReportView {...props(data)} />);
    expect(windowControl()).toBeInTheDocument();
    fireEvent.change(windowControl(), { target: { value: "13" } });
    fireEvent.keyDown(group(), { key: "Home" });
    expect(group()).toHaveTextContent("No activity data supplied");
  });

  it("retains zero/null/count reasons in local readouts and full data; keeps one week usable", () => {
    const data = report("single-week");
    const feature = data.series.find((feature) => feature.key === "absolutist_pct")!;
    feature.points[0].me = { value: null, count: 21, reason: "insufficient data" };
    feature.points[0].other = { value: 0, count: 300 };
    const { container } = render(<ReportView {...props(data)} />);
    expect(screen.queryByLabelText("Chart display window")).not.toBeInTheDocument();
    fireEvent.keyDown(group(), { key: "End" });
    const first = panels(container)[0] as HTMLElement;
    const readout = first.querySelector(".chart-inspector")!;
    expect(readout).toHaveTextContent("Insufficient data");
    expect(readout).toHaveTextContent("21 words");
    expect(readout).toHaveTextContent("Reason: insufficient data");
    expect(readout).toHaveTextContent("0% of words");
    fireEvent.click(within(first).getByText("View data", { exact: false }));
    expect(within(screen.getByRole("dialog", { name: /full report data/ })).getByRole("table")).toHaveTextContent("300 words");
  });

  it("shows supplied zero activity counts and omits absent word totals", () => {
    const data = report("single-week");
    data.weeks[0].messages = { me: 0, other: 0 };
    data.weeks[0].words = { me: 0, other: 0 };
    data.header.message_counts = { me: 0, other: 0 };
    delete data.header.word_counts;
    const { container } = render(<ReportView {...props(data)} />);
    fireEvent.click(screen.getByRole('button',{name:'Report information'}));
    expect(container.querySelector(".report-totals")).not.toHaveTextContent("Words");
    fireEvent.keyDown(activity(), { key: "Home" });
    expect(within(group()).getAllByText("0 messages · 0 words")).toHaveLength(2);
    expect(group()).not.toHaveTextContent("unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Show bars" }));
    expect(container.querySelectorAll(".activity-bar")).toHaveLength(2);
    for (const bar of container.querySelectorAll(".activity-bar")) expect(bar).toHaveAttribute("height", "0");
  });

  it("shows actual applied dates, mode, provider and range notes even outside demo context", () => {
    const data = report("provider-note"); data.header.is_demo = false;
    data.run_meta.date_range_clamped = { requested: { date_from: "2020-01-01", date_to: null }, applied: { date_from: "2025-08-04", date_to: "2026-02-01" }, bounds: { date_from: "2025-08-04", date_to: "2026-02-01" } };
    render(<ReportView {...props(data)} />);
    fireEvent.click(screen.getByRole('button',{name:'Report information'}));
    expect(screen.getByText(data.run_meta.provider_note!)).toBeInTheDocument();
    expect(screen.queryByText(/Demo data/)).not.toBeInTheDocument();
    expect(screen.getByText("Full analysis")).toBeInTheDocument();
    expect(screen.getByText(`Timezone: ${data.header.timezone}`)).toBeInTheDocument();
    expect(screen.getByTestId("date-range-clamp")).toHaveTextContent("Requested Jan 1, 2020 to open end. Applied Aug 4, 2025 to Feb 1, 2026.");
  });

  it("resets selection/window on report identity changes and handles no weekly data", () => {
    const { container, rerender } = render(<ReportView {...props(report("104-weeks"))} />);
    fireEvent.change(windowControl(), { target: { value: "13" } });
    fireEvent.keyDown(group(), { key: "End" });
    rerender(<ReportView {...props(report("260-weeks"))} />);
    expect(windowControl()).toHaveValue("all"); expect(group()).toHaveTextContent("No week selected");
    const empty = report("single-week"); empty.weeks = []; empty.series.forEach((feature) => { feature.points = []; });
    rerender(<ReportView {...props(empty)} />);
    expect(screen.getByText("No weekly activity data available.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
    expect(panels(container)).toHaveLength(9);
  });

  it("scrolls/focuses section headings without changing the report hash", () => {
    render(<ReportView {...props(report("single-week"))} />);
    const scroll = vi.fn(); const heading = screen.getByRole("heading", { name: "Observations" }); heading.scrollIntoView = scroll;
    const before = window.location.hash;
    fireEvent.click(screen.getByText("Explore report"));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Report sections" })).getByRole("button", { name: "Observations" }));
    expect(heading).toHaveFocus(); expect(scroll).toHaveBeenCalledOnce(); expect(window.location.hash).toBe(before);
  });
  it("reveals full metadata and totals without changing the current chart selection", async () => {
    const data = report("provider-note");
    const { container } = render(<ReportView {...props(data)} />);
    expect(container.querySelector(".report-information")).toBeNull();
    fireEvent.keyDown(activity(), { key: "Home" });
    const selection = group().textContent;
    fireEvent.click(screen.getByRole("button", { name: "Report information" }));
    const information = document.querySelector('.report-information');
    expect(information).toBeVisible();
    expect(information).toHaveTextContent(data.run_meta.provider_note!);
    expect(information).toHaveTextContent(`Me ${data.header.message_counts.me}`);
    expect(screen.getByRole("button", { name: "Report information" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Report information" }));
    await waitFor(() => expect(information).not.toBeInTheDocument()); expect(group().textContent).toBe(selection);
  });

  it("switches between lines and bars without filling missing weeks or changing pinned values", () => {
    const { container } = render(<ReportView {...props(report("omitted-weeks"))} />);
    const line = container.querySelector(".weekly-activity path.series-me");
    expect(line?.getAttribute("d")?.match(/M/g)).toHaveLength(3);
    expect(container.querySelectorAll(".activity-bar")).toHaveLength(0);
    fireEvent.keyDown(activity(), { key: "Home" });
    const selection = group().textContent;
    fireEvent.click(screen.getByRole("button", { name: "Show bars" }));
    expect(screen.getByRole("button", { name: "Show bars" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll(".activity-bar")).toHaveLength(8);
    expect(group().textContent).toBe(selection);
    fireEvent.click(screen.getByRole("button", { name: "Show lines" }));
    expect(container.querySelector(".weekly-activity path.series-me")).toHaveAttribute("d", line?.getAttribute("d"));
    expect(group().textContent).toBe(selection);
  });

  it("opens metric definitions and calculation basis alongside exact full-range data", () => {
    const data = report("single-week"); const { container } = render(<ReportView {...props(data)} />);
    const panel = panels(container)[0] as HTMLElement;
    const feature = data.series.find(feature => feature.key === panel.dataset.feature)!;
    expect(screen.queryByText(feature.description)).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button',{name:/About this metric/}));
    const about = screen.getByRole('dialog',{name:feature.label});
    expect(within(about).getByText(feature.description)).toBeVisible();
    expect(about).not.toHaveTextContent('Full report overall');
    expect(about).not.toHaveTextContent('Scale:');
    const weWords = container.querySelector('figure[data-feature="we_pct"]')!;
    expect(within(weWords as HTMLElement).queryByRole('button',{name:/About this metric/})).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button',{name:/View data/}));
    const dataDialog = screen.getByRole('dialog',{name:/full report data/});
    expect(within(dataDialog).getByRole('table')).toBeVisible();
    expect(dataDialog).toHaveTextContent('Full report overall');
    expect(dataDialog).toHaveTextContent('based on');
  });

  it("closes the report menu with Escape and returns focus to its trigger", () => {
    render(<ReportView {...props(report("single-week"))} />);
    const trigger = screen.getByText("Explore report"); fireEvent.click(trigger);
    const details = trigger.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    fireEvent.keyDown(details, { key: "Escape" });
    expect(details.open).toBe(false); expect(trigger).toHaveFocus();
  });

});
