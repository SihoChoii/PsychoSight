import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExperimentalScores } from "./components/ExperimentalScores";
import { experimentalTrend, hasScore, sortedContributions } from "./experimental";
import { detailStressSection, deterministicSection, realLikeSection, nullOtherSection, stubSection, failedSection, notRunSection, insufficientSection } from "./fixtures/experimental-samples";
import type { ExpTrendPoint, Report } from "./types";
import config from "./fixtures/mock-config.json";
import { ReportView } from "./components/ReportView";
import plain from "../../docs/sample_report.json";

function show(section = realLikeSection) {
  render(<ExperimentalScores section={section} trendNote={config.experimental_trend_note} />);
  return screen.getByRole("region", { name: "Experimental scores" });
}
function openDimension(article: HTMLElement) {
  const toggle = within(article).getByRole('button', { name: /evidence and trends/ });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
}
function openSpeaker(article: HTMLElement, index = 0, complete = true) {
  openDimension(article);
  fireEvent.click(within(article).getAllByRole('button', { name: /Why this number for/ })[index]);
  const panel = screen.getByRole('dialog', { name: 'Why this number' });
  if (complete) fireEvent.click(within(panel).getByRole('button', { name: /^All \d+ markers/ }));
  return panel;
}
function trendData(article: HTMLElement) {
  openDimension(article);
  fireEvent.click(within(article).getByRole('button', { name: 'View trend data' }));
  return screen.getByRole('dialog', { name: /trend data$/ });
}
const point = (week: string, score: number | null, episodes = 3, words = 300): ExpTrendPoint => ({ week, score, n_episodes: episodes, n_words: words, reason: score === null ? "thin week" : null });

