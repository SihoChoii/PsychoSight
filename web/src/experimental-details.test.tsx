import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExperimentalScores } from "./components/ExperimentalScores";
import { experimentalTrend, hasScore, sortedContributions } from "./experimental";
import { detailStressSection, deterministicSection, realLikeSection, nullOtherSection, stubSection, failedSection, notRunSection, insufficientSection } from "./fixtures/experimental-samples";
import type { ExpTrendPoint } from "./types";
import config from "./fixtures/mock-config.json";
import { ReportView } from "./components/ReportView";
import plain from "../../docs/sample_report.json";
import type { Report } from "./types";

function show(section = realLikeSection) {
  render(<ExperimentalScores section={section} trendNote={config.experimental_trend_note} />);
  fireEvent.click(screen.getByRole("button", { name: /Experimental scores/ }));
  return screen.getByRole("region", { name: "Experimental scores" });
}
function openSpeaker(article: HTMLElement, index = 0) {
  const button = within(article).getAllByRole("button", { name: "Why this number" })[index];
  fireEvent.click(button);
  return document.getElementById(button.getAttribute("aria-controls") ?? "") as HTMLElement;
}
const point = (week: string, score: number | null, episodes = 3, words = 300): ExpTrendPoint => ({ week, score, n_episodes: episodes, n_words: words, reason: score === null ? "thin week" : null });

