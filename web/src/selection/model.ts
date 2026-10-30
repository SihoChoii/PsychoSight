import type { Episode } from '../types';

export type SelectionCategory = 'top_signal' | 'random' | 'unclassified' | 'unselected';
export type HighlightCategory = SelectionCategory | 'all' | null;
export const categoryLabel: Record<SelectionCategory, string> = {
  top_signal: 'Highest-signal', random: 'Random sample',
  unclassified: 'Selection type unavailable', unselected: 'Not selected for scoring',
};
export function selectionCategory(episode: Episode): SelectionCategory {
  if (!episode.scored) return 'unselected';
  return episode.selection === 'top_signal' || episode.selection === 'random' ? episode.selection : 'unclassified';
}
export function buildSelectionModel(episodes: Episode[] = []) {
  const rows = [...episodes].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.episode_id.localeCompare(b.episode_id));
  const counts: Record<SelectionCategory, number> = { top_signal: 0, random: 0, unclassified: 0, unselected: 0 };
  const items = rows.map((episode, index) => {
    const category = selectionCategory(episode), rank = counts[category]++;
    return { episode, category, index, rank };
  });
  return { items, counts, selected: rows.length - counts.unselected };
}
export type SelectionModel = ReturnType<typeof buildSelectionModel>;
export function matrixLayout(width: number, count: number) {
  const columns = Math.max(1, Math.floor((width - 8) / 28));
  const pitch = (width - 8) / columns, rows = Math.ceil(count / columns);
  return { columns, pitch, size: Math.min(17, pitch - 10), height: Math.max(224, rows * pitch + 16) };
}
export function matrixHit(x: number, y: number, width: number, count: number) {
  const { columns, pitch } = matrixLayout(width, count);
  const col = Math.floor((x - 4) / pitch), row = Math.floor((y - 8) / pitch), index = row * columns + col;
  return x >= 4 && col >= 0 && col < columns && row >= 0 && index < count ? index : null;
}
