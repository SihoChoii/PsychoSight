import { useMemo, useRef, useState } from "react";
import { formatCalendarDay, formatDay } from "../format";
import type { DateRangePair, Episode, Report } from "../types";
import { DeleteDialog } from "./DeleteDialog";
import { ExperimentalScores } from "./ExperimentalScores";
import { TimelineChart } from "./TimelineChart";
import { SpeakerLegend } from "./SpeakerLegend";
import { buildReportCharts } from "../charts/models";
import { nextWeekKey, windowWeeks, type ChartInspection, type DisplayWindow } from "../charts/inspection";
import { indexEpisodes } from "../charts/episodes";
import { EpisodeTimeline } from "./report/EpisodeTimeline";
import { ReportOverview } from "./report/ReportOverview";
import { ReportNavigation } from "./report/ReportNavigation";
import { WeekInspector } from "./report/WeekInspector";
import { ActivityData, WeeklyActivity } from "./report/WeeklyActivity";
import { ScoredPatterns } from "./report/ScoredPatterns";
import { Observations } from "./report/Observations";

interface ReportViewProps {
  report: Report;
  deleting: boolean;
  deleteError: string | null;
  trendNote?: string | null;
  reasoningLevels?: readonly { id: string; label: string }[];
  onDelete: () => void;
}

export function ReportView(props: ReportViewProps) {
  return <ReportContent key={props.report.report_id} {...props} />;
}

