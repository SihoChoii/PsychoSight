import { useId, useMemo, useState } from "react";
import { EvidenceQuote } from "./EvidenceQuote";
import { episodeIntervals, episodeSelection, type EpisodeIndex } from "../../charts/episodes";
import type { TimelineWeek } from "../../charts/timeline";
import { formatNumber, speakerLabel } from "../../format";
import type { Episode, Quote } from "../../types";

export function EpisodeTimeline({ index, week, selectedId, onSelect }: {
  index: EpisodeIndex; week?: TimelineWeek; selectedId: string | null;
  onSelect: (episode: Episode) => void;
}) {
  const [dataOpen, setDataOpen] = useState(false);
  const episodes = week ? index.byWeek.get(week.key) ?? [] : [];
  const requested = selectedId === null ? undefined : index.byId.get(selectedId);
  const selected = requested?.week === week?.key ? requested : episodes[0];
  return <section className="episode-detail" aria-label="Episode detail">
    <div>
      <div className="episode-heading"><h3>{week ? `${week.key} · ${episodes.length} indexed episodes` : "No week selected"}</h3>
        {selected ? <label>Inspect episode <select value={selected.episode_id} onChange={(event) => {
          const episode = index.byId.get(event.target.value); if (episode) onSelect(episode);
        }}>{episodes.map((episode) => <option key={episode.episode_id} value={episode.episode_id}>{episode.episode_id}</option>)}</select></label> : null}
      </div>
      {episodes.length ? <>
        <p className="episode-note">Each row is one episode, positioned by its actual start and end. Initiator: ● Me (solid), □ Other (dashed). Axis: UTC; exact timestamps below retain supplied offsets. Scroll to see all times and rows.</p>
        <div className="episode-layout">
          <EpisodeDiagram episodes={episodes} selectedId={selected?.episode_id} />
          {selected ? <EpisodeInspector episode={selected} quotes={index.quotesByEpisode.get(selected.episode_id) ?? []} /> : null}
        </div>
        <details className="chart-data episode-data" open={dataOpen}><summary onClick={(event) => { event.preventDefault(); setDataOpen((open) => !open); }}>View episode data · {episodes.length} episodes</summary>
          {dataOpen ? <div className="chart-table-scroll" tabIndex={0} role="region" aria-label={`Exact episode data for ${week?.key}`}>
            <table><caption>Exact episode index · {week?.key}. Counts are per speaker; flags are reported metadata.</caption>
              <thead><tr><th scope="col">Episode / week</th><th scope="col">Start / end (original offsets)</th><th scope="col">Initiator</th><th scope="col">Messages / words</th><th scope="col">Flags</th><th scope="col">Selection</th></tr></thead>
              <tbody>{episodes.map((episode) => <tr key={episode.episode_id}>
                <th scope="row"><button type="button" aria-pressed={selected?.episode_id === episode.episode_id} onClick={() => onSelect(episode)}>{episode.episode_id}</button><span>{episode.week}</span></th>
                <td><time dateTime={episode.start}>{episode.start}</time><time dateTime={episode.end}>{episode.end}</time></td>
                <td>{speakerLabel(episode.initiator)}</td><td><Counts episode={episode} /></td>
                <td>Pooled: {episode.pooled ? "Yes" : "No"}<br />Late-night start: {episode.late_night_start ? "Yes" : "No"}</td>
                <td>{episodeSelection(episode)}</td>
              </tr>)}</tbody>
            </table>
          </div> : null}
        </details>
        <p className="episode-note">Selected for scoring records selection, not rating success or stability. Pooled and selected can coexist.</p>
      </> : <p>{week ? "No indexed episodes supplied for this week." : "Select a week to inspect its episodes."}</p>}
    </div>
  </section>;
}

