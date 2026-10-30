import { ApiError } from "../api";
import type { MessagePage, Report, TimelineMessage } from "../types";
/** Only mock routes use this local, synthetic fixture. Never interpolate real message times or text. */
export async function mockMessagePage(report: Report, episodeId: string, offset = 0, range?: {
    start: number;
    end: number;
}): Promise<MessagePage> {
    const episode = report.episodes?.find(e => e.episode_id === episodeId);
    if (!episode)
        throw new ApiError("NOT_FOUND", "This episode is not in the saved report.", 404);
    let messages: TimelineMessage[];
    if (episodeId.startsWith('ep-')) {
        const data = (await import('./timeline-messages.json')).default as Record<string, (string | number)[][]>;
        const rows = data[episodeId];
        if (!rows || rows[0]?.[1] !== episode.start || rows.at(-1)?.[1] !== episode.end)
            throw new ApiError('TIMELINE_UNAVAILABLE', 'This saved demo does not have a matching message fixture.', 409);
        messages = rows.map(([id, timestamp, speaker, text, turn]) => ({ id: String(id), timestamp: String(timestamp), speaker: speaker as 'me' | 'other', text: String(text), episode_id: episodeId, turn_id: `${episodeId}-turn-${turn}` }));
    }
    else {
        // UI-only stress episodes explicitly use synthetic messages, with exact per-speaker counts.
        const count = episode.messages.me + episode.messages.other, start = Date.parse(episode.start), span = Date.parse(episode.end) - start;
        const sides: ('me' | 'other')[] = [];
        let me = episode.messages.me, other = episode.messages.other;
        while (me || other) {
            if (me) {
                sides.push('me');
                me--;
            }
            if (other) {
                sides.push('other');
                other--;
            }
        }
        messages = sides.map((speaker, i) => ({ id: `${episodeId}-message-${i}`, timestamp: new Date(start + span * i / Math.max(1, count - 1)).toISOString(), speaker, text: `Synthetic message ${i + 1} for timeline interaction testing.`, episode_id: episodeId, turn_id: `${episodeId}-turn-${i + 1}` }));
    }
    if (range)
        messages = messages.filter(m => Date.parse(m.timestamp) >= range.start && Date.parse(m.timestamp) < range.end);
    return { episode_id: episodeId, total: messages.length, offset, next_offset: offset + 500 < messages.length ? offset + 500 : null, messages: messages.slice(offset, offset + 500) };
}
