import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportView } from "./components/ReportView";
import { uiPreviewReport } from "./fixtures/ui-previews";
import { episodeIntervals, indexEpisodes } from "./charts/episodes";
import type { Episode, Report } from "./types";
import full from "../../docs/sample_report.json";
import experimental from "../../docs/sample_report_experimental.json";

const props = (report: Report) => ({ report, deleting: false, deleteError: null, onDelete: vi.fn() });
const preview = (name = "single-week") => uiPreviewReport(`ui-${name}`)!;
const activity = () => screen.getByRole("img", { name: "Weekly message activity" });
const week = () => screen.getByRole("group", { name: "Week inspection" });
const disclosure = () => screen.getByRole("button", { name: "Episode detail" });
async function open() {
  fireEvent.click(screen.getByText("Episode detail", { exact: true }));
  await waitFor(() => expect(screen.getByLabelText("Inspect episode")).toBeInTheDocument());
}
function synthetic(): Report {
  const data = preview();
  const base = data.episodes![0];
  data.episodes = [
    { ...base, episode_id: "a", start: "2025-08-04T01:00:00-07:00", end: "2025-08-04T02:00:00-07:00", pooled: true, scored: true, selection: "random", late_night_start: true, messages: { me: 0, other: 5 }, words: { me: 0, other: 38 } },
    { ...base, episode_id: "b", start: "2025-08-04T08:30:00+00:00", end: "2025-08-04T09:30:00+00:00", initiator: "other", scored: true, selection: "top_signal" },
    { ...base, episode_id: "c", start: "2025-08-04T09:00:00Z", end: "2025-08-04T09:00:00Z" },
  ];
  data.quotes = [{ quote_id: "q-real", episode_id: "a", speaker: "other", timestamp: "2025-08-04T01:10:00-07:00", text: "Exact supplied quote — keep this punctuation." }];
  return data;
}

describe("episode index and truthful intervals", () => {
  it("retains overlapping instants, offsets, point intervals, ordering and stable IDs without mutating the payload", () => {
    const data = synthetic(), original = structuredClone(data.episodes!);
    const index = indexEpisodes([...data.episodes!].reverse(), data.quotes);
    const ordered = index.byWeek.get("2025-W32")!;
    expect(ordered.map((row) => row.episode_id)).toEqual(["a", "b", "c"]);
    const geometry = episodeIntervals(ordered);
    expect(geometry.rows.map(({ lane, x1, x2 }) => [lane, x1, x2])).toEqual([[0, 0, 2 / 3], [1, 1 / 3, 1], [2, 2 / 3, 2 / 3]]);
    expect(index.byId.get("a")?.start).toBe("2025-08-04T01:00:00-07:00");
    expect(index.quotesByEpisode.get("a")).toEqual(data.quotes);
    expect(data.episodes).toEqual(original);
  });

  it("does not fabricate geometry for invalid intervals and keeps them indexed", () => {
    const bad = { ...synthetic().episodes![0], end: "unavailable" };
    expect(episodeIntervals([bad]).rows).toEqual([]);
    expect(indexEpisodes([bad], []).byId.get("a")).toBe(bad);
    const same = { ...bad, start: "2025-08-04T09:00:00Z", end: "2025-08-04T09:00:00Z" };
    expect(episodeIntervals([same]).rows[0]).toMatchObject({ x1: 0, x2: 0 });
  });
});