describe("experimental comparison contract", () => {
  it("keeps labels, exact scores, bands and confidence in family order with evidence on demand", () => {
    const card = show();
    const articles = within(card).getAllByRole('article');
    expect(articles).toHaveLength(12);
    articles.forEach((article, i) => {
      const dim = realLikeSection.dimensions[i];
      expect(within(article).getByRole('heading', { name: dim.label })).toBeVisible();
      article.querySelectorAll<HTMLElement>('.exp-speaker').forEach(row => {
        const speaker = dim.per_speaker[row.dataset.speaker as 'me' | 'other']!;
        expect(row.querySelector('.exp-score-num')).toHaveTextContent(String(speaker.score));
        expect(row.querySelector('.exp-band-text')).toHaveTextContent(`Uncertainty band ${speaker.band?.lo}–${speaker.band?.hi}`);
        expect(row).toHaveTextContent(`Confidence ${speaker.confidence}`);
        expect(row.querySelector('.exp-bar')).toHaveAttribute('data-domain', '0,100');
      });
      openDimension(article);
      expect(within(article).getByText(dim.evidence_note)).toBeVisible();
      expect(within(article).getByText(`Evidence ${dim.evidence_strength.replaceAll('_', ' ')}`)).toBeVisible();
      for (const speaker of [dim.per_speaker.me, dim.per_speaker.other].filter(Boolean)) {
        expect(article).toHaveTextContent(`${speaker!.n_episodes.toLocaleString('en-US')} episodes / ${speaker!.n_words.toLocaleString('en-US')} words`);
      }
    });
    expect(card.querySelectorAll('.exp-pin-me')).toHaveLength(12);
    expect(card.querySelectorAll('.exp-pin-other')).toHaveLength(12);
    expect(card.querySelectorAll('.exp-meter')).toHaveLength(24);
    expect(within(card).getByTestId('exp-scale-note').textContent).toBe(config.experimental_scale_note);
  });

  it('omits null Other comparisons and its shape marks', () => {
    const card = show(nullOtherSection);
    expect(card.querySelector('[data-speaker=other]')).toBeNull();
    expect(card.querySelector('.exp-radar-other')).toBeNull();
    expect(card.querySelectorAll('.exp-radar-me-dot')).toHaveLength(5);
    expect(card.querySelector('.exp-radar-other-dot')).toBeNull();
  });

  it('shows the web immediately with the exact corresponding uncertainty intervals beside it', () => {
    const card = show();
    expect(within(card).getByRole('img', { name: /Big Five shape/ })).toBeVisible();
    expect(within(card).queryByRole('button', { name: 'Big Five shape' })).toBeNull();
    expect(card.querySelectorAll('.exp-radar-me-dot')).toHaveLength(5);
    expect(card.querySelectorAll('.exp-radar-other-dot')).toHaveLength(5);
    const bigFive = card.querySelector('.exp-family-big_five')!;
    expect(bigFive.querySelectorAll('.exp-band')).toHaveLength(10);
  });

  it('preserves exact observed precision, common-scale weights, sources, directions and stable ties in complete evidence', () => {
    const section = structuredClone(detailStressSection), speaker = section.dimensions[0].per_speaker.me;
    speaker.contributions.forEach(c => c.weight = 0); speaker.contributions[0].weight = .1; speaker.contributions[2].weight = .1;
    const before = JSON.stringify(section); show(section);
    const panel = openSpeaker(screen.getAllByRole('article')[0]);
    const rows = panel.querySelector('.exp-contribs')!.children;
    expect(rows[0]).toHaveAttribute('data-marker', speaker.contributions[0].marker_key);
    expect(rows[1]).toHaveAttribute('data-marker', speaker.contributions[2].marker_key);
    expect(rows[0].querySelector('.exp-weight-track > span')).toHaveStyle({ width: '10%' });
    expect(rows[1].querySelector('.exp-weight-track > span')).toHaveStyle({ width: '10%' });
    expect(within(panel).getByText(/Observed value: 0.123456789 /)).toBeVisible();
    expect(rows[0]).toHaveTextContent('Word count'); expect(rows[0]).toHaveTextContent('Raises the index');
    expect(rows[2]).toHaveTextContent('No data'); expect(rows[2]).toHaveTextContent('Observed value: unavailable');
    expect(JSON.stringify(section)).toBe(before);
  });

  it('retains unavailable AI markers and the supplied research citations without requests', () => {
    show(deterministicSection); const panel = openSpeaker(screen.getAllByRole('article')[0]);
    for (const row of panel.querySelectorAll('.exp-contribs [data-status=not_run]')) {
      expect(row).toHaveTextContent('Not run'); expect(row.querySelector('.exp-weight-track')).toBeNull();
    }
    expect(panel.querySelectorAll('.exp-contribs [data-status=not_run]').length).toBeGreaterThan(0);
    for (const citation of deterministicSection.dimensions[0].citations) {
      expect(panel).toHaveTextContent(citation.short);
      if (citation.doi) expect(within(panel).getByRole('link', { name: citation.doi })).toHaveAttribute('href', `https://doi.org/${citation.doi}`);
    }
  });

  it('resolves only experimental quotes, preserves exact whitespace and timestamps, and labels missing IDs', () => {
    show(detailStressSection); const panel = openSpeaker(screen.getAllByRole('article')[0]);
    const quote = detailStressSection.quotes.find(q => q.id === 'xq_ui_long')!;
    expect(panel.querySelector('[data-exp-quote-id=xq_ui_long] .exp-quote-text')?.textContent).toBe(quote.text);
    expect(panel.querySelector('[data-exp-quote-id=xq_ui_long] time')).toHaveAttribute('datetime', quote.ts);
    expect(within(panel).getByText('Quote evidence unavailable: xq_missing')).toBeVisible();
  });

  it('retains speaker union quotes even when no contribution refers to them', () => {
    const section = structuredClone(stubSection), speaker = section.dimensions[0].per_speaker.me, quote = section.quotes[0];
    speaker.quote_ids = [quote.id]; speaker.contributions.forEach(c => c.quote_ids = []);
    show(section); const panel = openSpeaker(screen.getAllByRole('article')[0]);
    expect(within(panel).getByText('Additional supplied evidence')).toBeVisible();
    expect(panel.querySelector('.exp-quote-text')?.textContent).toBe(quote.text);
  });

  it('keeps failed, not-run and thin speaker states and basis without numeric markers', () => {
    const card = show(detailStressSection), articles = within(card).getAllByRole('article');
    for (const index of [1,2,3]) {
      const row = articles[index].querySelector('[data-speaker=me]')!;
      expect(row.querySelector('.exp-pin')).toBeNull(); expect(row.querySelector('.exp-score-num')).toBeNull();
      expect(row.querySelector('.exp-state')).toBeVisible(); expect(row.querySelector('.exp-basis')).toBeVisible();
      const panel = openSpeaker(articles[index]);
      expect(panel.querySelector('.exp-contribution-score')).toHaveTextContent('—');
    }
  });

  it.each([failedSection, notRunSection, insufficientSection])('keeps non-ok section context and method available ($status)', section => {
    const card = show(section); expect(card.querySelector('.exp-pin')).toBeNull();
    expect(within(card).getByTestId('exp-support')).toBeVisible();
    fireEvent.click(within(card).getByRole('button', { name: 'How this works' }));
    expect(screen.getByTestId('exp-how').textContent).toBe(config.experimental_how_it_works);
  });

  it('preserves independent trend values, exact note, null and missing weeks and supplied basis', () => {
    const section = structuredClone(detailStressSection); section.dimensions[0].per_speaker.other = null;
    show(section); const article = screen.getAllByRole('article')[0]; openDimension(article);
    const chart = within(article).getByRole('img', { name: /Weekly trend comparison/ });
    expect(chart).toHaveAttribute('data-ymin', '0'); expect(chart).toHaveAttribute('data-ymax', '21');
    const path = chart.querySelector('path')?.getAttribute('d') ?? '';
    expect(path.match(/M/g)).toHaveLength(2); expect(path.match(/L/g)).toHaveLength(1);
    const panel = trendData(article);
    expect(within(panel).getByText(config.experimental_trend_note)).toBeVisible();
    expect(within(panel).getByRole('row', { name: /2025-W42/ })).toHaveTextContent('No data supplied for this week');
    expect(within(panel).getByRole('row', { name: /2025-W41/ })).toHaveTextContent('fewer than 300 words or 3 episodes this week2 episodes · 201 words');
    expect(within(panel).getByRole('row', { name: /2025-W44/ })).toHaveTextContent('03 episodes · 333 words');
  });

  it('keeps one controlled contribution card and restores focus when it closes', () => {
    show(); const article = screen.getAllByRole('article')[0]; openDimension(article);
    const button = within(article).getAllByRole('button', { name: /Why this number for/ })[0];
    button.focus(); const panel = openSpeaker(article, 0, false);
    expect(within(panel).getByRole('button', { name: 'Close explanation' })).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(button.getAttribute('aria-controls')!)).toBe(panel);
    fireEvent.click(within(panel).getByRole('button', { name: 'Close explanation' }));
    expect(panel).not.toBeInTheDocument(); expect(button).toHaveFocus();
  });
});

