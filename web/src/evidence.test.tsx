import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import fullSample from "../../docs/sample_report.json";
import experimentalSample from "../../docs/sample_report_experimental.json";
import { ScoredPatterns } from "./components/report/ScoredPatterns";
import { Observations } from "./components/report/Observations";
import { ReportView } from "./components/ReportView";
import { reportReferenceId } from "./components/report/references";
import { uiPreviewReport } from "./fixtures/ui-previews";
import type { Report, RubricItem } from "./types";

const sample = fullSample as Report;
const reference = (id: string) => <span>{id}</span>;
const quoteMap = () => new Map(sample.quotes.map((quote) => [quote.quote_id, quote]));
function patterns(items: RubricItem[], status = "ok", reason: string | null = null) {
  return render(<ScoredPatterns rubric={{ ...sample.rubric, items, status, reason }} quotes={quoteMap()} episodeReference={reference} />);
}
function report(data: Report) {
  return render(<ReportView report={data} deleting={false} deleteError={null} onDelete={vi.fn()} />);
}
const pattern = () => screen.getByRole("region", { name: "Scored patterns" });
const observations = () => screen.getByRole("region", { name: "Observations" });

describe("scored pattern evidence", () => {
  it("keeps exact mean and true agreeing-episode counts beside scope, descriptions and per-item anchors", () => {
    const item = { ...sample.rubric.items[0], mean: 4.123456789, n_scored: 7, n_null: 3, n_unstable_pairs: 2 };
    const { container } = patterns([item]);
    expect(screen.getByText("4.123456789")).toBeInTheDocument();
    expect(screen.queryByText("4.12")).not.toBeInTheDocument();
    expect(screen.getByText("7 agreeing episodes")).toBeInTheDocument();
    expect(screen.getByText("3 episodes with a null rating · 2 unstable pairs")).toBeInTheDocument();
    expect(screen.getByText("Messages scored: Me")).toBeInTheDocument();
    expect(screen.getByText(item.description)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /mean 4.123456789.*7 agreeing episodes/ })).toHaveAccessibleDescription(item.description);
    expect(container.querySelector<HTMLElement>(".anchor-marker")?.style.left).toBe(`${(4.123456789 - 1) * 25}%`);
    const anchors = screen.getByText("Anchors").closest("details");
    expect(anchors).not.toHaveAttribute("open");
    for (const anchor of Object.values(item.anchors)) expect(anchors).toHaveTextContent(anchor);
    expect(screen.getByText("3 supplied quotes")).toBeInTheDocument();
    const more = screen.getByText("View 2 more quotes").closest("details");
    expect(more).not.toHaveAttribute("open");
    for (const id of item.quote_ids) expect(container.querySelector(`[data-quote-id="${id}"] .evidence-quote-text`)?.textContent).toBe(quoteMap().get(id)?.text);
  });

  it.each([
    ["unstable", 3.2, "Not stable enough to report"], ["insufficient_data", null, "Insufficient data"],
    ["not_run", 4, "Not run"], ["failed", 4, "Failed"], ["ok", null, "Insufficient data"],
    ["ok", Number.NaN, "Score unavailable"], ["ok", 0, "Score unavailable"], ["ok", 6, "Score unavailable"],
    ["future_status", 4, "future_status"],
  ] as const)("does not plot unavailable %s / %s", (status, mean, label) => {
    const { container } = patterns([{ ...sample.rubric.items[0], status, mean, reason: "Supplied state explanation" }]);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Supplied state explanation")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector(".anchor-marker")).toBeNull();
    expect(screen.getByText(`${sample.rubric.items[0].n_scored} agreeing episodes`)).toBeInTheDocument();
  });

  it.each([1, 5])("retains the exact %s endpoint and Other speaker cue without rescaling", (mean) => {
    const { container } = patterns([{ ...sample.rubric.items[0], mean, speaker: "other" }]);
    expect(container.querySelector<HTMLElement>(".anchor-marker-other")?.style.left).toBe(`${(mean - 1) * 25}%`);
    expect(screen.getByText("Messages scored: Other person")).toBeInTheDocument();
  });

  it.each(["not_run", "failed", "insufficient_data", "unstable"])("keeps section %s and supplied explanation without showing stale scores", (status) => {
    const { container } = patterns(sample.rubric.items, status, "Supplied section reason");
    expect(pattern()).toHaveAttribute("data-status", status);
    expect(screen.getByText("Supplied section reason")).toHaveAttribute("data-status", status);
    expect(container.querySelectorAll(".pattern-row")).toHaveLength(0);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("resolves rubric IDs only against top-level report quotes and exposes missing IDs", () => {
    const data = structuredClone(experimentalSample) as unknown as Report;
    const exp = data.experimental_scores?.quotes[0];
    if (!exp) throw new Error("Missing experimental sample evidence");
    data.rubric.items[0].quote_ids = [data.quotes[0].quote_id, exp.id, "absent"];
    const { container } = report(data);
    const row = container.querySelector(".pattern-row");
    expect(row).toHaveTextContent(data.quotes[0].text);
    expect(row).toHaveTextContent(`Quote evidence unavailable: ${exp.id}, absent`);
    expect(row?.querySelector(`[data-quote-id="${exp.id}"]`)).toBeNull();
  });
});

