import { describe, expect, it } from "vitest";
import { buildTimelineModel, detailMix, fitCamera, nearestEpisode, panCamera, stageCamera, visibleEpisodes, zoomCamera } from "./model";
import { uiPreviewReport } from "../fixtures/ui-previews";
describe('continuous conversation timeline', () => {
    const report = uiPreviewReport('ui-260-weeks')!, model = buildTimelineModel(report);
    it('preserves every count at every overview resolution without inventing timestamps', () => {
        for (const bins of model.levels)
            for (const side of ['me', 'other'] as const)
                expect(bins.reduce((sum, b) => sum + b[side], 0)).toBe(report.header.message_counts[side]);
        expect(model.episodes.map(e => e.start)).toEqual(report.episodes!.map(e => Date.parse(e.start)));
    });
    it('keeps the pointer time fixed during zoom and reverses without drift', () => {
        const camera = { start: model.bounds.start + 100000000, end: model.bounds.end - 100000000 }, anchor = .71, point = camera.start + (camera.end - camera.start) * anchor;
        const zoom = zoomCamera(camera, .23, anchor, model.bounds);
        expect(zoom.start + (zoom.end - zoom.start) * anchor).toBeCloseTo(point, 2);
        const back = zoomCamera(zoom, 1 / .23, anchor, model.bounds);
        expect(back.start).toBeCloseTo(camera.start, 2);
        expect(back.end).toBeCloseTo(camera.end, 2);
    });
    it('clamps pan and zoom at both edges and always retains a positive range', () => {
        expect(panCamera(model.bounds, -1e20, model.bounds)).toEqual(model.bounds);
        const tiny = zoomCamera(model.bounds, 1e-30, .5, model.bounds);
        expect(tiny.end - tiny.start).toBe(30000);
        expect(fitCamera({ start: 0, end: 1e30 }, model.bounds)).toEqual(model.bounds);
    });
    it('exposes three continuous levels and targets real episodes from empty intervals', () => {
        expect(detailMix(model.bounds, model).level).toBe('overview');
        for (const level of ['episodes', 'messages'] as const) {
            const view = stageCamera(level, model.bounds, model);
            expect(detailMix(view, model).level).toBe(level);
            expect(visibleEpisodes(model, view).length).toBeGreaterThan(0);
        }
        const edge = model.episodeSpan;
        const before = detailMix({ start: 0, end: edge * .75001 }, model), after = detailMix({ start: 0, end: edge * .74999 }, model);
        expect(Math.abs(before.episodes - after.episodes)).toBeLessThan(.0001);
    });
    it('finds overlaps and point episodes using actual instants', () => {
        const report = uiPreviewReport('ui-episode-overlaps')!, m = buildTimelineModel(report), first = m.episodes[0];
        expect(visibleEpisodes(m, { start: first.start + 60000, end: first.start + 120001 }).map(e => e.episode.episode_id)).toEqual(['interval-1', 'interval-2', 'interval-3']);
        expect(nearestEpisode(m, first.start - 1e10)).toBe(first);
    });
    it('keeps missing intervals empty and supports reports without an episode index', () => {
        const report = uiPreviewReport('ui-omitted-weeks')!, m = buildTimelineModel(report);
        expect(m.levels[0].some(b => b.start > Date.parse('2025-08-18') && b.end < Date.parse('2025-08-25'))).toBe(false);
        delete report.episodes;
        const legacy = buildTimelineModel(report);
        expect(legacy.levels[0]).toHaveLength(report.weeks.length);
        expect(detailMix(stageCamera('messages', legacy.bounds, legacy), legacy).level).toBe('overview');
    });
});
