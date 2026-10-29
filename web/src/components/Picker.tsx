import { useState } from "react";
import { dateOrderError, formatDay, modeLabel } from "../format";
import type { ThemeName } from "../mode";
import type { Conversation, SavedAnalysis } from "../types";

export interface PickerSelection {
  conversationId: string;
  label: string;
  isDemo: boolean;
  dateFrom: string;
  dateTo: string;
}

export function Picker({
  theme,
  conversations,
  saved,
  activeJobId,
  flash,
  onContinue,
}: {
  theme: ThemeName;
  conversations: Conversation[];
  saved: SavedAnalysis[];
  activeJobId: string | null;
  flash: string | null;
  onContinue: (selection: PickerSelection) => void;
}) {
  const first = conversations.find((item) => item.supported);
  const [selectedId, setSelectedId] = useState<string>(first?.id ?? "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const selected = conversations.find((item) => item.id === selectedId && item.supported) ?? null;

  function submit() {
    const problem = dateOrderError(dateFrom, dateTo);
    setDateError(problem);
    if (problem || !selected) return;
    onContinue({
      conversationId: selected.id,
      label: selected.label,
      isDemo: selected.is_demo,
      dateFrom,
      dateTo,
    });
  }

  return (
    <>
      <section className="opening" aria-labelledby="page-title">
        <h1 id="page-title" className="display-title" tabIndex={-1}>
          Conversations
        </h1>
        <img className="hero-logo" src={`/logos/${theme}/psychosigh-logo.svg`} alt="" width={1200} height={340} />
      </section>
      {flash ? (
        <p className="status-line" role="status">
          {flash}
        </p>
      ) : null}
      {activeJobId ? (
        <p className="status-line">
          <a href={`#/run/${encodeURIComponent(activeJobId)}`}>Analysis in progress</a>
        </p>
      ) : null}
      <section className="section" aria-labelledby="choose-title">
        <div className="section-heading">
          <h2 id="choose-title">Choose a conversation</h2>
        </div>
        <fieldset className="rows">
          <legend className="sr-only">1:1 conversations</legend>
          {conversations.map((conversation) =>
            conversation.supported ? (
              <label className="row" key={conversation.id}>
                <input
                  type="radio"
                  name="conversation"
                  value={conversation.id}
                  checked={selectedId === conversation.id}
                  onChange={() => setSelectedId(conversation.id)}
                />
                <span className="choice-label">{conversation.label}</span>
                <span className="meta">{conversation.message_count} messages</span>
                <time className="meta" dateTime={conversation.latest_date ?? undefined}>
                  {formatDay(conversation.latest_date)}
                </time>
                {conversation.is_demo ? <span className="row-note">Demo data</span> : null}
              </label>
            ) : (
              <div className="row row-static" key={conversation.id}>
                <span className="choice-gap" aria-hidden="true" />
                <span className="choice-label">{conversation.label}</span>
                <span className="meta">{conversation.message_count} messages</span>
                <time className="meta" dateTime={conversation.latest_date ?? undefined}>
                  {formatDay(conversation.latest_date)}
                </time>
                <p className="row-note">Group chats are not supported.</p>
              </div>
            ),
          )}
        </fieldset>
        <div className="form-column">
          <div className="field">
            <label htmlFor="date-from">From</label>
            <input id="date-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="date-to">To</label>
            <input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              aria-describedby={dateError ? "date-error" : undefined}
            />
          </div>
          {dateError ? (
            <p id="date-error" className="field-error">
              {dateError}
            </p>
          ) : null}
          {!selected ? (
            <p id="choose-hint" className="field-error">
              Choose a 1:1 conversation.
            </p>
          ) : null}
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={!selected}
              aria-describedby={!selected ? "choose-hint" : undefined}
              onClick={submit}
            >
              Continue
            </button>
          </div>
        </div>
      </section>
      {saved.length > 0 ? (
        <section className="section" aria-labelledby="saved-title">
          <div className="section-heading">
            <h2 id="saved-title">Saved reports</h2>
          </div>
          <div className="rows">
            {saved.map((item) => (
              <a className="row link-row" key={item.job_id} href={`#/report/${encodeURIComponent(item.job_id)}`}>
                <span className="choice-label">{item.conversation_label}</span>
                <span className="meta">{modeLabel(item.mode)}</span>
                <time className="meta" dateTime={item.created_at}>
                  {formatDay(item.created_at)}
                </time>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
