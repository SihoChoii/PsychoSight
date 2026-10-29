import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    <ReportView report={report} deleting={false} deleteError={null} trendNote={TREND_NOTE} onDelete={vi.fn()} />,
  );
}

function openCard() {
  fireEvent.click(screen.getByRole("button", { name: /Experimental scores/ }));
}

describe("experimental scores section", () => {
  it("renders the stub sample, with the banner visible while collapsed", () => {
    renderReport(withSection(stubSection));
    const card = screen.getByRole("region", { name: "Experimental scores" });
    expect(within(card).getByTestId("exp-banner").textContent).toBe(config.experimental_banner);
    expect(within(card).getByTestId("exp-banner")).toBeVisible();
    expect(within(card).getByTestId("exp-support").textContent).toBe(config.experimental_footer_support);
    expect(screen.getByRole("button", { name: /Experimental scores/ })).toHaveAttribute("aria-expanded", "false");
    const scaleNote = document.querySelector("[data-testid='exp-scale-note']");
    expect(scaleNote?.closest("[hidden]")).not.toBeNull();
    const observations = screen.getByRole("region", { name: "Observations" });
    expect(within(observations).queryByRole("heading", { name: "Experimental scores" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /share|export/i })).not.toBeInTheDocument();

    openCard();
    expect(screen.getByTestId("exp-scale-note").textContent).toBe(config.experimental_scale_note);
    expect(screen.getByRole("heading", { name: "Big Five" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Well-being language" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Interpersonal language" })).toBeInTheDocument();
    expect(screen.getByText(INSUFFICIENT_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/run lower/i)).not.toBeInTheDocument();
    expect(screen.queryByText(TREND_NOTE)).not.toBeInTheDocument();
    expect(config.experimental_trend_note).toBe(TREND_NOTE);

    const openness = screen.getByRole("article", { name: "Openness (experimental language index)" });
    const whyButtons = within(openness).getAllByRole("button", { name: "Why this number" });
    fireEvent.click(whyButtons[0]);
    const rows = within(openness).getByTestId("why-openness-me");
    const items = within(rows).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("WWBP weighted word list");
    expect(Number(items[0].getAttribute("data-weight"))).toBeGreaterThanOrEqual(Number(items[1].getAttribute("data-weight")));
    const spark = within(openness).getAllByRole("img", { name: /Weekly trend/ })[0];
    expect(spark).toHaveAttribute("data-scale", "trend");
    expect(Number(spark.getAttribute("data-ymax"))).toBeLessThan(100);
    expect(spark.getAttribute("data-ymin")).not.toBe("0");

    const neuroticism = screen.getByRole("article", { name: "Neuroticism (experimental language index)" });
    fireEvent.click(within(neuroticism).getAllByRole("button", { name: "Why this number" })[0]);
    expect(within(neuroticism).getByText("kind of nervous about the new hire training tomorrow")).toBeInTheDocument();
    const outside = plain.quotes.find((quote) => !stubSection.quotes.some((item) => item.text === quote.text));
    expect(outside).toBeTruthy();
    expect(within(neuroticism).queryByText(outside?.text ?? "")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "How this works" }));
    expect(screen.getByTestId("exp-how").textContent).toBe(config.experimental_how_it_works);
    expect(within(card).queryByText(/\bhigh\b/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/percentile|gauge/i)).not.toBeInTheDocument();
  });

  it("renders the deterministic-only sample with AI markers not run", () => {
    renderReport(withSection(deterministicSection));
    openCard();
    expect(screen.getAllByText("Confidence low").length).toBeGreaterThan(0);
    expect(screen.queryByText("Confidence medium")).not.toBeInTheDocument();
    const openness = screen.getByRole("article", { name: "Openness (experimental language index)" });
    fireEvent.click(within(openness).getAllByRole("button", { name: "Why this number" })[0]);
    expect(within(openness).getByTestId("why-openness-me").querySelector("[data-status='not_run']")).toBeTruthy();
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
    openCard();
    const card = screen.getByRole("region", { name: "Experimental scores" });
    expect(within(card).queryByText("Other person")).not.toBeInTheDocument();
    expect(within(card).getAllByText("Me").length).toBeGreaterThan(0);
    expect(screen.queryByText(INSUFFICIENT_TEXT)).not.toBeInTheDocument();

    renderReport(withSection(failedSection));
    fireEvent.click(screen.getAllByRole("button", { name: /Experimental scores/ })[1]);
    expect(screen.getByText("Experimental scores could not be computed for this run.")).toBeVisible();
    expect(screen.getAllByRole("region", { name: "Experimental scores" })[1]).not.toHaveTextContent("Uncertainty band");

    renderReport(withSection(notRunSection));
    fireEvent.click(screen.getAllByRole("button", { name: /Experimental scores/ })[2]);
    expect(screen.getByText("not requested")).toBeVisible();

    renderReport(withSection(insufficientSection));
    fireEvent.click(screen.getAllByRole("button", { name: /Experimental scores/ })[3]);
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
    openCard();
    expect(screen.getAllByRole("article")).toHaveLength(12);
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
    expect(within(card).queryByRole("heading", { name: "Big Five" })).not.toBeInTheDocument();

    openCard();
    expect(screen.getByRole("heading", { name: "Big Five" })).toBeVisible();
    expect(screen.getAllByRole("article")).toHaveLength(12);
    expect(screen.queryByText(INSUFFICIENT_TEXT)).not.toBeInTheDocument();
    expect(within(card).queryByText(/\bhigh\b/i)).not.toBeInTheDocument();

    const openness = screen.getByRole("article", { name: "Openness (experimental language index)" });
    expect(within(openness).getByText("51", { selector: ".exp-score-num" })).toBeInTheDocument();
    expect(within(openness).getByText("45", { selector: ".exp-score-num" })).toBeInTheDocument();
    expect(within(openness).getAllByText("Confidence medium")).toHaveLength(2);

    const neuroticism = screen.getByRole("article", { name: "Neuroticism (experimental language index)" });
    fireEvent.click(within(neuroticism).getAllByRole("button", { name: "Why this number" })[0]);
    const me = section?.dimensions.find((dim) => dim.key === "neuroticism")?.per_speaker.me;
    const quoteId = me?.contributions.flatMap((item) => item.quote_ids)[0];
    const quote = section?.quotes.find((item) => item.id === quoteId);
    expect(quote?.text).toBeTruthy();
    expect(within(neuroticism).getByText(quote?.text ?? "")).toBeInTheDocument();
    expect(report.quotes.some((item) => item.text === quote?.text)).toBe(false);
    expect(within(neuroticism).queryByText(/run lower/i)).not.toBeInTheDocument();
    expect(within(neuroticism).getAllByText(TREND_NOTE).length).toBeGreaterThan(0);
    const spark = within(neuroticism).getAllByRole("img", { name: /Weekly trend for me/ })[0];
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
    return render(
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
  }

  it("pre-checks both boxes only for the demo and disables the second until the first is checked", () => {
    renderOptIn();
    const experimental = screen.getByRole("checkbox", { name: config.experimental_opt_in_text });
    const other = screen.getByRole("checkbox", { name: config.score_other_opt_in_text });
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

  it("leaves both unchecked off the demo, and hides them when the feature is off", () => {
    const first = renderOptIn({ isDemo: false, demoProviderNote: null });
    expect(screen.getByRole("checkbox", { name: config.experimental_opt_in_text })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: config.score_other_opt_in_text })).toBeDisabled();
    expect(screen.queryByTestId("demo-provider-note")).not.toBeInTheDocument();
    first.unmount();

    renderOptIn({ experimentalEnabled: false });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
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
