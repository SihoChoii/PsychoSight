import { formatDay, modeLabel } from "../format";
import type { SavedAnalysis } from "../types";

export interface SavedReportStatus {
  savedLoading?: boolean;
  savedError?: string | null;
  onRetrySaved?: () => void;
}

export function SavedReports({ saved, savedLoading = false, savedError = null, onRetrySaved }: SavedReportStatus & { saved: SavedAnalysis[] }) {
  return <section className="section picker-saved" aria-labelledby="saved-title">
    <div className="section-heading"><h2 id="saved-title" tabIndex={-1}>Saved reports</h2></div>
    {savedLoading ? <p className="status-line" role="status">{saved.length ? "Updating saved reports." : "Loading saved reports."}</p> : null}
    {savedError ? <div className="saved-recovery">
      <p className="field-error" role="alert">{savedError}{saved.length ? " Showing the last loaded saved reports." : " Saved reports could not be loaded."}</p>
      <button type="button" className="button button-secondary" onClick={() => { document.getElementById("saved-title")?.focus(); onRetrySaved?.(); }} disabled={savedLoading}>Retry saved reports</button>
    </div> : null}
    {!savedLoading && !savedError && !saved.length ? <p className="decision-copy">No saved reports yet.</p> : null}
    {saved.length ? <div className="rows">{saved.map((item) => <a className="row link-row" key={item.job_id} href={`#/report/${encodeURIComponent(item.job_id)}`}>
      <span className="choice-label">{item.conversation_label}</span>
      <span className="meta">{modeLabel(item.mode)}</span>
      <time className="meta" dateTime={item.created_at}>{formatDay(item.created_at)}</time>
    </a>)}</div> : null}
  </section>;
}