function ReportContent({ report, deleting, deleteError, trendNote, reasoningLevels = [], onDelete }: ReportViewProps) {
  const [confirming, setConfirming] = useState(false);
  const { header } = report;
  const charts = useMemo(() => buildReportCharts(report), [report]);
  const quotes = useMemo(() => new Map(report.quotes.map((quote) => [quote.quote_id, quote])), [report]);

  const episodes = useMemo(() => indexEpisodes(report.episodes, report.quotes), [report]);
  const episodeDisclosure = useRef<HTMLButtonElement>(null);
  const [episodesExpanded, setEpisodesExpanded] = useState(false);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [displayWindow, setDisplayWindow] = useState<DisplayWindow>("all");
  const [pinned, setPinned] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const visibleWeeks = useMemo(() => windowWeeks(charts.timeline.weeks, displayWindow), [charts, displayWindow]);
  const windowIndex = useMemo(() => new Map(visibleWeeks.map((week, index) => [week.key, index])), [visibleWeeks]);
  const visibleFeatures = useMemo(() => charts.features.map((model) => ({ model,
    rows: displayWindow === "all" ? model.rows : model.rows.filter((row) => windowIndex.has(row.week.key)),
  })), [charts, displayWindow, windowIndex]);
  const activityRows = useMemo(() => displayWindow === "all" ? charts.activityRows : charts.activityRows.filter((row) => windowIndex.has(row.week.key)), [charts, displayWindow, windowIndex]);
  const selectedKey = preview ?? pinned;
  const selected = selectedKey === null ? undefined : charts.timeline.byKey.get(selectedKey);
  function pin(key: string | null) {
    setPreview(null); setPinned(key); setEpisodeId(null);
    const week = key === null ? undefined : charts.timeline.byKey.get(key);
    setAnnouncement(week ? `Pinned ${week.key}, ${week.startDate} to ${week.endDate}. All weekly charts updated.` : "Week selection cleared.");
  }
  function move(key: string) {
    const next = nextWeekKey(visibleWeeks, windowIndex, selectedKey, key);
    if (next !== undefined) pin(next);
  }
  const inspection: ChartInspection = { selectedKey, pinnedKey: pinned,
    preview: (key) => { setPreview(key); if ((key ?? pinned) !== selectedKey) setEpisodeId(null); }, pin,
    keyDown: (event) => {
      const next = nextWeekKey(visibleWeeks, windowIndex, selectedKey, event.key);
      if (next !== undefined) { event.preventDefault(); pin(next); }
    },
  };
  function changeWindow(next: DisplayWindow) {
    const weeks = windowWeeks(charts.timeline.weeks, next);
    const first = weeks[0], last = weeks.at(-1);
    const pinnedWeek = pinned === null ? undefined : charts.timeline.byKey.get(pinned);
    const outside = pinned !== null && (!pinnedWeek || !first || !last
      || pinnedWeek.day < first.day || pinnedWeek.day > last.day);
    setDisplayWindow(next); setPreview(null);
    if (outside) { setPinned(null); setEpisodeId(null); }
    setAnnouncement(`${outside ? "Week selection cleared because it is outside the display window. " : ""}Charts show ${first?.startDate ?? "no dates"} to ${last?.endDate ?? "no dates"}. Full report totals are unchanged.`);
  }

  function openEpisodes() {
    setEpisodesExpanded(true);
    if (selected) return;
    const initial = [...visibleWeeks].reverse().find((week) => episodes.byWeek.has(week.key)) ?? visibleWeeks.at(-1);
    if (initial) pin(initial.key);
  }
  function selectEpisode(episode: Episode) {
    pin(episode.week); setEpisodeId(episode.episode_id);
    setAnnouncement(`Episode ${episode.episode_id} selected in ${episode.week}. All weekly charts updated.`);
  }
  function showEpisode(episode: Episode) {
    const outside = !windowIndex.has(episode.week);
    if (outside) setDisplayWindow("all");
    selectEpisode(episode);
    setAnnouncement(`Episode ${episode.episode_id} selected in ${episode.week}. ${outside ? "Display window changed to All weeks. " : ""}All weekly charts updated.`);
    if (episodeDisclosure.current) {
      setEpisodesExpanded(true);
      episodeDisclosure.current.focus();
      episodeDisclosure.current.scrollIntoView?.({ block: "start", behavior: "instant" });
    }
  }
  const episodeReference = (id: string) => {
    const episode = episodes.byId.get(id);
    return episode && charts.timeline.byKey.has(episode.week)
      ? <button className="episode-reference" type="button" onClick={() => showEpisode(episode)} aria-label={`View episode ${id}`}>{id}</button>
      : <span>{id} · Episode detail unavailable</span>;
  };

  return (
    <>
      <ReportOverview report={report} reasoningLevels={reasoningLevels}>
        {report.run_meta.date_range_clamped ? <DateRangeClampNote clamp={report.run_meta.date_range_clamped} /> : null}
      </ReportOverview>
      <ReportNavigation limitationsTitle={report.limitations_title} experimental={!!report.experimental_scores} />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      <section className="report-analysis" aria-labelledby="activity-title">
        <div className="report-section-heading">
          <h2 id="activity-title" tabIndex={-1}>Weekly activity</h2>
          <SpeakerLegend />
        </div>
        <div className="report-window">
          {charts.timeline.weeks.length > 52 ? <label>Chart display window
            <select value={displayWindow} onChange={(event) => changeWindow(event.target.value as DisplayWindow)}>
              <option value="all">All weeks</option><option value="52">Latest 52 weeks</option><option value="13">Latest 13 weeks</option>
            </select>
          </label> : null}
          <p>Charts show: {visibleWeeks[0]?.startDate ?? "Unavailable"} – {visibleWeeks.at(-1)?.endDate ?? "Unavailable"}. Full report totals stay unchanged.</p>
        </div>
        <div className="report-activity-grid">
        <WeeklyActivity rows={activityRows} domain={charts.activityDomain} plotLeft={charts.plotLeft} inspection={inspection} selected={selected} />
        <div className="report-activity-aside">
          <WeekInspector week={selected} inspection={inspection} move={move} empty={!visibleWeeks.length} />
          <div className="activity-disclosures"><ActivityData weeks={charts.timeline.weeks} />
            {report.episodes !== undefined ? <button className="episode-disclosure" type="button" ref={episodeDisclosure}
              aria-expanded={episodesExpanded} aria-controls="episode-detail-panel"
              onClick={() => { if (episodesExpanded) setEpisodesExpanded(false); else openEpisodes(); }}><span aria-hidden="true">{episodesExpanded ? "▾" : "▸"}</span> Episode detail</button> : null}
          </div>
        </div>
        </div>
        {report.episodes !== undefined ? <div id="episode-detail-panel" hidden={!episodesExpanded}>
          {episodesExpanded ? <EpisodeTimeline index={episodes} week={selected} selectedId={episodeId} onSelect={selectEpisode} /> : null}
        </div> : null}
      </section>

      <section className="report-analysis" aria-labelledby="weeks-title">
        <div className="report-section-heading"><h2 id="weeks-title" tabIndex={-1}>Weekly patterns</h2><SpeakerLegend /></div>
        <p className="chart-description">Gaps indicate insufficient or missing data. All charts share the activity window.</p>
        <div className="report-feature-grid">
          {visibleFeatures.map(({ model, rows }) => <TimelineChart key={model.feature.key} model={model} rows={rows} inspection={inspection} totalEpisodes={header.episode_count} />)}
        </div>
      </section>

      <ScoredPatterns rubric={report.rubric} quotes={quotes} episodeReference={episodeReference} />
      <Observations observations={report.observations} rubric={report.rubric} features={report.series} episodeReference={episodeReference} />

      <section className="section" aria-labelledby="limits-title">
        <div className="section-heading">
          <h2 id="limits-title" tabIndex={-1}>{report.limitations_title}</h2>
        </div>
        <ul className="limits">
          {report.limitations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="report-details-title">
        <div className="section-heading"><h2 id="report-details-title" tabIndex={-1}>Report details</h2></div>
        <p className="disclaimer">{report.disclaimer}</p>
        <details className="details">
          <summary>Details</summary>
          <dl className="meta-list">
            <div>
              <dt>Run</dt>
              <dd>{report.run_meta.run_id}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{formatDay(report.run_meta.created_at)}</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{header.timezone || "Insufficient data"}</dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{report.run_meta.provider ?? "Not used"}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{report.run_meta.model ?? "Not used"}</dd>
            </div>
          </dl>
        </details>
        {!confirming && deleteError ? (
          <p className="field-error" role="alert">
            {deleteError}
          </p>
        ) : null}
        {!confirming && deleting ? <p className="recovery-status" role="status">Deleting report. The request is still running.</p> : null}
        <div className="actions">
          <button type="button" className="button button-secondary" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setConfirming(true); }}>
            {deleting ? "View deletion status" : "Delete report"}
          </button>
        </div>
      </section>

      {report.experimental_scores ? (
        <ExperimentalScores section={report.experimental_scores} trendNote={trendNote ?? null} />
      ) : null}

      <DeleteDialog
        open={confirming}
        busy={deleting}
        error={deleteError}
        onCancel={() => setConfirming(false)}
        onConfirm={onDelete}
      />
    </>
  );
}

function boundText(value: string | null, empty: string): string {
  if (!value) return empty;
  return formatCalendarDay(value) ?? value;
}

function pairText(pair: DateRangePair): string {
  return `${boundText(pair.date_from, "open start")} to ${boundText(pair.date_to, "open end")}`;
}

function DateRangeClampNote({ clamp }: { clamp: NonNullable<Report["run_meta"]["date_range_clamped"]> }) {
  return (
    <p className="status-line" data-testid="date-range-clamp">
      Your range was adjusted to the dates the conversation covers. Requested {pairText(clamp.requested)}. Applied{" "}
      {pairText(clamp.applied)}.
    </p>
  );
}