describe("experimental comparison contract", () => {
  it("keeps every label, score, band, confidence and actual basis visible in family order", () => {
    const card = show();
    const articles = within(card).getAllByRole("article");
    expect(articles).toHaveLength(12);
    articles.forEach((article, i) => {
      const dim = realLikeSection.dimensions[i];
      expect(within(article).getByRole("heading", { name: dim.label })).toBeVisible();
      expect(within(article).getByText(dim.evidence_note)).toBeVisible();
      expect(within(article).getByText(`Evidence ${dim.evidence_strength.replaceAll("_", " ")}`)).toBeVisible();
      article.querySelectorAll<HTMLElement>(".exp-speaker").forEach((row) => {
        const who = row.dataset.speaker as "me" | "other", speaker = dim.per_speaker[who];
        expect(speaker).not.toBeNull();
        expect(row.querySelector(".exp-score-num")).toHaveTextContent(String(speaker?.score));
        expect(within(row).getByText(`Uncertainty band ${speaker?.band?.lo}–${speaker?.band?.hi}`)).toBeVisible();
        expect(within(row).getByText(`Confidence ${speaker?.confidence}`)).toBeVisible();
        expect(within(row).getByText(`based on ${speaker?.n_episodes.toLocaleString("en-US")} episodes / ${speaker?.n_words.toLocaleString("en-US")} words`)).toBeVisible();
        expect(row.querySelector(".exp-bar")).toHaveAttribute("data-domain", "0,100");
      });
    });
    expect(card.querySelectorAll(".exp-pin-me")).toHaveLength(12);
    expect(card.querySelectorAll(".exp-pin-other")).toHaveLength(12);
    expect(card.querySelectorAll(".exp-meter")).toHaveLength(0);
    expect(card.querySelectorAll(".exp-drilldown:not([hidden])")).toHaveLength(0);
    expect(card.querySelector(".exp-spark")).toBeNull();
    expect(within(card).getByTestId("exp-scale-note").textContent).toBe(config.experimental_scale_note);
  });

  it("omits all null Other rows and its optional shape marks", () => {
    const card = show(nullOtherSection);
    expect(card.querySelector("[data-speaker=other]")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Big Five shape" }));
    expect(card.querySelector(".exp-radar-other")).toBeNull();
    expect(card.querySelectorAll(".exp-radar .exp-spark-dot")).toHaveLength(5);
    expect(card.querySelector(".exp-radar .exp-spark-other-mark")).toBeNull();
  });

  it("keeps the optional shape behind its toggle, with both sets of uncertainty and cues", () => {
    const card = show();
    const toggle = within(card).getByRole("button", { name: "Big Five shape" });
    expect(card.querySelector(".exp-radar")).toBeNull(); fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(card.querySelectorAll(".exp-radar-band")).toHaveLength(10);
    expect(card.querySelectorAll(".exp-radar .exp-spark-dot")).toHaveLength(5);
    expect(card.querySelectorAll(".exp-radar .exp-spark-other-mark")).toHaveLength(5);
  });

  it("shows exact observed precision, common-scale effective weights, sources, directions and stable ties", () => {
    const section = structuredClone(detailStressSection);
    const speaker = section.dimensions[0].per_speaker.me;
    speaker.contributions.forEach((c) => c.weight = 0);
    speaker.contributions[0].weight = 0.1;
    speaker.contributions[2].weight = 0.1;
    const input = JSON.stringify(section);
    show(section);
    const article = screen.getAllByRole("article")[0];
    const panel = openSpeaker(article);
    const rows = within(panel).getByTestId("why-openness-me").children;
    expect(rows[0]).toHaveAttribute("data-marker", speaker.contributions[0].marker_key);
    expect(rows[1]).toHaveAttribute("data-marker", speaker.contributions[2].marker_key);
    expect(rows[0].querySelector(".exp-weight-track > span")).toHaveStyle({ width: "10%" });
    expect(rows[1].querySelector(".exp-weight-track > span")).toHaveStyle({ width: "10%" });
    expect(within(panel).getByText(/Observed value: 0.123456789 /)).toBeVisible();
    expect(rows[0]).toHaveTextContent("Word count"); expect(rows[0]).toHaveTextContent("Raises the index");
    expect(rows[2]).toHaveTextContent("No data"); expect(rows[2]).toHaveTextContent("Observed value: unavailable");
    expect(JSON.stringify(section)).toBe(input);
  });

  it("renders unavailable AI markers in deterministic results and unchanged citations without requests", () => {
    show(deterministicSection);
    const panel = openSpeaker(screen.getAllByRole("article")[0]);
    expect(panel.querySelectorAll("[data-status=not_run]").length).toBeGreaterThan(0);
    for (const row of panel.querySelectorAll("[data-status=not_run]")) {
      expect(row).toHaveTextContent("Not run"); expect(row.querySelector(".exp-weight-track")).toBeNull();
    }
    const citations = deterministicSection.dimensions[0].citations;
    for (const c of citations) {
      expect(panel).toHaveTextContent(c.short);
      if (c.doi) expect(within(panel).getByRole("link", { name: c.doi })).toHaveAttribute("href", `https://doi.org/${c.doi}`);
    }
  });

  it("resolves only experimental quotes, preserves whitespace/time, and labels missing IDs", () => {
    show(detailStressSection);
    const panel = openSpeaker(screen.getAllByRole("article")[0]);
    const quote = detailStressSection.quotes.find((q) => q.id === "xq_ui_long");
    expect(panel.querySelector("[data-exp-quote-id=xq_ui_long] .exp-quote-text")?.textContent).toBe(quote?.text);
    expect(panel.querySelector("[data-exp-quote-id=xq_ui_long] time")).toHaveAttribute("datetime", quote?.ts);
    expect(within(panel).getByText("Quote evidence unavailable: xq_missing")).toBeVisible();
  });

  it("renders speaker union quotes even when no contribution refers to them", () => {
    const section = structuredClone(stubSection);
    const speaker = section.dimensions[0].per_speaker.me, quote = section.quotes[0];
    speaker.quote_ids = [quote.id]; speaker.contributions.forEach((c) => c.quote_ids = []);
    show(section); const panel = openSpeaker(screen.getAllByRole("article")[0]);
    expect(within(panel).getByText("Additional supplied evidence")).toBeVisible();
    expect(panel.querySelector(".exp-quote-text")?.textContent).toBe(quote.text);
  });

  it("shows failed/not-run/thin speaker messages and basis without drawing numeric markers", () => {
    const card = show(detailStressSection);
    for (const i of [1, 2, 3]) {
      const row = card.querySelectorAll("article")[i].querySelector("[data-speaker=me]") as HTMLElement;
      expect(row.querySelector(".exp-pin")).toBeNull(); expect(row.querySelector(".exp-score-num")).toBeNull();
      expect(row.querySelector(".exp-state")).toBeVisible(); expect(row.querySelector(".exp-basis")).toBeVisible();
      fireEvent.click(within(row).getByRole("button", { name: "Why this number" }));
      expect(row.querySelector(".exp-drilldown")).toBeVisible();
    }
  });

  it.each([failedSection, notRunSection, insufficientSection])("keeps the rest of a non-ok section usable ($status)", (section) => {
    const card = show(section);
    expect(card.querySelector(".exp-pin")).toBeNull();
    expect(within(card).getByTestId("exp-support")).toBeVisible();
    fireEvent.click(within(card).getByRole("button", { name: "How this works" }));
    expect(within(card).getByTestId("exp-how").textContent).toBe(config.experimental_how_it_works);
  });

  it("shows own trend domain, exact note, zero/null/omitted gaps and every supplied basis", () => {
    show(detailStressSection); const panel = openSpeaker(screen.getAllByRole("article")[0]);
    expect(within(panel).getByText(config.experimental_trend_note).textContent).toBe(config.experimental_trend_note);
    expect(within(panel).getByText("Weekly trend domain: 0–21")).toBeVisible();
    const chart = within(panel).getByRole("img", { name: /Weekly trend for me/ });
    expect(chart).toHaveAttribute("data-ymin", "0"); expect(chart).toHaveAttribute("data-ymax", "21");
    const path = chart.querySelector("path")?.getAttribute("d") ?? "";
    expect((path.match(/M/g) ?? [])).toHaveLength(2); expect((path.match(/L/g) ?? [])).toHaveLength(1);
    expect(within(panel).getByRole("row", { name: /2025-W42/ })).toHaveTextContent("No data supplied for this week");
    expect(within(panel).getByRole("row", { name: /2025-W41/ }).textContent).toBe("2025-W41fewer than 300 words or 3 episodes this week2201");
    expect(within(panel).getByRole("row", { name: /2025-W44/ }).textContent).toBe("2025-W4403333");
  });

  it("disclosures retain focus/expanded state and a unique controlled panel", () => {
    show(); const article = screen.getAllByRole("article")[0];
    const button = within(article).getAllByRole("button", { name: "Why this number" })[0];
    button.focus(); const panel = openSpeaker(article);
    expect(button).toHaveFocus(); expect(button).toHaveAttribute("aria-expanded", "true"); expect(panel).toBeVisible();
    fireEvent.click(button); expect(panel).not.toBeVisible(); expect(button).toHaveFocus();
    expect(panel.querySelector("table")).toBeNull();
  });
});

describe("experimental evidence boundaries and empty trends", () => {
  it("never substitutes a main-report quote for an unresolved experimental ID", () => {
    const report = structuredClone(plain) as unknown as Report;
    report.experimental_scores = structuredClone(realLikeSection);
    const main = report.quotes[0], speaker = report.experimental_scores.dimensions[0].per_speaker.me;
    speaker.quote_ids = [main.quote_id]; speaker.contributions.forEach((c) => c.quote_ids = []);
    speaker.contributions[0].quote_ids = [main.quote_id];
    render(<ReportView report={report} deleting={false} deleteError={null} trendNote={config.experimental_trend_note} onDelete={() => {}} />);
    const card = screen.getByRole("region", { name: "Experimental scores" });
    fireEvent.click(within(card).getByRole("button", { name: /Experimental scores/ }));
    const panel = openSpeaker(within(card).getAllByRole("article")[0]);
    expect(within(panel).getByText(`Quote evidence unavailable: ${main.quote_id}`)).toBeVisible();
    expect(panel.textContent).not.toContain(main.text);
  });
  it.each([{ trend: [] }, { trend: [point("2025-W40", null, 2, 55)] }])("retains empty/thin trend context without drawing a value", ({ trend }) => {
    const section = structuredClone(realLikeSection); section.dimensions[0].per_speaker.me.trend = trend;
    show(section); const panel = openSpeaker(screen.getAllByRole("article")[0]);
    expect(within(panel).getByText("No weekly trend.")).toBeVisible();
    expect(within(panel).getByText(config.experimental_trend_note)).toBeVisible();
    expect(panel.querySelector(".exp-spark")).toBeNull();
    if (trend.length) expect(within(panel).getByRole("row", { name: /2025-W40/ }).textContent).toBe("2025-W40thin week255");
  });
  it.each([0, 100])("renders the genuine endpoint %s without dropping its uncertainty", (score) => {
    const section = structuredClone(nullOtherSection); section.dimensions[0].per_speaker.me.score = score;
    section.dimensions[0].per_speaker.me.band = { lo: score, hi: score };
    show(section); const a = screen.getAllByRole("article")[0];
    expect(a.querySelector(".exp-pin")).toHaveStyle({ left: `${score}%` });
    expect(a.querySelector(".exp-score-num")).toHaveTextContent(String(score));
    expect(within(a).getByText(`Uncertainty band ${score}–${score}`)).toBeVisible();
  });
});

describe("experimental geometry and immutable ordering", () => {
  it("retains stable effective-weight ties without mutating registry order", () => {
    const items = structuredClone(realLikeSection.dimensions[0].per_speaker.me.contributions);
    items.forEach((c) => c.weight = 0);
    items[0].weight = 0.1; items[1].weight = 0.5; items[2].weight = 0.1;
    const before = items.map((x) => x.marker_key);
    expect(sortedContributions(items).map((x) => x.marker_key).slice(0,3)).toEqual([before[1], before[0], before[2]]);
    expect(items.map((x) => x.marker_key)).toEqual(before);
  });
  it.each([0,100])("accepts exact endpoint %s", (score) => {
    const s = { ...realLikeSection.dimensions[0].per_speaker.me, score, band: { lo: score, hi: score } };
    expect(hasScore(s)).toBe(true);
  });
  it.each([null,NaN,Infinity,-1,101])("rejects missing/nonfinite/out-of-domain %s", (score) => {
    expect(hasScore({ ...realLikeSection.dimensions[0].per_speaker.me, score })).toBe(false);
  });
  it.each(["not_run", "failed", "insufficient_data"] as const)("rejects stale score under %s", (status) => {
    expect(hasScore({ ...realLikeSection.dimensions[0].per_speaker.me, status })).toBe(false);
  });
  it("creates real missing ISO weeks, with no fabricated basis or zero", () => {
    const points = [point("2026-W02", 22), point("2025-W52", 20)];
    const model = experimentalTrend(points);
    expect(model.slots.map((s) => s.week)).toEqual(["2025-W52", "2026-W01", "2026-W02"]);
    expect(model.slots[1].point).toBeNull(); expect(model.domain).toEqual([20,22]);
    expect(points[0].week).toBe("2026-W02");
  });
  it.each([0,32,100])("centers a constant trend %s in a nondegenerate independent domain", (v) => {
    expect(experimentalTrend([point("2025-W40",v)]).domain).toEqual(v === 0 ? [0,1] : v === 100 ? [99,100] : [31,33]);
  });
  it("retains all-null weeks and basis without a numerical domain", () => {
    const model = experimentalTrend([point("2025-W40",null,1,20)]);
    expect(model.domain).toBeNull(); expect(model.slots[0].point?.n_words).toBe(20);
    expect(experimentalTrend([])).toEqual({ slots: [], domain: null });
  });
});
