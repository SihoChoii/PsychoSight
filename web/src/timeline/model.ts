import type { Episode, Report, TimelineMessage, Week } from "../types";
export const DAY = 86400000;
export const HOUR = 3600000;
export type Level = "overview" | "episodes" | "messages";
export interface Camera {
    start: number;
    end: number;
}
export interface TimedEpisode {
    start: number;
    end: number;
    episode: Episode;
}
export interface TimedMessage {
    time: number;
    message: TimelineMessage;
}
export interface BlockBin {
    start: number;
    end: number;
    me: number;
    other: number;
    weeks: Week[];
}
export type Selection = {
    type: "block";
    bin: BlockBin;
} | {
    type: "episode";
    item: TimedEpisode;
} | {
    type: "message";
    item: TimedMessage;
};
export interface TimelineModel {
    bounds: Camera;
    episodes: TimedEpisode[];
    ends: number[];
    levels: BlockBin[][];
    episodeSpan: number;
    messageSpan: number;
    baseInterval: number;
    units: Map<BlockBin[], number>;
}
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export function lowerBound<T>(rows: readonly T[], value: number, key: (row: T) => number): number {
    let lo = 0, hi = rows.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (key(rows[mid]) < value)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo;
}
export function buildTimelineModel(report: Pick<Report, "weeks" | "episodes">): TimelineModel {
    const weeks = report.weeks.map(w => ({ start: Date.parse(`${w.start_date}T00:00:00`), end: new Date(new Date(`${w.end_date}T00:00:00`).setDate(new Date(`${w.end_date}T00:00:00`).getDate() + 1)).getTime(), me: w.messages.me, other: w.messages.other, weeks: [w] })).filter(w => Number.isFinite(w.start) && w.end > w.start).sort((a, b) => a.start - b.start);
    const episodes = (report.episodes ?? []).map(episode => ({ start: Date.parse(episode.start), end: Date.parse(episode.end), episode })).filter(e => Number.isFinite(e.start) && Number.isFinite(e.end) && e.end >= e.start).sort((a, b) => a.start - b.start || a.episode.episode_id.localeCompare(b.episode.episode_id));
    let end = weeks.at(-1)?.end ?? episodes.at(-1)?.end ?? DAY, start = weeks[0]?.start ?? episodes[0]?.start ?? 0;
    const ends = episodes.map(e => { end = Math.max(end, e.end + 1); start = Math.min(start, e.start); return e.end; });
    for (let i = 1; i < ends.length; i++)
        ends[i] = Math.max(ends[i], ends[i - 1]);
    end = Math.max(end, start + 60000);
    // Prefer daily episode-start groups when the index accounts for every message.
    // Never spread aggregate counts into invented individual message timestamps.
    const complete = episodes.length > 0 && (['me', 'other'] as const).every(side => episodes.reduce((n, e) => n + e.episode.messages[side], 0) === weeks.reduce((n, w) => n + w[side], 0));
    let base = weeks, baseInterval = 7 * DAY;
    if (complete) {
        const days = new Map<number, BlockBin>(), byWeek = new Map(report.weeks.map(w => [w.week, w]));
        for (const e of episodes) {
            const d = new Date(e.start);
            d.setHours(0, 0, 0, 0);
            const start = d.getTime();
            d.setDate(d.getDate() + 1);
            const end = d.getTime(), old = days.get(start), week = byWeek.get(e.episode.week);
            if (old) {
                old.me += e.episode.messages.me;
                old.other += e.episode.messages.other;
                if (week && !old.weeks.includes(week))
                    old.weeks.push(week);
            }
            else
                days.set(start, { start, end, ...e.episode.messages, weeks: week ? [week] : [] });
        }
        base = [...days.values()];
        baseInterval = DAY;
    }
    const levels: BlockBin[][] = [base];
    for (let size = 2 * baseInterval; levels.at(-1)!.length > 1; size *= 2) {
        const bins = new Map<number, BlockBin>();
        for (const w of base) {
            const bucket = Math.floor((w.start - start) / size), old = bins.get(bucket);
            if (old) {
                old.end = Math.max(old.end, w.end);
                old.me += w.me;
                old.other += w.other;
                old.weeks.push(...w.weeks);
            }
            else
                bins.set(bucket, { ...w, weeks: [...w.weeks] });
        }
        levels.push([...bins.values()]);
    }
    const units = new Map(levels.map(bins => [bins, Math.max(1, Math.ceil(bins.reduce((v, b) => Math.max(v, b.me, b.other), 0) / 9))]));
    const episodeSpan = Math.min(21 * DAY, (end - start) * .35);
    return { bounds: { start, end }, episodes, ends, levels, episodeSpan, messageSpan: Math.min(6 * HOUR, episodeSpan / 12), baseInterval, units };
}
export function fitCamera(camera: Camera, bounds: Camera): Camera {
    const span = clamp(camera.end - camera.start, Math.min(30000, bounds.end - bounds.start), bounds.end - bounds.start);
    const start = clamp(camera.start, bounds.start, bounds.end - span);
    return { start, end: start + span };
}
export function zoomCamera(camera: Camera, factor: number, anchor: number, bounds: Camera): Camera {
    const ratio = clamp(anchor, 0, 1), point = camera.start + (camera.end - camera.start) * ratio;
    const span = clamp((camera.end - camera.start) * factor, Math.min(30000, bounds.end - bounds.start), bounds.end - bounds.start);
    return fitCamera({ start: point - span * ratio, end: point + span * (1 - ratio) }, bounds);
}
export function panCamera(camera: Camera, delta: number, bounds: Camera): Camera { const movement = clamp(delta, bounds.start - camera.start, bounds.end - camera.end); return fitCamera({ start: camera.start + movement, end: camera.end + movement }, bounds); }
const smooth = (v: number) => { const x = clamp(v, 0, 1); return x * x * (3 - 2 * x); };
export function detailMix(camera: Camera, model: TimelineModel) {
    const span = camera.end - camera.start;
    const episodes = model.episodes.length ? smooth(Math.log2(model.episodeSpan / span) + 1) : 0;
    const messages = smooth(Math.log2(model.messageSpan / span) + 1) * episodes;
    return { overview: 1 - episodes, episodes: episodes * (1 - messages), messages, level: (messages >= .5 ? "messages" : episodes >= .5 ? "episodes" : "overview") as Level };
}
export function visibleEpisodes(model: TimelineModel, camera: Camera): TimedEpisode[] {
    const from = lowerBound(model.ends, camera.start, n => n), to = lowerBound(model.episodes, camera.end, e => e.start);
    return model.episodes.slice(from, to).filter(e => e.end >= camera.start);
}
export function nearestEpisode(model: TimelineModel, time: number): TimedEpisode | undefined {
    const i = lowerBound(model.episodes, time, e => e.start), a = model.episodes[i - 1], b = model.episodes[i];
    return !a ? b : !b ? a : Math.abs(time - (a.start + a.end) / 2) <= Math.abs(time - (b.start + b.end) / 2) ? a : b;
}
export function stageCamera(level: Level, camera: Camera, model: TimelineModel, selected?: Selection | null): Camera {
    if (level === "overview")
        return { ...model.bounds };
    const point = selected?.type === "message" ? selected.item.time : selected?.type === "episode" ? (selected.item.start + selected.item.end) / 2 : selected?.type === "block" ? (selected.bin.start + selected.bin.end) / 2 : (camera.start + camera.end) / 2;
    const ep = nearestEpisode(model, point);
    if (!ep)
        return { ...camera };
    const center = (ep.start + ep.end) / 2;
    const span = level === "episodes" ? Math.min(36 * HOUR, model.episodeSpan * .55) : Math.max(120000, Math.min(model.messageSpan * .45, (ep.end - ep.start) * 1.5));
    return fitCamera({ start: center - span / 2, end: center + span / 2 }, model.bounds);
}
export function blockLevel(model: TimelineModel, camera: Camera, width: number) {
    const span = camera.end - camera.start, capacity = Math.max(8, Math.floor(width / 14));
    let index = 0;
    while (index < model.levels.length - 1 && span / (model.baseInterval * 2 ** index) > capacity)
        index++;
    return model.levels[index];
}
export function visibleMessages(messages: TimedMessage[], camera: Camera): TimedMessage[] {
    return messages.slice(lowerBound(messages, camera.start, m => m.time), lowerBound(messages, camera.end, m => m.time));
}
export function tickLabels(camera: Camera, width: number): {
    time: number;
    label: string;
}[] {
    const span = camera.end - camera.start, count = Math.max(2, Math.min(7, Math.floor(width / 130))), result: {
        time: number;
        label: string;
    }[] = [];
    if (span > 2 * DAY) {
        const date = new Date(camera.start);
        date.setHours(0, 0, 0, 0);
        const months = span / count > 21 * DAY, monthStep = Math.max(1, Math.ceil(span / count / (30 * DAY))), dayStep = span / count > 4 * DAY ? 7 : Math.max(1, Math.ceil(span / count / DAY));
        if (months) {
            date.setDate(1);
            date.setMonth(date.getMonth() + 1);
        }
        else if (dayStep === 7)
            date.setDate(date.getDate() + (8 - date.getDay()) % 7);
        else
            date.setDate(date.getDate() + 1);
        while (date.getTime() < camera.end) {
            if (date.getTime() >= camera.start)
                result.push({ time: date.getTime(), label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(span > 180 * DAY ? { year: '2-digit' as const } : {}) }) });
            if (months)
                date.setMonth(date.getMonth() + monthStep);
            else
                date.setDate(date.getDate() + dayStep);
        }
        return result;
    }
    const step = [1000, 5000, 15000, 30000, 60000, 300000, 900000, 1800000, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY].find(s => span / s <= count) ?? DAY;
    for (let t = Math.ceil(camera.start / step) * step; t < camera.end; t += step)
        result.push({ time: t, label: new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', ...(span < 120000 ? { second: '2-digit' as const } : {}) }) });
    return result;
}
