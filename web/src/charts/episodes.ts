import type { Episode, Quote } from "../types";

export function indexEpisodes(episodes: Episode[] | undefined, quotes: Quote[]) {
  const byId = new Map<string, Episode>();
  const byWeek = new Map<string, Episode[]>();
  const quotesByEpisode = new Map<string, Quote[]>();
  for (const episode of episodes ?? []) {
    byId.set(episode.episode_id, episode);
    const week = byWeek.get(episode.week) ?? [];
    week.push(episode); byWeek.set(episode.week, week);
  }
  for (const week of byWeek.values()) week.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.episode_id.localeCompare(b.episode_id));
  // Only the report's verified quote collection belongs in this inspector.
  for (const quote of quotes) {
    const list = quotesByEpisode.get(quote.episode_id) ?? [];
    list.push(quote); quotesByEpisode.set(quote.episode_id, list);
  }
  return { byId, byWeek, quotesByEpisode };
}
export type EpisodeIndex = ReturnType<typeof indexEpisodes>;

/** One lane per episode: overlap and zero duration never change an interval's x coordinates. */
export function episodeIntervals(episodes: Episode[]) {
  const valid = episodes.flatMap((episode) => {
    const start = Date.parse(episode.start), end = Date.parse(episode.end);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [{ episode, start, end }] : [];
  });
  if (!valid.length) return { start: 0, end: 0, rows: [] };
  let start = Infinity, last = -Infinity;
  for (const row of valid) { start = Math.min(start, row.start); last = Math.max(last, row.end); }
  const end = last === start ? start + 1000 : last;
  return { start, end, rows: valid.map((row, lane) => ({ ...row, lane,
    x1: (row.start - start) / (end - start), x2: (row.end - start) / (end - start),
  })) };
}

export function episodeSelection(episode: Episode): string {
  return episode.scored ? `Selected for scoring · ${episode.selection ?? "category not supplied"}`
    : `Not selected for scoring${episode.selection ? ` · supplied category: ${episode.selection}` : ""}`;
}
