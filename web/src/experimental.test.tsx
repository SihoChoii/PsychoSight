import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import fullReport from "../../docs/sample_report.json";
import liveReportJson from "../../docs/sample_report_experimental.json";
import { buildAnalysisRequest } from "./analysis-request";
import { mockApi } from "./mock";
import { ProgressView } from "./components/ProgressView";
import { OptIn } from "./components/OptIn";
import { ReportView } from "./components/ReportView";
import { INSUFFICIENT_TEXT } from "./experimental";
import {
  deterministicSection,
  failedSection,
  insufficientSection,
  notRunSection,
  nullOtherSection,
  realLikeSection,
  stubSection,
} from "./fixtures/experimental-samples";
import mockConfig from "./fixtures/mock-config.json";
import type { Config, Report } from "./types";

const config = mockConfig as Config;
const plain = fullReport as unknown as Report;

function withSection(section: Report["experimental_scores"], schema = "1.1.0"): Report {
  const report = structuredClone(plain);
  report.schema_version = schema;
  if (section) report.experimental_scores = structuredClone(section);
  else delete report.experimental_scores;
  return report;
}

const TREND_NOTE = "Weekly trend values are on their own scale and are not directly comparable to the overall index.";

function renderReport(report: Report) {
  render(
    <main><ReportView report={report} deleting={false} deleteError={null} onDelete={vi.fn()} /></main>,
  );
}

function expectOpenSection() {
  expect(screen.getByRole("heading", { name: "Big Five" })).toBeVisible();
}

