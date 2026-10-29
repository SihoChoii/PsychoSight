import type { ReactNode } from "react";
import { formatNumber } from "../../format";
import type { Report } from "../../types";

export function ReportOverview({ report, children }: { report: Report; children?: ReactNode }) {
  const { header } = report;
  return <header className="report-intro" aria-labelledby="page-title">
    <h1 id="page-title" tabIndex={-1}>{header.conversation_label}</h1>
    <p className="report-meta"><span className="report-context">{header.is_demo ? "Demo data · " : ""}{report.mode === "full" ? "Full analysis" : report.mode === "deterministic_only" ? "Deterministic only" : `Analysis mode: ${report.mode}`}</span><span aria-hidden="true"> · </span><span className="report-applied">Applied dates: {header.date_from ?? "Unavailable"} – {header.date_to ?? "Unavailable"} · {header.timezone || "Timezone unavailable"}</span></p>
    {children}
    {report.run_meta.provider_note ? <p className="report-provider-note">{report.run_meta.provider_note}</p> : null}
    <dl className="report-totals" aria-label="Full report totals">
      <div><dt>Messages · full report</dt><dd>{formatNumber(header.message_counts.me + header.message_counts.other)}
        <span>Me {formatNumber(header.message_counts.me)} · Other {formatNumber(header.message_counts.other)}</span></dd></div>
      <div><dt>Episodes · full report</dt><dd>{formatNumber(header.episode_count)}
        <span>{formatNumber(header.episodes_scored)} sent for rubric scoring</span></dd></div>
      <div><dt>Reported weeks</dt><dd>{formatNumber(header.week_count)}</dd></div>
      {header.word_counts ? <div><dt>Words · full report</dt><dd>{formatNumber(header.word_counts.me + header.word_counts.other)}
        <span>Me {formatNumber(header.word_counts.me)} · Other {formatNumber(header.word_counts.other)}</span></dd></div> : null}
    </dl>
  </header>;
}