describe("observation evidence and reference navigation", () => {
  it("preserves each supplied claim/confidence/true support count, embedded quote source, exact whitespace and timestamp", () => {
    const data = structuredClone(sample);
    const item = data.observations.items[0];
    item.supporting_episodes = 191; item.episode_ids = [item.episode_ids[0]];
    item.quotes[0].text = "  A verbatim line.\nSecond line — punctuation & spacing.  ";
    item.quotes[0].timestamp = "2025-08-08T23:27:04-07:00";
    const { container } = render(<Observations observations={data.observations} rubric={data.rubric} features={data.series} episodeReference={reference} />);
    const row = container.querySelector(".observation-row");
    expect(row).toHaveTextContent(item.text);
    expect(within(observations()).getAllByText("Confidence: high").length).toBeGreaterThan(0);
    expect(row).toHaveTextContent("191 supporting episodes");
    expect(row).toHaveTextContent("3 supplied quotes");
    expect(row?.querySelector(".evidence-quote-text")?.textContent).toBe(item.quotes[0].text);
    expect(row?.querySelector("time")?.getAttribute("datetime")).toBe(item.quotes[0].timestamp);
    expect(row?.querySelector("time")?.textContent).toBe(item.quotes[0].timestamp);
  });

  it("navigates actual item/feature IDs with focus while preserving the route and selection", () => {
    const data = structuredClone(sample); report(data);
    window.location.hash = "#/report/evidence-test";
    const item = data.rubric.items[0], feature = data.series.find((x) => x.key === data.observations.items[0].feature_keys[0]);
    if (!feature) throw new Error("Missing referenced feature");
    fireEvent.click(within(observations()).getByRole("button", { name: `View ${item.label}` }));
    expect(document.getElementById(reportReferenceId("item", item.key))).toHaveFocus();
    fireEvent.click(within(observations()).getByRole("button", { name: `View ${feature.label}` }));
    expect(document.getElementById(reportReferenceId("feature", feature.key))).toHaveFocus();
    expect(window.location.hash).toBe("#/report/evidence-test");
  });

  it("degrades absent item/feature/episode IDs and quote evidence without a fabricated link", () => {
    const data = structuredClone(sample);
    data.rubric.status = "not_run";
    data.observations.items = [{ ...data.observations.items[0], feature_keys: ["absent-feature"], item_keys: [data.rubric.items[0].key, "absent-item"], episode_ids: ["absent-episode"], quotes: [] }];
    report(data);
    expect(observations()).toHaveTextContent("absent-feature · Feature unavailable");
    expect(observations()).toHaveTextContent("absent-item · Pattern unavailable");
    expect(observations()).toHaveTextContent(`${data.rubric.items[0].key} · Pattern unavailable`);
    expect(observations()).toHaveTextContent("absent-episode · Episode detail unavailable");
    expect(observations()).toHaveTextContent("0 supplied quotes");
    expect(observations()).toHaveTextContent("No quote evidence supplied.");
    expect(within(observations()).queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps failed/skipped/empty observations, full visible limitations/disclaimer, note and secondary controls", () => {
    const data = structuredClone(sample); data.observations = { status: "failed", reason: "Supplied failure", note: "Supplied synthesis note", items: [] };
    report(data);
    expect(within(observations()).getByRole("alert")).toHaveTextContent("Supplied failure");
    expect(observations()).toHaveTextContent("Supplied synthesis note");
    for (const text of data.limitations) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByText(data.disclaimer)).toBeVisible();
    expect(screen.getByText("Details", { exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete report" })).toBeVisible();
  });

  it.each(["not_run", "insufficient_data"])("preserves observation %s without stale claims or evidence", (status) => {
    const data = structuredClone(sample);
    data.observations.status = status;
    data.observations.reason = "Supplied observation status reason";
    report(data);
    expect(observations()).toHaveAttribute("data-status", status);
    expect(observations()).toHaveTextContent("Supplied observation status reason");
    expect(within(observations()).queryByText(data.observations.items[0].text)).not.toBeInTheDocument();
    expect(observations().querySelector(".evidence-quote")).toBeNull();
  });

  it("preserves low confidence and zero support without deriving either from quote or reference counts", () => {
    const data = structuredClone(sample);
    data.observations.items = [{ ...data.observations.items[0], confidence: "low", supporting_episodes: 0, episode_ids: [], quotes: [] }];
    report(data);
    expect(observations()).toHaveTextContent("Confidence: low");
    expect(observations()).toHaveTextContent("0 supporting episodes");
    expect(observations()).toHaveTextContent("0 supplied quotes");
  });

  it("keeps an empty successful observation section explicit", () => {
    const data = structuredClone(sample); data.observations.items = [];
    report(data);
    expect(within(observations()).getByText("Insufficient data")).toBeInTheDocument();
    expect(observations().querySelector(".observation-row")).toBeNull();
  });

  it("does not substitute an experimental quote with a colliding top-level ID", () => {
    const data = structuredClone(experimentalSample) as unknown as Report;
    if (!data.experimental_scores) throw new Error("Missing experimental sample");
    data.experimental_scores.quotes[0] = { ...data.experimental_scores.quotes[0], id: data.quotes[0].quote_id, text: "EXPERIMENTAL COLLISION: never show in main evidence" };
    const { container } = report(data);
    const row = container.querySelector(".pattern-row");
    expect(row?.querySelector(".evidence-quote-text")?.textContent).toBe(data.quotes[0].text);
    expect(row).not.toHaveTextContent("EXPERIMENTAL COLLISION");
  });

  it("does not mutate report inputs on display or evidence navigation", () => {
    const data = structuredClone(sample), before = structuredClone(data); report(data);
    fireEvent.click(within(observations()).getAllByRole("button", { name: /^View episode/ })[0]);
    expect(data).toEqual(before);
  });

  it.each(["evidence-states", "evidence-long", "evidence-failed"])("provides reproducible synthetic %s routes without modifying canonical data", (name) => {
    const before = structuredClone(fullSample), data = uiPreviewReport(`ui-${name}`);
    expect(data?.report_id).toBe(`ui-${name}`);
    expect(data?.header.is_demo).toBe(true);
    expect(fullSample).toEqual(before);
  });
});
