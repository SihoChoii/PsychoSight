import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMemo, useState } from "react";
import { TimelineChart as ControlledTimelineChart } from "./components/TimelineChart";
import type { FeatureChartModel } from "./charts/models";
import { nextWeekKey } from "./charts/inspection";

// Exercise the stateless panel with a test owner, like ReportView's shared selection.
function TimelineChart({ model }: { model: FeatureChartModel }) {
  const [pinned, setPinned] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const weeks = useMemo(() => model.rows.map((row) => row.week), [model]);
  const index = useMemo(() => new Map(weeks.map((week, i) => [week.key, i])), [weeks]);
  const selectedKey = preview ?? pinned;
  return <><ControlledTimelineChart model={model} inspection={{ selectedKey, pinnedKey: pinned,
    preview: setPreview, pin: (key) => { setPreview(null); setPinned(key); },
    keyDown: (event) => {
      const next = nextWeekKey(weeks, index, selectedKey, event.key);
      if (next !== undefined) { event.preventDefault(); setPreview(null); setPinned(next); }
    },
  }} /><button onClick={() => { setPinned(null); setPreview(null); }}>Clear week</button></>;
}
import { buildReportCharts } from "./charts/models";
import type { Feature } from "./types";

function data(values: (number | null)[]): Feature {
  return { key: "initiation_pct", label: "Episodes opened", unit: "% of episodes", count_unit: "episodes",
    description: "Share of episodes this speaker opened.", approximate: false, min_count: 3,
    overall: { me: { value: 50, count: 12 }, other: { value: 50, count: 12 } },
    points: values.map((value, i) => ({ week: `2025-W${32 + i}`, me: { value, count: i + 1, ...(value === null ? { reason: "insufficient data" as const } : {}) }, other: { value: 0, count: 3 } })),
  };
}
const model = (feature: Feature) => buildReportCharts({ weeks: [], series: [feature] }).features[0];
const table = () => { fireEvent.click(screen.getByText("View data", { exact: false, selector: "summary" })); return screen.getByRole("table", { name: "Episodes opened" }); };

describe("integrated timeline chart", () => {
  it("draws fixed participation axes, explicit units, separated paths and exact data", () => {
    const { container } = render(<TimelineChart model={model(data([10, null, 85.7]))} />);
    expect(screen.getByText("Scale: 0%–100% · % of episodes · full-report scale")).toBeInTheDocument();
    expect(container.querySelector("path.series-me")?.getAttribute("d")).toBe("M56.00 174.00 M708.00 37.74");
    const t = table();
    const thin = within(t).getByRole("row", { name: /2025-W33/ });
    expect(within(thin).getByText("Insufficient data")).toBeInTheDocument();
    expect(within(thin).getByText("2 episodes opened by this speaker")).toBeInTheDocument();
    expect(within(thin).getByText("Reason: insufficient data")).toBeInTheDocument();
    expect(within(t).getByText("85.7% of episodes")).toBeInTheDocument();
  });

  it("keeps a single zero point visible and exposes a keyboard-pinned readout", () => {
    const { container } = render(<TimelineChart model={model(data([0]))} />);
    const image = screen.getByRole("img");
    expect(container.querySelector("circle.series-me")).toHaveAttribute("cx", "382");
    expect(container.querySelector("circle.series-me")).toHaveAttribute("cy", "192");
    fireEvent.keyDown(image, { key: "Home" });
    expect(screen.getByText(/2025-W32.*Pinned/)).toBeInTheDocument();
    expect(screen.getAllByText("0% of episodes").length).toBeGreaterThan(0);
    expect(screen.getByText("1 episode opened by this speaker")).toBeInTheDocument();
    fireEvent.keyDown(image, { key: "Escape" });
    expect(screen.queryByText(/Pinned/)).not.toBeInTheDocument();
  });

  it("uses the shared geometry for click and keyboard inspection without changing paths or scales", () => {
    const { container } = render(<TimelineChart model={model(data([10, 30, 70]))} />);
    const image = screen.getByRole("img");
    image.getBoundingClientRect = () => ({ left: 0, top: 0, right: 720, bottom: 240, width: 720, height: 240, x: 0, y: 0, toJSON() {} });
    const before = container.querySelector("path.series-me")?.getAttribute("d");
    fireEvent.click(image, { clientX: 378 });
    expect(screen.getByText(/2025-W33.*Pinned/)).toBeInTheDocument();
    expect(container.querySelector(".chart-selection line")).toHaveAttribute("x1", "382");
    fireEvent.keyDown(image, { key: "End" });
    expect(screen.getByText(/2025-W34.*Pinned/)).toBeInTheDocument();
    fireEvent.keyDown(image, { key: "ArrowLeft" });
    expect(screen.getByText(/2025-W33.*Pinned/)).toBeInTheDocument();
    expect(container.querySelector("path.series-me")?.getAttribute("d")).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Clear week" }));
    expect(screen.queryByText(/Pinned/)).not.toBeInTheDocument();
  });

  it("does not scan or rebuild observation rows during inspection", () => {
    const chart = model(data([10, 30, 70]));
    const map = vi.spyOn(chart.rows, "map"), find = vi.spyOn(chart.rows, "find");
    render(<TimelineChart model={chart} />);
    map.mockClear(); find.mockClear();
    const image = screen.getByRole("img");
    fireEvent.keyDown(image, { key: "End" });
    fireEvent.keyDown(image, { key: "ArrowLeft" });
    fireEvent.keyDown(image, { key: "Home" });
    expect(map).not.toHaveBeenCalled(); expect(find).not.toHaveBeenCalled();
    map.mockRestore(); find.mockRestore();
  });

  it("keeps the full-report domain when only a display window is rendered", () => {
    const chart = model(data([10, 30, 70]));
    const { rerender } = render(<TimelineChart model={chart} />);
    expect(screen.getByText("Scale: 0%–100% · % of episodes · full-report scale")).toBeInTheDocument();
    rerender(<TimelineChart model={{ ...chart, rows: chart.rows.slice(0, 1) }} />);
    expect(screen.getByText("Scale: 0%–100% · % of episodes · full-report scale")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("img"), { key: "Home" });
    expect(screen.getByText(/2025-W32.*Pinned/)).toBeInTheDocument();
  });

  it("shows all-null empty state and counts/reasons in the visible data disclosure", () => {
    const feature = data([null]); feature.points[0].other = { value: null, count: 2, reason: "insufficient data" };
    render(<TimelineChart model={model(feature)} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Insufficient data. No weekly values available.")).toBeInTheDocument();
    expect(within(table()).getAllByText("Insufficient data")).toHaveLength(2);
    expect(screen.getByText("1 episode opened by this speaker")).toBeInTheDocument();
  });

  it("retains omitted intervals as unknown rows and dense isolated points as marks", () => {
    const feature = data(Array.from({ length: 40 }, () => null));
    feature.points = feature.points.filter((_, i) => i !== 1);
    feature.points.forEach((point, i) => { point.week = `2025-W${String(i + (i > 0 ? 2 : 1)).padStart(2, "0")}`; point.other.value = null; });
    feature.points[20].me.value = 10;
    const { container } = render(<TimelineChart model={model(feature)} />);
    expect(container.querySelectorAll("circle.series-me")).toHaveLength(1);
    const missing = within(table()).getByRole("row", { name: /2025-W02/ });
    expect(within(missing).getAllByText("No data supplied for this week; count unavailable.")).toHaveLength(2);
  });
});