describe('experimental evidence boundaries and empty trends', () => {
  it('never substitutes a main-report quote for an unresolved experimental ID', () => {
    const report = structuredClone(plain) as Report; report.experimental_scores = structuredClone(realLikeSection);
    const main = report.quotes[0], speaker = report.experimental_scores.dimensions[0].per_speaker.me;
    speaker.quote_ids = [main.quote_id]; speaker.contributions.forEach(c => c.quote_ids = []); speaker.contributions[0].quote_ids = [main.quote_id];
    render(<ReportView report={report} deleting={false} deleteError={null} onDelete={() => {}} />);
    const card = screen.getByRole('region', { name: 'Experimental scores' }); const panel = openSpeaker(within(card).getAllByRole('article')[0]);
    expect(within(panel).getAllByText(`Quote evidence unavailable: ${main.quote_id}`).length).toBeGreaterThan(0);
    expect(panel.textContent).not.toContain(main.text);
  });
  it.each([{ trend: [] }, { trend: [point('2025-W40', null, 2, 55)] }])('retains empty and thin trend context without plotting a value', ({ trend }) => {
    const section = structuredClone(realLikeSection); section.dimensions[0].per_speaker.me.trend = trend; section.dimensions[0].per_speaker.other = null;
    show(section); const article = screen.getAllByRole('article')[0]; openDimension(article);
    expect(within(article).getByText('No weekly trend.')).toBeVisible(); expect(article.querySelector('.exp-spark')).toBeNull();
    const panel = trendData(article); expect(within(panel).getByText(config.experimental_trend_note)).toBeVisible();
    if (trend.length) expect(within(panel).getByRole('row', { name: /2025-W40/ })).toHaveTextContent('thin week2 episodes · 55 words');
  });
  it.each([0,100])('renders the genuine endpoint %s without dropping its uncertainty', score => {
    const section = structuredClone(nullOtherSection); section.dimensions[0].per_speaker.me.score = score; section.dimensions[0].per_speaker.me.band = { lo:score, hi:score };
    show(section); const article = screen.getAllByRole('article')[0];
    expect((article.querySelector('.exp-pin') as HTMLElement).style.getPropertyValue('--exp-score-position')).toBe(`${score}%`);
    expect(article.querySelector('.exp-score-num')).toHaveTextContent(String(score)); expect(article.querySelector('.exp-band-text')).toHaveTextContent(`band ${score}–${score}`);
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
