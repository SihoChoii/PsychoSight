import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sample from '../../docs/sample_report.json';
import deterministic from '../../docs/sample_report_deterministic_only.json';
import { EpisodeSelection } from './components/report/EpisodeSelection';
import { buildSelectionModel, matrixHit, matrixLayout } from './selection/model';
import { SelectionMatrix } from './selection/canvas';
import type { Report } from './types';

const report = sample as Report;
afterEach(() => vi.unstubAllGlobals());
const mount = (value = report) => {
  const explore = vi.fn();
  const result = render(<EpisodeSelection report={value} onExplore={explore} />);
  return { ...result, explore, section: screen.getByRole('region', { name: 'Episodes behind the scores' }) };
};
describe('episode selection map', () => {
  it('uses real selection membership, without treating pooled episodes as excluded or selected as successful scores', () => {
    const model = buildSelectionModel(report.episodes);
    expect(model.counts).toEqual({ top_signal: 24, random: 16, unclassified: 0, unselected: 151 });
    expect(model.selected).toBe(40);
    expect(model.items.filter(i => i.episode.pooled && i.category !== 'unselected').length).toBeGreaterThan(0);
    const modified = structuredClone(report.episodes!);
    modified[0] = { ...modified[0], scored: false, selection: 'random' };
    modified[1] = { ...modified[1], scored: true, selection: null };
    const next = buildSelectionModel(modified);
    expect(next.items.find(i => i.episode.episode_id === modified[0].episode_id)?.category).toBe('unselected');
    expect(next.items.find(i => i.episode.episode_id === modified[1].episode_id)?.category).toBe('unclassified');
  });
  it('previews categories, restores a pin after pointer exit, and clears it with Escape', () => {
    const { section } = mount();
    const high = screen.getByRole('button', { name: /24 highest-signal/ }), random = screen.getByRole('button', { name: /16 random sample/ });
    fireEvent.pointerEnter(high, { pointerType: 'mouse' });
    expect(section).toHaveAttribute('data-highlight', 'top_signal');
    fireEvent.pointerLeave(high); expect(section).toHaveAttribute('data-highlight', 'none');
    fireEvent.click(random); expect(random).toHaveAttribute('aria-pressed', 'true');
    fireEvent.pointerEnter(high); expect(section).toHaveAttribute('data-highlight', 'top_signal');
    fireEvent.pointerLeave(high); expect(section).toHaveAttribute('data-highlight', 'random');
    fireEvent.keyDown(random, { key: 'Escape' }); expect(section).toHaveAttribute('data-highlight', 'none');
  });
  it('filters the accessible list, pins exact metadata, and explores the original episode', () => {
    const { explore, container } = mount();
    fireEvent.click(screen.getByRole('button', { name: /16 random sample/ }));
    fireEvent.click(screen.getByText('Browse episodes'));
    const items = screen.getAllByRole('listitem'); expect(items).toHaveLength(16);
    const first = report.episodes!.filter(e => e.selection === 'random')[0];
    fireEvent.click(within(items[0]).getByRole('button'));
    expect(container.querySelector('.selection-readout')).toHaveAttribute('data-episode-id', first.episode_id);
    expect(container.querySelector('.selection-readout-counts')).toHaveTextContent(`${first.messages.me + first.messages.other} messages`);
    fireEvent.click(screen.getByRole('button', { name: 'Explore episode' })); expect(explore).toHaveBeenCalledWith(first);
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(container.querySelector('.selection-readout')).toHaveAttribute('data-episode-id', '');
  });
  it('keeps large lists paginated and keyboard inspection reaches the final actual episode', () => {
    const { container } = mount();
    fireEvent.click(screen.getByText('Browse episodes'));
    expect(screen.getAllByRole('listitem')).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' })); expect(screen.getByText('2 / 8')).toBeInTheDocument();
    const canvas = screen.getByRole('img', { name: /Episode selection map/ });
    fireEvent.keyDown(canvas, { key: 'End' }); fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(container.querySelector('.selection-readout')).toHaveAttribute('data-episode-id', report.episodes!.at(-1)!.episode_id);
  });
  it('shows zero selected honestly when scoring was not run', () => {
    const { section } = mount(deterministic as Report);
    expect(screen.getByRole('button', { name: /0 highest-signal/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /0 random sample/ })).toBeDisabled();
    expect(section).toHaveTextContent('Rubric scoring was not run');
    expect(section).toHaveTextContent('0 selected');
  });
  it('distinguishes missing indexes and empty reports without inventing squares', () => {
    const value = { ...report, episodes: undefined }; const { rerender } = mount(value);
    expect(screen.getByText(/index is unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    rerender(<EpisodeSelection report={{ ...value, episodes: [] }} onExplore={vi.fn()} />);
    expect(screen.getByText('No episodes to display.')).toBeInTheDocument();
  });
  it('maps hit positions to chronological episodes across scrolling and responsive widths', () => {
    for (const width of [272, 342, 700, 900]) {
      const layout = matrixLayout(width, 10000);
      for (const index of [0, 25, 9999]) {
        const x = 4 + (index % layout.columns + .5) * layout.pitch;
        const y = 8 + (Math.floor(index / layout.columns) + .5) * layout.pitch;
        expect(matrixHit(x, y, width, 10000)).toBe(index);
      }
      expect(matrixHit(-1, 0, width, 10000)).toBeNull();
      expect(matrixHit(width, layout.height, width, 10000)).toBeNull();
    }
  });
  it('preserves initial interaction, then replays only after a full viewport exit', () => {
    let enter!: IntersectionObserverCallback;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { enter = callback; }
      observe() {} disconnect() {}
    });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const canvas = document.createElement('canvas'), scroller = document.createElement('div'), space = document.createElement('div');
    scroller.append(space); space.append(canvas); document.body.append(scroller);
    const phase = vi.fn(), engine = new SelectionMatrix(canvas, scroller, space, buildSelectionModel(report.episodes), vi.fn(), phase);
    engine.setHighlight('random');
    enter([{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(phase).toHaveBeenCalledWith('complete');
    expect(phase).not.toHaveBeenCalledWith('revealing');
    enter([{ isIntersecting: true, intersectionRatio: .1 } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(phase).toHaveBeenLastCalledWith('complete');
    enter([{ isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(phase).toHaveBeenLastCalledWith('waiting');
    // Selecting through the list while the map is offscreen must not consume its replay.
    engine.setSelected(3);
    expect(phase).toHaveBeenLastCalledWith('waiting');
    enter([{ isIntersecting: true, intersectionRatio: .1 } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(phase).toHaveBeenLastCalledWith('waiting');
    enter([{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(phase).toHaveBeenLastCalledWith('revealing');
    // An intersection update during the same visit must not restart a completed reveal.
    engine.setSelected(3);
    enter([{ isIntersecting: true, intersectionRatio: .5 } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(phase).toHaveBeenLastCalledWith('complete');
    engine.destroy(); scroller.remove();
  });
});
