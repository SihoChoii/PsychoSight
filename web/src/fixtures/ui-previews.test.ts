import { describe, expect, it } from "vitest";
import fullSample from "../../../docs/sample_report.json";
import localSample from "../../../docs/sample_report_deterministic_only.json";
import { mockApi } from "../mock";
import mockConfig from "./mock-config.json";
import { PROGRESS_CASES, UI_REPORT_CASES, uiPreviewJob, uiPreviewReport } from "./ui-previews";

describe("reproducible UI previews", () => {
  it.each(UI_REPORT_CASES)("resolves %s with coherent report IDs, totals, dates, and episode references", async (name) => {
    const before = JSON.stringify([fullSample, localSample]);
    const id = `ui-${name}`;
    const report = uiPreviewReport(id);
    if (!report) throw new Error(`Missing preview ${id}`);
    expect(await mockApi.getReport(id)).toEqual(report);
    expect(report.report_id).toBe(id);
    expect(report.run_meta.run_id).toBe(id);
    expect(report.run_meta.mode).toBe(report.mode);
    expect(report.run_meta.llm_opt_in).toBe(report.mode === "full");
    expect(report.header.is_demo).toBe(true);
    expect(report.header.week_count).toBe(report.weeks.length);
    expect(report.header.episode_count).toBe(report.weeks.reduce((n, w) => n + w.episodes, 0));
    for (const who of ["me", "other"] as const) {
      expect(report.header.message_counts[who]).toBe(report.weeks.reduce((n, w) => n + w.messages[who], 0));
      expect(report.header.word_counts?.[who]).toBe(report.weeks.reduce((n, w) => n + w.words[who], 0));
    }
    const weeks = new Set(report.weeks.map((w) => w.week));
    if (report.episodes) {
      expect(new Set(report.episodes.map((e) => e.episode_id)).size).toBe(report.episodes.length);
      expect(report.episodes).toHaveLength(report.header.episode_count);
      expect(report.episodes.filter((e) => e.scored)).toHaveLength(report.header.episodes_scored);
      for (const week of report.weeks) {
        const episodes = report.episodes.filter((e) => e.week === week.week);
        expect(episodes).toHaveLength(week.episodes);
        for (const who of ["me", "other"] as const) {
          expect(episodes.reduce((n, e) => n + e.words[who], 0)).toBe(week.words[who]);
          expect(episodes.reduce((n, e) => n + e.messages[who], 0)).toBe(week.messages[who]);
        }
      }
    }
    for (const feature of report.series) {
      for (const point of feature.points) {
        expect(weeks.has(point.week)).toBe(true);
        for (const value of [point.me, point.other]) {
          if (value.value === null) expect(value.reason).toBe("insufficient data");
          else expect(Number.isFinite(value.value)).toBe(true);
        }
      }
    }
    expect(JSON.stringify([fullSample, localSample])).toBe(before);
  });

  it("supplies zero rates, all-null word rates, and thin/single-week cases without stale totals", () => {
    const zero = uiPreviewReport("ui-zero");
    const missing = uiPreviewReport("ui-null");
    for (const key of ["absolutist_pct", "i_pct", "we_pct"]) {
      expect(zero?.series.find((s) => s.key === key)?.points.every((p) => p.me.value === 0 && p.other.value === 0)).toBe(true);
      expect(missing?.series.find((s) => s.key === key)?.overall.me).toEqual({ value: null, count: 80, reason: "insufficient data" });
    }
    expect(uiPreviewReport("ui-thin")?.header.episode_count).toBe(1);
    expect(uiPreviewReport("ui-single-week")?.header.message_counts).toEqual({ me: 12, other: 12 });
    // Supplied initiation count is opened episodes, not its percentage denominator.
    expect(uiPreviewReport("ui-single-week")?.series.find((s) => s.key === "initiation_pct")?.overall.me)
      .toEqual({ value: 50, count: 3 });
  });

  it("preserves real calendar gaps, differing feature keys, and independently specified long-range dates", () => {
    const gaps = uiPreviewReport("ui-omitted-weeks");
    expect(gaps?.weeks.map((w) => w.week)).toEqual(["2025-W32", "2025-W33", "2025-W36", "2025-W38"]);
    expect(gaps?.series.find((s) => s.key === "i_pct")?.points.map((p) => p.week)).toEqual(["2025-W32", "2025-W36", "2025-W38"]);
    expect(uiPreviewReport("ui-104-weeks")?.header).toMatchObject({ week_count: 104, date_from: "2025-08-04", date_to: "2027-08-01" });
    expect(uiPreviewReport("ui-260-weeks")?.header).toMatchObject({ week_count: 260, date_to: "2030-07-28" });
  });

  it("keeps absence distinct from empty, selection distinct from success, and provider provenance explicit", () => {
    expect(uiPreviewReport("ui-absent-episodes")).not.toHaveProperty("episodes");
    expect(uiPreviewReport("ui-pooled-selected")?.episodes?.some((e) => e.pooled && e.scored && e.selection)).toBe(true);
    expect(uiPreviewReport("ui-provider-note")?.run_meta).toMatchObject({ provider: "mock", provider_note: mockConfig.demo_provider_note });
    expect(uiPreviewReport("ui-long-labels")?.header.conversation_label.length).toBeGreaterThan(100);
    expect(uiPreviewReport("ui-unknown")).toBeNull();
  });

  it.each(Object.keys(PROGRESS_CASES))("returns an isolated stable %s progress payload", (name) => {
    const first = uiPreviewJob(name);
    const expected = structuredClone(first);
    first.progress.current = 999;
    expect(uiPreviewJob(name)).toEqual(expected);
    expect(expected.progress.current).toBeLessThanOrEqual(expected.progress.total);
  });

  it.each(["done", "local-done"])("resolves %s to a valid report through the mock client", async (name) => {
    window.history.replaceState(null, "", `/?mock=1&freeze=${name}#/run/preview`);
    const job = await mockApi.getAnalysis("preview");
    const report = await mockApi.getReport("preview");
    expect(job.status).toBe("done");
    expect(report).toMatchObject({ report_id: "preview", mode: job.mode });
    expect(report.weeks.length).toBeGreaterThan(0);
    expect(report.run_meta.llm_opt_in).toBe(job.mode === "full");
  });

  it.each([["transport-error", "NETWORK_ERROR"], ["missing", "NOT_FOUND"]])("exposes %s as a retrieval failure", async (name, code) => {
    window.history.replaceState(null, "", `/?mock=1&freeze=${name}`);
    await expect(mockApi.getAnalysis("preview")).rejects.toMatchObject({ code });
  });
});
