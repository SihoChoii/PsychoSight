import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ReportDisclosure, dismissReportLayers } from "./ReportDisclosure";
import { getClient, isAbortError } from "../../api";
import type { Episode, Report } from "../../types";
import { TimelineCanvas, type Viewport } from "../../timeline/canvas";
import { buildTimelineModel, visibleEpisodes, visibleMessages, type Camera, type Selection, type TimedMessage } from "../../timeline/model";
const sameView = (a: Viewport, b: Viewport) => a.start === b.start && a.end === b.end && a.level === b.level && a.unit === b.unit;
const date = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const time = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
const number = (value: number) => value.toLocaleString();
interface Cached {
    range: Camera;
    messages: TimedMessage[];
}
export function ConversationTimeline({ report, onWeek, onEpisode, focusEpisode, onResources }: {
    report: Report;
    onWeek: (week: string) => void;
    onEpisode: (episode: Episode) => void;
    onResources?: () => void;
    focusEpisode?: { id: string; request: number } | null;
}) {
    const model = useMemo(() => buildTimelineModel(report), [report]);
    const initial: Viewport = { ...model.bounds, level: 'overview', unit: 1, visibleEpisodeIds: [] };
    const [view, setView] = useState(initial), [settled, setSettled] = useState(initial), [selection, setSelection] = useState<Selection | null>(null);
    const [messages, setMessages] = useState<TimedMessage[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
    const [listPage, setListPage] = useState(0);
    const canvas = useRef<HTMLCanvasElement>(null), engine = useRef<TimelineCanvas | null>(null), cache = useRef(new Map<string, Cached>());
    const callbacks = useRef({ onWeek, onEpisode });
    callbacks.current = { onWeek, onEpisode };
    const instructions = useId(), statusId = useId();
    useEffect(() => {
        if (!canvas.current)
            return;
        const controller = new TimelineCanvas(canvas.current, model, (next, done) => { setView(old => sameView(old, next) ? old : next); if (done)
            setSettled(old => sameView(old, next) ? old : next); }, next => {
            setSelection(next);
            if (next?.type === 'block' && next.bin.weeks[0])
                callbacks.current.onWeek(next.bin.weeks[0].week);
            if (next?.type === 'episode')
                callbacks.current.onEpisode(next.item.episode);
            if (next?.type === 'message') {
                const ep = model.episodes.find(e => e.episode.episode_id === next.item.message.episode_id);
                if (ep)
                    callbacks.current.onEpisode(ep.episode);
            }
        });
        engine.current = controller;
        return () => { controller.destroy(); engine.current = null; cache.current.clear(); };
    }, [model]);
    useEffect(() => {
        if (!focusEpisode) return;
        engine.current?.focusEpisode(focusEpisode.id);
        canvas.current?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
        canvas.current?.focus({ preventScroll: true });
    }, [focusEpisode]);
    useEffect(() => { engine.current?.setMessages(messages); }, [messages]);
    useEffect(() => {
        setListPage(0);
        if (settled.end - settled.start > model.messageSpan * 2 || !model.episodes.length) {
            setLoading(false);
            setError(null);
            setMessages(old => old.length ? [] : old);
            return;
        }
        const span = settled.end - settled.start, range = { start: Math.max(model.bounds.start, settled.start - span * .5), end: Math.min(model.bounds.end, settled.end + span * .5) };
        const episodes = visibleEpisodes(model, range);
        if (episodes.length > 24) {
            setLoading(false);
            setError('Zoom closer to separate these episodes.');
            setMessages([]);
            return;
        }
        const abort = new AbortController();
        setLoading(episodes.length > 0);
        setError(null);
        const timer = window.setTimeout(async () => {
            try {
                const client = await getClient();
                abort.signal.throwIfAborted();
                const combined: TimedMessage[] = [];
                // Three local reads at a time; all pages are retained, with no sampling or invented positions.
                let cursor = 0;
                await Promise.all(Array.from({ length: Math.min(3, episodes.length) }, async () => {
                    while (cursor < episodes.length) {
                        const ep = episodes[cursor++], id = ep.episode.episode_id;
                        const old = cache.current.get(id);
                        let rows: TimedMessage[];
                        if (old && old.range.start <= range.start && old.range.end >= range.end) {
                            rows = old.messages;
                            cache.current.delete(id);
                            cache.current.set(id, old);
                        }
                        else {
                            rows = [];
                            let offset: number | null = 0;
                            do {
                                abort.signal.throwIfAborted();
                                const page = await client.getEpisodeMessages(report.report_id, id, offset, abort.signal, range);
                                rows.push(...page.messages.map(message => ({ time: Date.parse(message.timestamp), message })));
                                offset = page.next_offset;
                            } while (offset !== null);
                            abort.signal.throwIfAborted();
                            cache.current.set(id, { range, messages: rows });
                            let size = [...cache.current.values()].reduce((n, c) => n + c.messages.length, 0);
                            while (cache.current.size > 1 && (cache.current.size > 24 || size > 12000)) {
                                const key = cache.current.keys().next().value!;
                                size -= cache.current.get(key)!.messages.length;
                                cache.current.delete(key);
                            }
                        }
                        for (const row of rows) combined.push(row);
                    }
                }));
                abort.signal.throwIfAborted();
                combined.sort((a, b) => a.time - b.time || a.message.id.localeCompare(b.message.id));
                setMessages(combined);
                setLoading(false);
            }
            catch (err) {
                if (!abort.signal.aborted && !isAbortError(err)) {
                    setMessages([]);
                    setLoading(false);
                    setError(err instanceof Error ? err.message : 'Messages could not be loaded.');
                }
            }
        }, 120);
        return () => { clearTimeout(timer); abort.abort(); };
    }, [settled.start, settled.end, model, report.report_id, retry]);
    const visible = useMemo(() => visibleMessages(messages, settled), [messages, settled]);
    const episodes = useMemo(() => visibleEpisodes(model, settled), [model, settled]);
    const blocks = useMemo(() => model.levels[0].filter(b => b.end >= settled.start && b.start < settled.end), [model, settled]);
    const itemCount = view.level === 'messages' ? visible.length : view.level === 'overview' ? blocks.length : episodes.length;
    const items = useMemo<Selection[]>(() => {
        const start = listPage * 25, end = start + 25;
        if (view.level === 'messages') return visible.slice(start, end).map(item => ({ type: 'message', item }));
        if (view.level === 'overview') return blocks.slice(start, end).map(bin => ({ type: 'block', bin }));
        return episodes.slice(start, end).map(item => ({ type: 'episode', item }));
    }, [view.level, visible, episodes, blocks, listPage]);
    const selectedMessage = selection?.type === 'message' ? selection.item.message : null;
    function inspect(next: Selection) { engine.current?.select(next); }
    return <div className="conversation-timeline" data-level={view.level} data-start={view.start} data-end={view.end}>
    <div className="timeline-toolbar">
      <ul className="timeline-legend" aria-label="Speakers"><li><i aria-hidden="true"/>Me</li><li><i aria-hidden="true"/>Other person</li></ul>
    </div>
    <div className="timeline-surface">
      <canvas ref={canvas} className="timeline-canvas" role="img" tabIndex={0} aria-label="Interactive conversation timeline" aria-describedby={instructions}/>
      {view.level !== 'overview' ? <p className="timeline-corner" aria-hidden="true">{view.level === 'episodes' ? 'Each interval is an episode' : 'Each square is a message'}</p> : null}
      {!model.levels[0].length && !model.episodes.length ? <p className="timeline-empty">No activity in this report.</p> : null}
      {view.level !== 'overview' && !episodes.length ? <p className="timeline-empty">No episodes in this interval. Drag to move through time.</p> : null}
      {loading ? <p className="timeline-loading" role="status">Loading messages…</p> : null}
    </div>
    <div className="timeline-footer">
      <p className="timeline-range">{!model.levels[0].length && !model.episodes.length ? 'No dates to display' : view.end - view.start < 86400000 ? `${time(new Date(view.start).toISOString())} – ${new Date(view.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : `${date(view.start)} – ${date(view.end - 1)}`}</p>
      <div className="timeline-disclosures">
        <ReportDisclosure kind="info" label="Timeline help" title="Using the timeline"><div className="timeline-help">
          <dl className="timeline-quick-guide">
            <div><dt>Scroll / pinch</dt><dd>Zoom in or out</dd></div>
            <div><dt>Drag</dt><dd>Move through time</dd></div>
            <div><dt>Double-click</dt><dd>Show all</dd></div>
          </dl>
          {onResources ? <button className="report-tool-button" type="button" onClick={() => { dismissReportLayers(); onResources(); }}>Full guide</button> : null}
        </div></ReportDisclosure>
        <ReportDisclosure label={`Browse visible ${view.level === 'overview' ? 'activity' : view.level}`} onOpenChange={open => { if (open) setListPage(0); }}><div className="timeline-item-list">
          <p>{number(itemCount)} {view.level === 'messages' ? 'messages' : view.level === 'episodes' ? 'episodes' : 'activity groups'} in view</p>
          <ol>{items.map(item => <li key={item.type === 'block' ? item.bin.start : item.type === 'episode' ? item.item.episode.episode_id : item.item.message.id}><button type="button" onClick={() => { inspect(item); dismissReportLayers(); window.requestAnimationFrame(() => { const readout = canvas.current?.closest('.conversation-timeline')?.querySelector<HTMLElement>('.timeline-inspector'); readout?.focus({preventScroll:true}); readout?.scrollIntoView?.({block:'nearest',behavior:'instant'}); }); }}>{item.type === 'block' ? `${date(item.bin.start)} · ${number(item.bin.me + item.bin.other)} messages` : item.type === 'episode' ? `${time(item.item.episode.start)} · ${item.item.episode.episode_id}` : `${item.item.message.speaker === 'me' ? 'Me' : 'Other person'} · ${time(item.item.message.timestamp)}`}<span>{item.type === 'message' ? item.item.message.text : item.type === 'block' ? `Me ${number(item.bin.me)} · Other person ${number(item.bin.other)}` : `${number(item.item.episode.messages.me + item.item.episode.messages.other)} messages`}</span></button></li>)}</ol>
          {itemCount > 25 ? <div className="timeline-list-pages"><button type="button" disabled={listPage === 0} onClick={() => setListPage(n => n - 1)}>Previous page</button><span>Page {listPage + 1} of {Math.ceil(itemCount / 25)}</span><button type="button" disabled={(listPage + 1) * 25 >= itemCount} onClick={() => setListPage(n => n + 1)}>Next page</button></div> : null}
        </div></ReportDisclosure>
        {onResources ? <button type="button" className="report-tool-button" onClick={onResources}>Report resources</button> : null}
      </div>
    </div>
    <div className="timeline-inspector" hidden={!selection && view.level === 'overview'} tabIndex={-1} aria-live="polite" aria-atomic="true" id={statusId}>
      {selection?.type === 'block' ? <><div><p className="timeline-inspector-title">{date(selection.bin.start)} – {date(selection.bin.end - 1)}</p><p className="timeline-inspector-meta">Me {number(selection.bin.me)} messages <span>Other person {number(selection.bin.other)} messages</span></p></div></> : null}
      {selection?.type === 'episode' ? <><div><p className="timeline-inspector-title">{time(selection.item.episode.start)}</p><p className="timeline-inspector-meta">{selection.item.episode.episode_id} <span>{number(selection.item.episode.messages.me + selection.item.episode.messages.other)} messages</span></p></div></> : null}
      {selectedMessage ? <div className="timeline-message"><p className="timeline-inspector-meta">{selectedMessage.speaker === 'me' ? 'Me' : 'Other person'} <span>{time(selectedMessage.timestamp)}</span><span>{selectedMessage.episode_id}</span></p><p className="timeline-message-body">{selectedMessage.text}</p><div className="timeline-message-navigation">{[-1, 1].map(direction => { const i = visible.findIndex(m => m.message.id === selectedMessage.id) + direction, next = visible[i]; return <button key={direction} type="button" disabled={!next} onClick={() => next && inspect({ type: 'message', item: next })}>{direction < 0 ? 'Previous message' : 'Next message'}</button>; })}</div></div> : null}
      {!selection && view.level !== 'overview' ? <p className="timeline-idle">{view.level === 'episodes' ? 'Select an episode, or keep zooming to see messages.' : 'Select a square to read a message.'}</p> : null}
    </div>
    {error ? <p className="timeline-error" role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></p> : null}
    {!model.episodes.length && model.levels[0].length ? <p className="timeline-error">This saved report has no episode index. Run a new analysis to explore episodes and messages.</p> : null}
    <p className="sr-only" id={instructions}>Scroll to zoom, drag to pan, double-click or press Home to fit all. Use + or − to zoom and arrow keys to pan. Enter opens the nearest episode; Escape clears selection.</p>
  </div>;
}