function EpisodeDiagram({ episodes, selectedId }: { episodes: Episode[]; selectedId?: string }) {
  const geometry = useMemo(() => episodeIntervals(episodes), [episodes]);
  const id = useId(), width = 760, left = 128, right = 28, top = 64;
  const plotWidth = width - left - right, height = top + geometry.rows.length * 36 + 16;
  if (!geometry.rows.length) return <p>Episode timestamps unavailable for plotting. Exact supplied values remain in the inspector and table.</p>;
  return <div className="episode-diagram-scroll" tabIndex={0} role="region" aria-label="Episode interval diagram; scroll to see all times and rows">
    <svg className="episode-diagram" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-labelledby={id}>
      <title id={id}>Actual episode intervals, one lane per episode. Initiator shown by circle or square. Use Inspect episode or View episode data for exact metadata.</title>
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const x = left + fraction * plotWidth, label = new Date(geometry.start + fraction * (geometry.end - geometry.start)).toISOString();
        return <g key={fraction}><line className="episode-grid" x1={x} x2={x} y1={50} y2={height} />
          <text x={x} y={18} textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"}>{label.slice(5, 10)}</text>
          <text x={x} y={38} textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"}>{label.slice(11, 19)}</text></g>;
      })}
      {geometry.rows.map(({ episode, lane, x1, x2 }) => {
        const y = top + lane * 36 + 14, start = left + x1 * plotWidth, end = left + x2 * plotWidth;
        return <g key={episode.episode_id} data-episode-id={episode.episode_id} data-selected={episode.episode_id === selectedId} className={`episode-interval episode-${episode.initiator}`}>
          <title>{episode.episode_id}: {episode.start} to {episode.end}; initiator {speakerLabel(episode.initiator)}; {episodeSelection(episode)}</title>
          {episode.episode_id === selectedId ? <rect className="episode-highlight" x={0} y={y - 14} width={width} height={28} /> : null}
          <text x={4} y={y + 5}>{episode.episode_id}</text><line className="episode-range" x1={start} x2={end} y1={y} y2={y} />
          {episode.initiator === "me" ? <circle className="episode-start" cx={start} cy={y} r={4} /> : <rect className="episode-start" x={start - 4} y={y - 4} width={8} height={8} />}
          <line className="episode-end" x1={end} x2={end} y1={y - 5} y2={y + 5} />
        </g>;
      })}
    </svg>
    {geometry.rows.length !== episodes.length ? <p>Some intervals cannot be plotted; all supplied episodes remain accessible below.</p> : null}
  </div>;
}

function Counts({ episode }: { episode: Episode }) {
  return <>{(["me", "other"] as const).map((speaker) => <span className="episode-counts" key={speaker}>{speakerLabel(speaker)}: {formatNumber(episode.messages[speaker])} messages · {formatNumber(episode.words[speaker])} words</span>)}</>;
}
function EpisodeInspector({ episode, quotes }: { episode: Episode; quotes: Quote[] }) {
  return <section className="episode-inspector" aria-label={`Episode ${episode.episode_id}`}>
    <h4>{episode.episode_id}</h4>
    <dl><div><dt>Week / initiator</dt><dd>{episode.week} · {speakerLabel(episode.initiator)}</dd></div>
      <div><dt>Start</dt><dd><time dateTime={episode.start}>{episode.start}</time></dd></div>
      <div><dt>End</dt><dd><time dateTime={episode.end}>{episode.end}</time></dd></div>
      <div><dt>Counts</dt><dd><Counts episode={episode} /></dd></div>
      <div><dt>Flags</dt><dd>Pooled: {episode.pooled ? "Yes" : "No"} · Late-night start: {episode.late_night_start ? "Yes" : "No"}</dd></div>
      <div><dt>Selection</dt><dd>{episodeSelection(episode)}</dd></div>
    </dl>
    {quotes.length ? <div className="quotes">{quotes.map((quote) => <EvidenceQuote key={quote.quote_id} quote={quote} />)}</div> : <p className="episode-note">No report evidence quotes supplied for this episode.</p>}
  </section>;
}
