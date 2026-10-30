import { type ReactNode } from "react";
import { formatCalendarDay, formatNumber } from "../../format";
import type { Report } from "../../types";
import { ReportDisclosure } from "./ReportDisclosure";
import { ReportNavigation } from "./ReportNavigation";

export function ReportOverview({ report, children }: { report: Report; children?: ReactNode }) {
  const { header } = report;
  return <header className="report-intro" aria-labelledby="page-title">
    <div className="report-heading">
      <div className="report-identity">
        <h1 id="page-title" tabIndex={-1}>{header.conversation_label}</h1>
        <p className="report-date-range">
          <span>{formatCalendarDay(header.date_from) ?? "Unavailable"} – {formatCalendarDay(header.date_to) ?? "Unavailable"}</span>
          {header.is_demo ? <span>Demo data</span> : null}
        </p>
      </div>
      <div className="report-heading-actions">
<ReportDisclosure kind="info" label="Report information" title="Report information">    <div className="report-information">
      <div className="report-provenance">
        <p className="report-context">{report.mode === "full" ? "Full analysis" : report.mode === "deterministic_only" ? "Deterministic only" : `Analysis mode: ${report.mode}`}</p>
        <p className="report-applied">Timezone: {header.timezone || "Unavailable"}</p>
        {report.run_meta.provider_note ? <p className="report-provider-note">{report.run_meta.provider_note}</p> : null}
      </div>
      <p className="report-totals-label">Full report totals</p>
      <dl className="report-totals" aria-label="Full report totals">
        <div><dt>Messages</dt><dd>{formatNumber(header.message_counts.me + header.message_counts.other)}
          <span>Me {formatNumber(header.message_counts.me)} · Other {formatNumber(header.message_counts.other)}</span></dd></div>
        <div><dt>Episodes</dt><dd>{formatNumber(header.episode_count)}
          <span>{formatNumber(header.episodes_scored)} sent for rubric scoring</span></dd></div>
        <div><dt>Reported weeks</dt><dd>{formatNumber(header.week_count)}</dd></div>
        {header.word_counts ? <div><dt>Words</dt><dd>{formatNumber(header.word_counts.me + header.word_counts.other)}
          <span>Me {formatNumber(header.word_counts.me)} · Other {formatNumber(header.word_counts.other)}</span></dd></div> : null}
      </dl>
    </div></ReportDisclosure>
        <ReportNavigation limitationsTitle={report.limitations_title} experimental={!!report.experimental_scores} />
      </div>
    </div>
    {children}

  </header>;
}
