import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Episode, Report } from '../../types';
import { buildSelectionModel, categoryLabel, type HighlightCategory } from '../../selection/model';
import { ReportDisclosure, dismissReportLayers } from './ReportDisclosure';
import { SelectionMatrix } from '../../selection/canvas';

const number = (value: number) => value.toLocaleString();
const date = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

export function EpisodeSelection({ report, onExplore }: { report: Report; onExplore: (episode: Episode) => void }) {
  const model = useMemo(() => buildSelectionModel(report.episodes), [report.episodes]);
  const [hoverCategory, setHoverCategory] = useState<HighlightCategory>(null);
  const [focusCategory, setFocusCategory] = useState<HighlightCategory>(null);
  const [pinnedCategory, setPinnedCategory] = useState<HighlightCategory>(null);
  const [preview, setPreview] = useState<number | null>(null), [pinned, setPinned] = useState<number | null>(null);
  const [phase, setPhase] = useState<'waiting' | 'revealing' | 'complete'>('waiting');
  const [announcement, setAnnouncement] = useState('');
  const [page, setPage] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null), scroller = useRef<HTMLDivElement>(null), space = useRef<HTMLDivElement>(null);
  const engine = useRef<SelectionMatrix | null>(null);
  const title = useId(), help = useId();
  const active = hoverCategory ?? focusCategory ?? pinnedCategory;
  const inspected = model.items[preview ?? pinned ?? -1];
  const cap = report.run_meta.thresholds?.max_episodes_scored;
  const matches = useMemo(() => active === null || active === 'all' ? model.items : model.items.filter(item => item.category === active), [model, active]);
  const pageCount = Math.max(1, Math.ceil(matches.length / 25)), currentPage = Math.min(page, pageCount - 1);
  const idleMessage = report.rubric.status === 'not_run' ? 'Rubric scoring was not run for this report.' : null;

  function inspect(index: number | null, pin: boolean, keyboard = false) {
    if (pin) { setPinned(index); setPreview(null); }
    else setPreview(index);
    if (pin || keyboard) {
      const item = index === null ? undefined : model.items[index];
      setAnnouncement(item ? `${item.episode.episode_id}. ${categoryLabel[item.category]}. ${date(item.episode.start)}. ${number(item.episode.messages.me + item.episode.messages.other)} messages.${pin ? ' Pinned.' : ''}` : 'Episode selection cleared.');
    }
  }
  const inspectRef = useRef(inspect); inspectRef.current = inspect;
  useEffect(() => {
    if (!canvas.current || !scroller.current || !space.current || !model.items.length) return;
    const matrix = new SelectionMatrix(canvas.current, scroller.current, space.current, model, (...args) => inspectRef.current(...args), setPhase);
    engine.current = matrix;
    return () => { matrix.destroy(); engine.current = null; };
  }, [model]);
  useEffect(() => { engine.current?.setHighlight(active); }, [active]);
  useEffect(() => { engine.current?.setSelected(pinned); }, [pinned]);
  useEffect(() => { setPage(0); }, [active]);

  const legend: { key: Exclude<HighlightCategory, null>; count: number; label: string; description: string }[] = [
    { key: 'all', count: model.items.length, label: 'episodes', description: 'One square per episode, in time order' },
    { key: 'top_signal', count: model.counts.top_signal, label: 'highest-signal', description: 'Length, emotional and absolute wording' },
    { key: 'random', count: model.counts.random, label: 'random sample', description: 'Sampled from the remaining eligible episodes' },
    ...(model.counts.unclassified ? [{ key: 'unclassified' as const, count: model.counts.unclassified, label: 'other selected', description: 'Selection type was not saved' }] : []),
  ];
  if (!model.items.length) return <section className="episode-selection-empty" aria-labelledby={title}><h3 id={title}>Episodes behind the scores</h3><p>{report.episodes ? 'No episodes to display.' : 'The episode index is unavailable in this saved report.'}</p></section>;

  return <section className="episode-selection" aria-labelledby={title} data-highlight={active ?? 'none'} data-reveal={phase}
    onKeyDown={event => { if (event.key === 'Escape') { setPinnedCategory(null); setHoverCategory(null); setFocusCategory(null); inspect(null, true); } }}>
    <div className="selection-heading"><h3 id={title}>Episodes behind the scores</h3><p>{model.selected ? 'Selected from this conversation for rubric scoring.' : 'The episode index for this conversation.'}</p></div>
    <div className="selection-layout">
      <div className="selection-plot">
        <div className="selection-matrix-scroll" ref={scroller}><div className="selection-matrix-space" ref={space}>
          <canvas ref={canvas} className="selection-matrix" role="img" tabIndex={0} aria-label={`Episode selection map: ${number(model.items.length)} episodes, ${number(model.selected)} selected. Use arrow keys to inspect, Enter to pin, Escape to clear.`} aria-describedby={help} />
        </div></div>
        <div className="selection-inspection">
          <div className="selection-readout" hidden={!inspected && !idleMessage} data-preview={pinned === null && preview !== null} tabIndex={-1} data-episode-id={inspected?.episode.episode_id ?? ''}>
            {inspected ? <><div><p className="selection-readout-label"><span className={`selection-swatch selection-swatch-${inspected.category}`} aria-hidden="true"/>{categoryLabel[inspected.category]}<span>{inspected.episode.episode_id}</span></p>
              <p className="selection-readout-date">{date(inspected.episode.start)}</p>
              <p className="selection-readout-counts">{number(inspected.episode.messages.me + inspected.episode.messages.other)} messages <span>Me {number(inspected.episode.messages.me)} · Other {number(inspected.episode.messages.other)}</span></p></div>
              {pinned !== null ? <div className="selection-readout-actions"><button type="button" onClick={() => { dismissReportLayers(); onExplore(inspected.episode); }}>Explore episode</button><button type="button" onClick={() => inspect(null, true)}>Clear selection</button></div> : null}</>
              : idleMessage ? <p className="selection-idle">{idleMessage}</p> : null}
          </div>
        </div>
        <div className="selection-plot-footer">
          <p className="selection-hint">Hover to explore. Click to keep a selection.<span className="selection-scroll-hint"> Scroll to see every episode.</span></p>
          <div className="selection-disclosures">
            <ReportDisclosure label="Browse episodes">
              { <div className="selection-browser"><p>{number(matches.length)} episodes{active && active !== 'all' ? ' in this category' : ''}</p>
                <ol>{matches.slice(currentPage * 25, (currentPage + 1) * 25).map(item => <li key={item.episode.episode_id}><button type="button" aria-pressed={pinned === item.index} onClick={() => { inspect(item.index, true); dismissReportLayers(); window.requestAnimationFrame(() => { const readout = canvas.current?.closest('.episode-selection')?.querySelector<HTMLElement>('.selection-readout'); readout?.focus({preventScroll:true}); readout?.scrollIntoView?.({block:'nearest',behavior:'instant'}); }); }}><span>{date(item.episode.start)}</span><span>{item.episode.episode_id} · {categoryLabel[item.category]} · {number(item.episode.messages.me + item.episode.messages.other)} messages</span></button></li>)}</ol>
                {pageCount > 1 ? <div className="selection-pagination"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</button><span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next page</button></div> : null}
              </div>}
            </ReportDisclosure>
          </div>
        </div>
      </div>
      <div className="selection-legend" role="group" aria-label="Highlight episode types">
        {legend.map(item => <button key={item.key} type="button" className={`selection-category selection-category-${item.key}`}
          aria-pressed={pinnedCategory === item.key} disabled={!item.count} data-active={active === item.key}
          onPointerEnter={event => { if (event.pointerType !== 'touch') setHoverCategory(item.key); }} onPointerLeave={() => setHoverCategory(null)}
          onPointerDown={() => setFocusCategory(null)} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setFocusCategory(item.key); }} onBlur={() => setFocusCategory(null)}
          onClick={() => { setPinnedCategory(old => old === item.key ? null : item.key); setPage(0); }}>
          <i aria-hidden="true"/><span><span className="selection-category-title"><b>{number(item.count)}</b> {item.label}</span><span className="selection-category-note">{item.description}</span></span>
        </button>)}
        <p className="selection-total"><strong>{number(model.selected)}</strong> selected{typeof cap === 'number' ? <span>up to {number(cap)}</span> : null}</p>
      </div>
    </div>
    {model.items.length !== report.header.episode_count ? <p className="selection-note">Showing {number(model.items.length)} indexed episodes of {number(report.header.episode_count)} in the report. Counts here describe the available index.</p> : null}
    <p className="sr-only" id={help}>Use arrow keys to inspect episodes, Enter to pin, Escape to clear. Category buttons highlight episode types. Browse episodes opens the same data as a list.</p>
    <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
  </section>;
}
