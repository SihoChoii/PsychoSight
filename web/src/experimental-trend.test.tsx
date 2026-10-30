import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrendComparison } from "./components/experimental/TrendComparison";
import { realLikeSection } from "./fixtures/experimental-samples";
import type { ExpTrendPoint } from "./types";

const point = (week: string, score: number | null): ExpTrendPoint => ({
  week, score, n_episodes: 6, n_words: 480, reason: score === null ? "Too little data this week" : null,
});

describe("overlaid experimental trends", () => {
  it("aligns both speakers on a shared domain and calendar across a year boundary", () => {
    const dim = structuredClone(realLikeSection.dimensions[0]);
    dim.per_speaker.me.trend = [point("2026-W04", 0), point("2026-W02", 50), point("2026-W01", null), point("2025-W52", 20)];
    dim.per_speaker.other!.trend = [point("2025-W52", 80), point("2026-W02", 50), point("2026-W03", 100), point("2026-W04", null)];
    const { container } = render(<TrendComparison dim={dim} active />);
    const chart = screen.getByRole("img", { name: /Weekly trend comparison/ });
    expect(chart).toHaveAttribute("data-ymin", "0");
    expect(chart).toHaveAttribute("data-ymax", "100");
    const me = chart.querySelector('[data-speaker="me"]')!;
    const other = chart.querySelector('[data-speaker="other"]')!;
    const circle = me.querySelector('[data-week="2026-W02"] circle')!;
    const square = other.querySelector('[data-week="2026-W02"] rect')!;
    // W02 is two weeks after W52 and two before W04, rather than an array index.
    expect(Number(circle.getAttribute("cx"))).toBe(240);
    expect(Number(square.getAttribute("x")) + 3).toBe(240);
    expect(Number(square.getAttribute("y")) + 3).toBe(Number(circle.getAttribute("cy")));
    expect(me.querySelector("path")).toHaveClass("series-me");
    expect(other.querySelector("path")).toHaveClass("series-other");
    expect(square).toHaveClass("series-other-mark");
    expect(me.querySelectorAll("circle")).toHaveLength(3);
    expect(other.querySelectorAll("rect")).toHaveLength(3);
    // Neither explicit nulls nor absent weeks may be connected as measured data.
    expect(me.querySelector("path")?.getAttribute("d")?.match(/M/g)).toHaveLength(3);
    expect(other.querySelector("path")?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'View trend data' }));
    const table = screen.getByRole("table", { name: "Weekly trend values" });
    const missing = within(table).getByRole("row", { name: /2026-W01/ });
    expect(missing).toHaveTextContent("Too little data this week");
    expect(missing).toHaveTextContent("No data supplied for this week");
    expect(container).not.toHaveTextContent("not directly comparable");
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("keeps a single measured zero centered and omits an unscored other person", () => {
    const dim = structuredClone(realLikeSection.dimensions[0]);
    dim.per_speaker.me.trend = [point("2026-W01", 0)];
    dim.per_speaker.other = null;
    const { container } = render(<TrendComparison dim={dim} active />);
    const chart = screen.getByRole("img");
    expect(chart).toHaveAttribute("data-ymin", "0");
    expect(chart).toHaveAttribute("data-ymax", "0");
    expect(chart.querySelector("circle")).toHaveAttribute("cx", "240");
    expect(chart.querySelector("circle")).toHaveAttribute("cy", "80");
    expect(container.querySelector('[data-speaker="other"]')).toBeNull();
    expect(screen.queryByText(/Other person/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View trend data' }));
    expect(screen.getByRole("cell", { name: /^0 / })).toBeInTheDocument();
  });

  it("keeps no-data reasons without fabricating a zero-valued comparison", () => {
    const dim = structuredClone(realLikeSection.dimensions[0]);
    dim.per_speaker.me.trend = [point("2026-W01", null)];
    dim.per_speaker.other!.trend = [point("2026-W01", null)];
    render(<TrendComparison dim={dim} active />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("No weekly trend.")).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View trend data' }));
    expect(screen.getAllByRole("cell", { name: /^Too little data this week/ })).toHaveLength(2);
    expect(screen.queryByRole("cell", { name: "0" })).not.toBeInTheDocument();
  });
});