describe("weekly episode detail", () => {
  it.each([full, experimental])("consumes the existing sample schema $schema_version with a useful initial week", async (sample) => {
    render(<ReportView {...props(sample as Report)} />);
    expect(disclosure()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Inspect episode")).not.toBeInTheDocument();
    await open();
    const lastWeek = sample.episodes.at(-1)!.week;
    expect(week()).toHaveTextContent(lastWeek);
    expect(screen.getByRole("status")).toHaveTextContent(`Pinned ${lastWeek}`);
    expect(screen.getByLabelText("Inspect episode").querySelectorAll("option")).toHaveLength(sample.episodes.filter((e) => e.week === lastWeek).length);
  });

  it("shows exact metadata, zero counts, pooled+selected random/top_signal, quotes and unmoved overlapping lanes", async () => {
    const { container } = render(<ReportView {...props(synthetic())} />); await open();
    const inspector = screen.getByRole("region", { name: "Episode a" });
    for (const exact of ["2025-08-04T01:00:00-07:00", "2025-08-04T02:00:00-07:00", "Selected for scoring · random", "Me: 0 messages · 0 words", "Other person: 5 messages · 38 words", "Pooled: Yes · Late-night start: Yes", "Exact supplied quote — keep this punctuation."]) expect(inspector).toHaveTextContent(exact);
    expect(container.querySelectorAll(".episode-interval")).toHaveLength(3);
    const lines = [...container.querySelectorAll(".episode-range")];
    const expected = [[128, 530.666667], [329.333333, 732], [530.666667, 530.666667]];
    lines.forEach((line, i) => {
      expect(Number(line.getAttribute("x1"))).toBeCloseTo(expected[i][0], 5);
      expect(Number(line.getAttribute("x2"))).toBeCloseTo(expected[i][1], 5);
    });
    fireEvent.change(screen.getByLabelText("Inspect episode"), { target: { value: "b" } });
    expect(screen.getByRole("region", { name: "Episode b" })).toHaveTextContent("Selected for scoring · top_signal");
    expect(screen.getByRole("status")).toHaveTextContent("Episode b selected in 2025-W32");
    expect(screen.getByRole("region", { name: "Episode b" })).not.toHaveTextContent("Exact supplied quote");
    expect(screen.queryByRole("table", { name: /Exact episode index/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("View episode data · 3 episodes"));
    const table = screen.getByRole("table", { name: /Exact episode index/ });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(table).toHaveTextContent("2025-08-04T08:30:00+00:00");
    fireEvent.click(within(table).getByRole("button", { name: "a" }));
    expect(screen.getByLabelText("Inspect episode")).toHaveValue("a");
  });

  it("keeps experimental evidence out of the report episode inspector", async () => {
    const data = synthetic();
    data.experimental_scores = { ...experimental.experimental_scores, quotes: [{ id: "exp-q", speaker: "me", episode_id: "a", marker_key: "x", ts: "2025-08-04T08:00:00Z", text: "Experimental-only quote must stay separate." }] } as Report["experimental_scores"];
    render(<ReportView {...props(data)} />); await open();
    const inspector = screen.getByRole("region", { name: "Episode a" });
    expect(inspector).toHaveTextContent(data.quotes[0].text);
    expect(inspector).not.toHaveTextContent("Experimental-only quote");
  });

  it("omits unavailable legacy index while keeping activity, evidence text and unavailable references", () => {
    const data = structuredClone(full) as Report; delete data.episodes;
    render(<ReportView {...props(data)} />);
    expect(screen.queryByText("Episode detail", { exact: true })).not.toBeInTheDocument();
    expect(activity()).toBeInTheDocument();
    expect(screen.getAllByText(/Episode detail unavailable/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /View episode/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(data.quotes[0].text).length).toBeGreaterThan(0);
  });

  it("handles a present empty index and selected week without indexed intervals", async () => {
    const data = preview(); data.episodes = [];
    render(<ReportView {...props(data)} />);
    fireEvent.click(screen.getByText("Episode detail", { exact: true }));
    await screen.findByText("No indexed episodes supplied for this week.");
    expect(week()).toHaveTextContent("2025-W32"); expect(activity()).toBeInTheDocument();
  });

  it("resolves only real episode references, expands/focuses detail, preserves quotes and announces an outside-window change", async () => {
    const data = preview("104-weeks"), first = data.episodes![0];
    data.observations = { status: "ok", reason: null, items: [{ observation_id: "o", text: "Supplied observation", confidence: "low", supporting_episodes: 2, episode_ids: [first.episode_id, data.episodes!.at(-1)!.episode_id, "missing"], item_keys: [], feature_keys: [], quotes: [] }] };
    render(<ReportView {...props(data)} />);
    fireEvent.change(screen.getByLabelText("Chart display window"), { target: { value: "13" } });
    expect(screen.queryByRole("button", { name: "View episode missing" })).not.toBeInTheDocument();
    expect(screen.getByText("missing · Episode detail unavailable")).toBeInTheDocument();
    const last = data.episodes!.at(-1)!;
    fireEvent.click(screen.getByRole("button", { name: `View episode ${last.episode_id}` }));
    expect(screen.getByLabelText("Chart display window")).toHaveValue("13");
    expect(screen.getByRole("status")).not.toHaveTextContent("Display window changed");
    fireEvent.click(screen.getByRole("button", { name: `View episode ${first.episode_id}` }));
    await waitFor(() => expect(screen.getByLabelText("Inspect episode")).toHaveValue(first.episode_id));
    expect(disclosure()).toHaveFocus();
    expect(screen.getByLabelText("Chart display window")).toHaveValue("all");
    expect(week()).toHaveTextContent(first.week);
    expect(screen.getByRole("status")).toHaveTextContent("Display window changed to All weeks");
  });

  it("uses the current window initially, preserves in-window navigation and clears episode selection on week/window/report resets", async () => {
    const data = preview("104-weeks"), { rerender } = render(<ReportView {...props(data)} />);
    fireEvent.change(screen.getByLabelText("Chart display window"), { target: { value: "13" } });
    await open();
    const latest = data.weeks.at(-1)!.week;
    expect(week()).toHaveTextContent(latest);
    const last = data.episodes!.at(-1)!;
    fireEvent.change(screen.getByLabelText("Inspect episode"), { target: { value: last.episode_id } });
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(screen.getByLabelText("Inspect episode")).not.toHaveValue(last.episode_id);
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByLabelText("Inspect episode")).not.toHaveValue(last.episode_id);
    fireEvent.keyDown(activity(), { key: "Escape" });
    expect(screen.getByText("Select a week to inspect its episodes.")).toBeInTheDocument();
    fireEvent.keyDown(activity(), { key: "Home" });
    fireEvent.change(screen.getByLabelText("Chart display window"), { target: { value: "all" } });
    fireEvent.keyDown(activity(), { key: "Home" });
    fireEvent.change(screen.getByLabelText("Chart display window"), { target: { value: "13" } });
    expect(screen.getByText("Select a week to inspect its episodes.")).toBeInTheDocument();
    rerender(<ReportView {...props(preview("260-weeks"))} />);
    expect(disclosure()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Chart display window")).toHaveValue("all");
    expect(week()).toHaveTextContent("No week selected");
  });

  it("honors an explicit week when opening and keeps invalid timestamps exactly accessible", async () => {
    const data = preview("104-weeks");
    data.episodes![0] = { ...data.episodes![0], start: "unavailable", end: "unavailable" } as Episode;
    render(<ReportView {...props(data)} />); fireEvent.keyDown(activity(), { key: "Home" }); await open();
    expect(week()).toHaveTextContent(data.weeks[0].week);
    expect(screen.getByLabelText("Inspect episode").querySelectorAll("option")).toHaveLength(data.weeks[0].episodes);
    expect(screen.getByText(/Some intervals cannot be plotted/)).toBeInTheDocument();
  });
});