function mockScrollObservers() {
  const observers = new Map<Element, { notify: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }>();
  vi.stubGlobal("IntersectionObserver", class {
    disconnect = vi.fn();
    constructor(private notify: IntersectionObserverCallback) {}
    observe = (element: Element) => observers.set(element, { notify: this.notify, disconnect: this.disconnect });
  });
  return {
    observers,
    scrollTo(element: Element, ratio: number) {
      const observer = observers.get(element);
      expect(observer).toBeDefined();
      act(() => observer!.notify([
        { isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry,
      ], {} as IntersectionObserver));
    },
  };
}

describe("experimental scores section", () => {
  it("opens with the web visible and keeps evidence available on demand", () => {
    renderReport(withSection(stubSection));
    const card = screen.getByRole("region", { name: "Experimental scores" });
    expect(within(card).getByTestId("exp-banner").textContent).toBe(config.experimental_banner);
    expect(within(card).getByTestId("exp-banner")).toBeVisible();
    expect(within(card).getByTestId("exp-support").textContent).toBe(config.experimental_footer_support);
    expect(within(card).getByRole("img", { name: /Big Five shape/ })).toBeVisible();
    expect(screen.getByTestId("exp-scale-note")).toBeVisible();
    expect(within(card).queryByRole("button", { name: /Show experimental|Big Five shape/i })).not.toBeInTheDocument();
    const observations = screen.getByRole("region", { name: "Observations" });
    expect(within(observations).queryByRole("heading", { name: "Experimental scores" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /share|export/i })).not.toBeInTheDocument();

    expectOpenSection();
    expect(screen.getByTestId("exp-scale-note").textContent).toBe(config.experimental_scale_note);
    expect(screen.getByRole("heading", { name: "Big Five" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Well-being language" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Interpersonal language" })).toBeInTheDocument();
    expect(screen.getByText(INSUFFICIENT_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/run lower/i)).not.toBeInTheDocument();
    expect(config.experimental_trend_note).toBe(TREND_NOTE);

    const openness = screen.getByRole("article", { name: "Openness (experimental language index)" });
    fireEvent.click(within(openness).getByRole("button", { name: /Explore Openness/ }));
    expect(within(openness).queryByText(TREND_NOTE)).not.toBeInTheDocument();
    const whyButtons = within(openness).getAllByRole("button", { name: /Why this number for/ });
    fireEvent.click(whyButtons[0]);
    const rows = screen.getByTestId("why-openness-me");
    const items = within(rows).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("WWBP weighted word list");
    expect(Number(items[0].getAttribute("data-weight"))).toBeGreaterThanOrEqual(Number(items[1].getAttribute("data-weight")));
    const spark = within(openness).getAllByRole("img", { name: /Weekly trend/ })[0];
    expect(spark).toHaveAttribute("data-scale", "trend");
    expect(Number(spark.getAttribute("data-ymax"))).toBeLessThan(100);
    expect(spark.getAttribute("data-ymin")).not.toBe("0");

    const neuroticism = screen.getByRole("article", { name: "Neuroticism (experimental language index)" });
    fireEvent.click(within(neuroticism).getByRole("button", { name: /Explore Neuroticism/ }));
    fireEvent.click(within(neuroticism).getAllByRole("button", { name: /Why this number for/ })[0]);
    expect(within(screen.getByRole("dialog", { name: "Why this number" })).getByText("kind of nervous about the new hire training tomorrow")).toBeInTheDocument();
    const outside = plain.quotes.find((quote) => !stubSection.quotes.some((item) => item.text === quote.text));
    expect(outside).toBeTruthy();
    expect(within(screen.getByRole("dialog", { name: "Why this number" })).queryByText(outside?.text ?? "")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "How this works" }));
    expect(screen.getByTestId("exp-how").textContent).toBe(config.experimental_how_it_works);
    expect(within(card).queryByText(/\bhigh\b/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/percentile|gauge/i)).not.toBeInTheDocument();
  });

  it("replays on returning after scrolling fully away, without a replay control", () => {
    const { observers, scrollTo } = mockScrollObservers();
    try {
      const view = render(<ReportView report={withSection(realLikeSection)} deleting={false} deleteError={null} onDelete={vi.fn()} />);
      const chart = screen.getByRole("img", { name: /Big Five shape/ });
      const reveal = chart.querySelector(".exp-radar-reveal");
      const geometry = chart.querySelector(".exp-radar-me")?.getAttribute("points");
      expect(screen.queryByRole("button", { name: "Replay reveal" })).not.toBeInTheDocument();
      expect(observers.has(chart)).toBe(true);
      scrollTo(chart, 0.4);
      expect(reveal).toHaveAttribute("data-revealed", "true");
      scrollTo(chart, 0.1);
      expect(reveal).toHaveAttribute("data-revealed", "true");
      scrollTo(chart, 0);
      expect(reveal).toHaveAttribute("data-revealed", "false");
      scrollTo(chart, 0.4);
      expect(reveal).toHaveAttribute("data-revealed", "true");
      expect(chart.querySelector(".exp-radar-me")).toHaveAttribute("points", geometry);
      expect(observers.get(chart)!.disconnect).not.toHaveBeenCalled();
      view.unmount();
      expect(observers.get(chart)!.disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reveals score rows independently on return without changing values or closing evidence", () => {
    const { observers, scrollTo } = mockScrollObservers();
    try {
      const view = render(<ReportView report={withSection(realLikeSection)} deleting={false} deleteError={null} onDelete={vi.fn()} />);
      const openness = screen.getByRole("article", { name: "Openness (experimental language index)" });
      const summary = openness.querySelector(".exp-dim-summary")!;
      const lowerRow = screen.getByRole("article", { name: /Depression-related language/ }).querySelector(".exp-dim-summary")!;
      const originalScores = Array.from(openness.querySelectorAll(".exp-score-num")).map((node) => node.textContent);
      const pinPositions = Array.from(openness.querySelectorAll<HTMLElement>(".exp-pin")).map((node) => node.style.getPropertyValue("--exp-score-position"));
      scrollTo(summary, 0.4);
      expect(summary).toHaveAttribute("data-revealed", "true");
      expect(lowerRow).toHaveAttribute("data-revealed", "false");
      fireEvent.click(within(openness).getByRole("button", { name: /Explore Openness/ }));
      expect(summary).toHaveAttribute("data-revealed", "true");
      scrollTo(summary, 0.1);
      expect(summary).toHaveAttribute("data-revealed", "true");
      scrollTo(summary, 0);
      expect(summary).toHaveAttribute("data-revealed", "false");
      scrollTo(lowerRow, 0.4);
      expect(lowerRow).toHaveAttribute("data-revealed", "true");
      scrollTo(summary, 0.4);
      expect(summary).toHaveAttribute("data-revealed", "true");
      expect(within(openness).getByRole("button", { name: /Hide Openness/ })).toHaveAttribute("aria-expanded", "true");
      expect(Array.from(openness.querySelectorAll(".exp-score-num")).map((node) => node.textContent)).toEqual(originalScores);
      expect(Array.from(openness.querySelectorAll<HTMLElement>(".exp-pin")).map((node) => node.style.getPropertyValue("--exp-score-position"))).toEqual(pinPositions);
      view.unmount();
      for (const observer of observers.values()) expect(observer.disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("smooth disclosures keep closed evidence inert and replay trends on reopening", () => {
    const { scrollTo } = mockScrollObservers();
    try {
      renderReport(withSection(realLikeSection));
      const openness = screen.getByRole("article", { name: "Openness (experimental language index)" });
      const trigger = within(openness).getByRole("button", { name: /Explore Openness/ });
      const panel = document.getElementById(trigger.getAttribute("aria-controls")!)!;
      expect(panel).toHaveAttribute("inert");
      expect(panel).toHaveAttribute("aria-hidden", "true");
      fireEvent.click(trigger);
      expect(panel).not.toHaveAttribute("inert");
      expect(panel).toHaveAttribute("aria-hidden", "false");
      const graphs = within(openness).getAllByRole("img", { name: /Weekly trend/ });
      const paths = graphs.map((graph) => graph.querySelector("path")?.getAttribute("d"));
      for (const graph of graphs) scrollTo(graph, 0.4);
      for (const graph of graphs) expect(graph).toHaveAttribute("data-revealed", "true");
      const why = within(openness).getAllByRole("button", { name: /Why this number for/ })[0];
      fireEvent.click(why);
      expect(screen.getByRole("dialog", { name: "Why this number" })).toBeVisible();
      fireEvent.click(why);
      expect(screen.queryByRole("dialog", { name: "Why this number" })).not.toBeInTheDocument();
      fireEvent.click(trigger);
      expect(panel).toHaveAttribute("aria-hidden", "true");
      expect(panel).toHaveAttribute("inert");
      expect(within(openness).queryByRole("img", { name: /Weekly trend/ })).not.toBeInTheDocument();
      for (const graph of graphs) expect(graph).toHaveAttribute("data-revealed", "false");
      fireEvent.click(trigger);
      for (const graph of graphs) expect(graph).toHaveAttribute("data-revealed", "true");
      expect(graphs.map((graph) => graph.querySelector("path")?.getAttribute("d"))).toEqual(paths);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("highlights the selected axis, discloses details and preserves exact values", () => {
    renderReport(withSection(realLikeSection));
    const openness = screen.getByRole("article", { name: "Openness (experimental language index)" });
    const trigger = within(openness).getByRole("button", { name: /Explore Openness/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(within(openness).queryByRole("img", { name: /Weekly trend/ })).not.toBeInTheDocument();
    fireEvent.focus(trigger);
    expect(document.querySelectorAll('.exp-radar-axis-group[data-active="true"]')).toHaveLength(1);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(openness).getByText(realLikeSection.dimensions[0].evidence_note)).toBeVisible();
    expect(within(openness).getAllByRole("img", { name: /Weekly trend/ })).toHaveLength(1);
    fireEvent.click(trigger);
    expect(within(openness).queryByRole("img", { name: /Weekly trend/ })).not.toBeInTheDocument();
    fireEvent.blur(trigger);
    expect(document.querySelectorAll('.exp-radar-axis-group[data-active="true"]')).toHaveLength(0);
  });

  it("does not close a radar polygon through missing scores or confuse zero with missing", () => {
    const section = structuredClone(realLikeSection);
    section.dimensions[0].per_speaker.me = {
      ...section.dimensions[0].per_speaker.me,
      status: "insufficient_data", score: null, band: null, confidence: null,
    };
    section.dimensions[1].per_speaker.me.score = 0;
    renderReport(withSection(section));
    expect(document.querySelector('.exp-radar-me')).toBeNull();
    expect(document.querySelector('.exp-radar-other')).not.toBeNull();
    expect(document.querySelectorAll('.exp-radar-me-dot')).toHaveLength(4);
    expect(document.querySelectorAll('.exp-radar-other-dot')).toHaveLength(5);
    expect(screen.getByText("Only available scores are plotted.")).toBeVisible();
    const zero = document.querySelector('.exp-radar-me-dot');
    expect(zero).toHaveAttribute("cx", "360");
    expect(zero).toHaveAttribute("cy", "292");
  });

  it("places experiments before weekly patterns and family navigation focuses without changing routes", () => {
    renderReport(withSection(realLikeSection));
    const experimental = screen.getByRole("region", { name: "Experimental scores" });
    const weekly = screen.getByRole("region", { name: "Weekly patterns" });
    expect(experimental.compareDocumentPosition(weekly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const scroll = vi.fn();
    const heading = screen.getByRole("heading", { name: "Interpersonal language" });
    heading.scrollIntoView = scroll;
    const hash = window.location.hash;
    fireEvent.click(screen.getByRole("button", { name: "Interpersonal" }));
    expect(heading).toHaveFocus();
    expect(scroll).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe(hash);
    const weeklyHeading = screen.getByRole("heading", { name: "Weekly patterns" });
    weeklyHeading.scrollIntoView = scroll;
    const reportNav = screen.getByRole("navigation", { name: "Report sections" });
    fireEvent.click(within(reportNav).getByText('Explore report'));
    fireEvent.click(within(reportNav).getByRole('button', { name: 'Weekly patterns' }));
    expect(weeklyHeading).toHaveFocus();
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe(hash);
  });

  it("renders the deterministic-only sample with AI markers not run", () => {
    renderReport(withSection(deterministicSection));
    expectOpenSection();
    expect(screen.getAllByText("Confidence low").length).toBeGreaterThan(0);
    expect(screen.queryByText("Confidence medium")).not.toBeInTheDocument();
    const openness = screen.getByRole("article", { name: "Openness (experimental language index)" });
    fireEvent.click(within(openness).getByRole("button", { name: /Explore Openness/ }));
    fireEvent.click(within(openness).getAllByRole("button", { name: /Why this number for/ })[0]);
    expect(screen.getByTestId("why-openness-me").querySelector("[data-status='not_run']")).toBeTruthy();
    expect(screen.queryByText(INSUFFICIENT_TEXT)).not.toBeInTheDocument();
  });

  it("renders a report without the section, including schema 1.0.0, unchanged", () => {
    renderReport(plain);
    expect(plain.schema_version).toBe("1.0.0");
    expect(screen.queryByTestId("exp-banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Experimental scores" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Observations" })).toBeInTheDocument();
    expect(screen.getAllByText("Confidence: high").length).toBeGreaterThan(0);

    renderReport(withSection(undefined, "1.1.0"));
    expect(screen.getAllByRole("heading", { name: "Observations" })).toHaveLength(2);
    expect(screen.queryByTestId("exp-banner")).not.toBeInTheDocument();
  });

  it("handles a null other person, and each section status", () => {
    renderReport(withSection(nullOtherSection));
    expectOpenSection();
    const card = screen.getByRole("region", { name: "Experimental scores" });
    expect(within(card).queryByText("Other person")).not.toBeInTheDocument();
    expect(within(card).getAllByText("Me").length).toBeGreaterThan(0);
    expect(screen.queryByText(INSUFFICIENT_TEXT)).not.toBeInTheDocument();

    renderReport(withSection(failedSection));
    expect(screen.getByText("Experimental scores could not be computed for this run.")).toBeVisible();
    expect(screen.getAllByRole("region", { name: "Experimental scores" })[1]).not.toHaveTextContent("Uncertainty band");

    renderReport(withSection(notRunSection));
    expect(screen.getByText("not requested")).toBeVisible();

    renderReport(withSection(insufficientSection));
    expect(screen.getByText(INSUFFICIENT_TEXT)).toBeVisible();
    expect(screen.queryByText("fewer than 20 episodes for this person")).not.toBeInTheDocument();
  });

  it("renders the real-like sample with medium Big Five and wide low-confidence bands", () => {
    expect(realLikeSection.dimensions).toHaveLength(12);
    for (const dim of realLikeSection.dimensions) {
      for (const speaker of [dim.per_speaker.me, dim.per_speaker.other]) {
        expect(speaker?.status).toBe("ok");
        expect(speaker?.confidence).not.toBe("high");
        if (dim.family === "big_five") expect(speaker?.confidence).toBe("medium");
        else {
          expect(speaker?.confidence).toBe("low");
          expect((speaker?.band?.hi ?? 0) - (speaker?.band?.lo ?? 0)).toBeGreaterThanOrEqual(40);
        }
      }
    }
    renderReport(withSection(realLikeSection));
    expectOpenSection();
    const card = screen.getByRole('region', { name: 'Experimental scores' });
    expect(within(card).getAllByRole("article")).toHaveLength(12);
    expect(screen.queryByText(INSUFFICIENT_TEXT)).not.toBeInTheDocument();
    const depression = screen.getByRole("article", { name: /Depression-related language/ });
    expect(within(depression).getAllByText("Confidence low").length).toBe(2);
    expect(within(depression).queryByText("Confidence medium")).not.toBeInTheDocument();
  });

  it("renders the live DeepSeek sample report", async () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
    const report = await mockApi.getReport("sample-exp-live");
    const section = report.experimental_scores;
    expect(report.schema_version).toBe("1.1.0");
    expect(report.report_id).toBe("sample-exp-live");
    expect(section?.status).toBe("ok");
    expect(section?.dimensions).toHaveLength(12);
    expect(section?.speakers_scored).toEqual(["me", "other"]);
    const file = liveReportJson as unknown as Report;
    expect(section?.quotes).toEqual(file.experimental_scores?.quotes);

    for (const dim of section?.dimensions ?? []) {
      expect(dim.per_speaker.other).not.toBeNull();
      for (const speaker of [dim.per_speaker.me, dim.per_speaker.other]) {
        expect(speaker?.status).toBe("ok");
        expect(speaker?.confidence).not.toBe("high");
        const width = (speaker?.band?.hi ?? 0) - (speaker?.band?.lo ?? 0);
        if (dim.family === "big_five") expect(speaker?.confidence).toBe("medium");
        else {
          expect(speaker?.confidence).toBe("low");
          expect(width).toBeGreaterThanOrEqual(20);
        }
      }
    }

    renderReport(report);
    expect(screen.getByRole("heading", { name: "Observations" })).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Experimental scores" });
    expect(within(card).getByTestId("exp-banner")).toBeVisible();
    expect(within(card).getByRole("heading", { name: "Big Five" })).toBeVisible();

    expectOpenSection();
    expect(screen.getByRole("heading", { name: "Big Five" })).toBeVisible();
    expect(within(card).getAllByRole("article")).toHaveLength(12);
    expect(screen.queryByText(INSUFFICIENT_TEXT)).not.toBeInTheDocument();
    expect(within(card).queryByText(/\bhigh\b/i)).not.toBeInTheDocument();

    const openness = screen.getByRole("article", { name: "Openness (experimental language index)" });
    expect(within(openness).getByText("51", { selector: ".exp-score-num" })).toBeInTheDocument();
    expect(within(openness).getByText("45", { selector: ".exp-score-num" })).toBeInTheDocument();
    expect(within(openness).getAllByText("Confidence medium")).toHaveLength(2);

    const neuroticism = screen.getByRole("article", { name: "Neuroticism (experimental language index)" });
    fireEvent.click(within(neuroticism).getByRole("button", { name: /Explore Neuroticism/ }));
    fireEvent.click(within(neuroticism).getAllByRole("button", { name: /Why this number for/ })[0]);
    const me = section?.dimensions.find((dim) => dim.key === "neuroticism")?.per_speaker.me;
    const quoteId = me?.contributions.flatMap((item) => item.quote_ids)[0];
    const quote = section?.quotes.find((item) => item.id === quoteId);
    expect(quote?.text).toBeTruthy();
    expect(within(screen.getByRole("dialog", { name: "Why this number" })).getByText(quote?.text ?? "")).toBeInTheDocument();
    expect(report.quotes.some((item) => item.text === quote?.text)).toBe(false);
    expect(within(neuroticism).queryByText(/run lower/i)).not.toBeInTheDocument();
    expect(within(neuroticism).queryByText(TREND_NOTE)).not.toBeInTheDocument();
    const spark = within(neuroticism).getAllByRole("img", { name: /Weekly trend/ })[0];
    expect(spark).toHaveAttribute("data-scale", "trend");
    expect(Number(spark.getAttribute("data-ymin"))).toBeGreaterThanOrEqual(20);
    expect(Number(spark.getAttribute("data-ymax"))).toBeLessThanOrEqual(32);
    expect(Number(spark.getAttribute("data-ymax"))).toBeLessThan(me?.score ?? 0);

    spy.mockRestore();
    expect(errors).toEqual([]);
  });
});

describe("experimental opt-in", () => {
  function renderOptIn(props: Partial<ComponentProps<typeof OptIn>> = {}) {
    const view = render(
      <OptIn
        text={config.opt_in_text}
        busy={false}
        error={null}
        isDemo
        experimentalEnabled
        experimentalText={config.experimental_opt_in_text}
        scoreOtherText={config.score_other_opt_in_text}
        demoProviderNote={config.demo_provider_note}
        onOptIn={() => {}}
        onLocalOnly={() => {}}
        {...props}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable AI analysis" }));
    return view;
  }

  it("pre-checks both boxes for the demo and disables the second until the first is checked", () => {
    renderOptIn();
    const experimental = screen.getByRole("checkbox", { name: "Add experimental scores" });
    const other = screen.getByRole("checkbox", { name: "Also score the other person" });
    expect(experimental).toBeChecked();
    expect(other).toBeChecked();
    expect(screen.getByTestId("demo-provider-note").textContent).toBe(config.demo_provider_note);
    expect(screen.getByTestId("opt-in-text").textContent).toBe(config.opt_in_text);

    fireEvent.click(experimental);
    expect(experimental).not.toBeChecked();
    expect(other).not.toBeChecked();
    expect(other).toBeDisabled();
    fireEvent.click(experimental);
    expect(other).toBeEnabled();
    expect(other).not.toBeChecked();
  });

  it("includes experimental scores for real conversations, leaves Other optional, and respects the feature switch", () => {
    const first = renderOptIn({ isDemo: false, demoProviderNote: null });
    expect(screen.getByRole("checkbox", { name: "Add experimental scores" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Also score the other person" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Also score the other person" })).toBeEnabled();
    expect(screen.queryByTestId("demo-provider-note")).not.toBeInTheDocument();
    first.unmount();

    renderOptIn({ experimentalEnabled: false });
    expect(screen.queryByRole("checkbox", { name: "Add experimental scores" })).not.toBeInTheDocument();
  });

  it("echoes the config strings and rejects scoring the other person alone", async () => {
    const on = buildAnalysisRequest({
      conversationId: "demo",
      isDemo: true,
      dateFrom: "",
      dateTo: "",
      llmOptIn: true,
      choice: { experimental: true, scoreOther: true },
      config,
    });
    expect(on.experimental_scores).toBe(true);
    expect(on.score_other).toBe(true);
    expect(on.experimental_opt_in_text).toBe(config.experimental_opt_in_text);
    expect(on.score_other_opt_in_text).toBe(config.score_other_opt_in_text);

    const off = buildAnalysisRequest({
      conversationId: "42",
      isDemo: false,
      dateFrom: "",
      dateTo: "",
      llmOptIn: false,
      choice: { experimental: false, scoreOther: true },
      config,
    });
    expect(off.experimental_scores).toBe(false);
    expect(off.score_other).toBe(false);
    expect(off.experimental_opt_in_text).toBeUndefined();
    expect(off.score_other_opt_in_text).toBeUndefined();

    const disabled = buildAnalysisRequest({
      conversationId: "demo",
      isDemo: true,
      dateFrom: "",
      dateTo: "",
      llmOptIn: true,
      choice: { experimental: true, scoreOther: true },
      config: { ...config, experimental_enabled: false },
    });
    expect(disabled.experimental_scores).toBe(false);

    await expect(
      mockApi.createAnalysis({
        conversation_id: "demo",
        llm_opt_in: true,
        experimental_scores: false,
        score_other: true,
      }),
    ).rejects.toMatchObject({ code: "EXPERIMENTAL_CONSENT_REQUIRED", status: 422 });
  });
});

describe("experimental progress", () => {
  it("prints the finished count for the experimental stage", () => {
    render(
      <ProgressView
        onBack={() => {}}
        job={{
          job_id: "preview",
          status: "running",
          stage: "experimental",
          progress: { current: 4, total: 8 },
          mode: "full",
          conversation_id: "demo",
          created_at: "2025-11-16T06:10:00.000Z",
          error: null,
        }}
      />,
    );
    expect(screen.getByText("4 of 8 work units complete.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "4");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "8");
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Experimental scores");
  });
});
