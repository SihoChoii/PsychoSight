import { useEffect, useRef, useState } from "react";
import { getClient } from "../api";
import {
  dateBounds,
  dateRangeProblem,
  DEFAULT_PAGE_SIZE,
  interpretConversationsResponse,
  MAX_QUERY_LENGTH,
  PAGE_SIZE_OPTIONS,
  rangeFits,
  type ConversationPage,
  type ConversationQuery,
  type ConversationsFetch,
} from "../conversation-adapter";
import { formatCalendarDay, formatDay, modeLabel } from "../format";
import type { ThemeName } from "../mode";
import type { Conversation, SavedAnalysis } from "../types";

export interface PickerSelection {
  conversationId: string;
  label: string;
  isDemo: boolean;
  dateFrom: string;
  dateTo: string;
}

interface Draft {
  from: string;
  to: string;
  custom: boolean;
}

async function defaultFetch(query: ConversationQuery): Promise<ConversationsFetch> {
  const client = await getClient();
  return client.getConversations(query);
}

function resultSummary(total: number, q: string): string {
  if (q.trim() && total === 0) return "No conversations match.";
  if (q.trim()) return total === 1 ? "1 conversation matches." : `${total} conversations match.`;
  return total === 1 ? "1 conversation." : `${total} conversations.`;
}

function spanCopy(conversation: Conversation): string {
  const bounds = dateBounds(conversation);
  if (!bounds.from || !bounds.to) {
    return "Message dates are not available for this conversation. You can continue without a range.";
  }
  const from = formatCalendarDay(bounds.from);
  const to = formatCalendarDay(bounds.to);
  const span = `Conversation spans ${from} to ${to}.`;
  return typeof conversation.message_count === "number" ? `${span} ${conversation.message_count} messages.` : span;
}

function listDay(conversation: Conversation): string {
  if (conversation.last_message_date) return conversation.last_message_date;
  return formatDay(conversation.latest_date ?? conversation.last_message_at);
}

export function Picker({
  theme,
  saved,
  activeJobId,
  flash,
  onContinue,
  fetchConversations = defaultFetch,
  refreshKey = 0,
  debounceMs = 300,
  onCatalog,
}: {
  theme: ThemeName;
  saved: SavedAnalysis[];
  activeJobId: string | null;
  flash: string | null;
  onContinue: (selection: PickerSelection) => void;
  fetchConversations?: (query: ConversationQuery) => Promise<ConversationsFetch>;
  refreshKey?: number;
  debounceMs?: number;
  onCatalog?: (page: ConversationPage) => void;
}) {
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState<ConversationQuery>({ limit: DEFAULT_PAGE_SIZE, offset: 0, q: "" });
  const [page, setPage] = useState<ConversationPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState<Draft>({ from: "", to: "", custom: false });
  const [dateError, setDateError] = useState<string | null>(null);
  const onCatalogRef = useRef(onCatalog);
  onCatalogRef.current = onCatalog;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQ = searchText.trim().slice(0, MAX_QUERY_LENGTH);
      setQuery((prev) => (prev.q === nextQ ? prev : { ...prev, q: nextQ, offset: 0 }));
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [searchText, debounceMs]);

  useEffect(() => {
    let stop = false;
    setLoading(true);
    fetchConversations(query)
      .then((result) => {
        if (stop) return;
        const next = interpretConversationsResponse(result.body, query, result.totalHeader);
        setPage(next);
        setError(null);
        onCatalogRef.current?.(next);
      })
      .catch((err: unknown) => {
        if (stop) return;
        setError(err instanceof Error ? err.message : "Conversations could not be loaded.");
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [query, refreshKey, attempt, fetchConversations]);

  useEffect(() => {
    if (selected || !page || page.chat_db.available === false) return;
    const first = page.conversations.find((item) => item.supported);
    if (!first) return;
    const bounds = dateBounds(first);
    setSelected(first);
    setDraft({ from: bounds.from ?? "", to: bounds.to ?? "", custom: false });
  }, [page, selected]);

  if (!page && !error) {
    return (
      <section className="focus-task" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>
          Conversations
        </h1>
        <p className="decision-copy">Loading conversations.</p>
      </section>
    );
  }

  if (page && page.chat_db.available === false) {
    return (
      <section className="focus-task" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>
          Conversations
        </h1>
        <p className="decision-copy">Loading conversations.</p>
      </section>
    );
  }

  if (!page) {
    return (
      <section className="focus-task" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>
          Conversations
        </h1>
        <p className="field-error" role="alert">
          {error}
        </p>
        <div className="actions">
          <button type="button" className="button" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  const pageCount = Math.max(1, Math.ceil(page.total / query.limit));
  const pageNumber = page.total === 0 ? 1 : Math.floor(query.offset / query.limit) + 1;
  const summary = resultSummary(page.total, query.q);
  const statusText = query.q.trim() && page.total === 0 ? summary : `Page ${pageNumber} of ${pageCount}. ${summary}`;
  const bounds = selected ? dateBounds(selected) : { from: null, to: null };
  const describedBy = [selected ? "date-span" : null, dateError ? "date-error" : null].filter(Boolean).join(" ") || undefined;

  function choose(conversation: Conversation) {
    setSelected(conversation);
    setDateError(null);
    setDraft((prev) => {
      const nextBounds = dateBounds(conversation);
      if (prev.custom && rangeFits(prev.from, prev.to, nextBounds)) return prev;
      return { from: nextBounds.from ?? "", to: nextBounds.to ?? "", custom: false };
    });
  }

  function submit() {
    if (!selected) return;
    const problem = dateRangeProblem(draft.from, draft.to, dateBounds(selected));
    setDateError(problem);
    if (problem) return;
    onContinue({
      conversationId: selected.id,
      label: selected.label,
      isDemo: selected.is_demo,
      dateFrom: draft.from,
      dateTo: draft.to,
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
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="section" aria-labelledby="choose-title">
        <div className="section-heading">
          <h2 id="choose-title">Choose a conversation</h2>
        </div>
        <div className="list-tools">
          <div className="field">
            <label htmlFor="conversation-search">Search conversations</label>
            <input
              id="conversation-search"
              type="search"
              value={searchText}
              maxLength={MAX_QUERY_LENGTH}
              placeholder="Name or handle"
              autoComplete="off"
              onChange={(event) => setSearchText(event.target.value)}
            />
          </div>
        </div>
        <div
          className="conversation-scroll"
          tabIndex={0}
          role="region"
          aria-label="Conversation list"
          aria-busy={loading}
        >
          <fieldset className="rows">
            <legend className="sr-only">1:1 conversations</legend>
            {page.conversations.length === 0 ? (
              <p className="empty-list">No conversations match.</p>
            ) : (
              page.conversations.map((conversation) =>
                conversation.supported ? (
                  <label className="row" key={conversation.id}>
                    <input
                      type="radio"
                      name="conversation"
                      value={conversation.id}
                      checked={selected?.id === conversation.id}
                      onChange={() => choose(conversation)}
                    />
                    <span className="choice-label">{conversation.label}</span>
                    <span className="meta">
                      {typeof conversation.message_count === "number" ? `${conversation.message_count} messages` : "Insufficient data"}
                    </span>
                    <time className="meta" dateTime={conversation.last_message_at ?? conversation.latest_date ?? undefined}>
                      {listDay(conversation)}
                    </time>
                    {conversation.is_demo ? <span className="row-note">Demo data</span> : null}
                  </label>
                ) : (
                  <div className="row row-static" key={conversation.id}>
                    <span className="choice-gap" aria-hidden="true" />
                    <span className="choice-label">{conversation.label}</span>
                    <span className="meta">
                      {typeof conversation.message_count === "number" ? `${conversation.message_count} messages` : "Insufficient data"}
                    </span>
                    <time className="meta" dateTime={conversation.last_message_at ?? conversation.latest_date ?? undefined}>
                      {listDay(conversation)}
                    </time>
                    <p className="row-note">Group chats are not supported.</p>
                  </div>
                ),
              )
            )}
          </fieldset>
        </div>
        <nav className="pager" aria-label="Conversation pages">
          <button
            type="button"
            className="button button-secondary"
            disabled={pageNumber <= 1}
            onClick={() => setQuery((prev) => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
          >
            Previous
          </button>
          <p className="pager-status" role="status" aria-live="polite" aria-atomic="true">
            {statusText}
          </p>
          <button
            type="button"
            className="button button-secondary"
            disabled={query.offset + query.limit >= page.total}
            onClick={() => setQuery((prev) => ({ ...prev, offset: prev.offset + prev.limit }))}
          >
            Next
          </button>
          <div className="field page-size">
            <label htmlFor="page-size">Conversations per page</label>
            <select
              id="page-size"
              className="control"
              value={String(query.limit)}
              onChange={(event) => {
                const limit = Number(event.target.value);
                setQuery((prev) => ({ ...prev, limit, offset: 0 }));
              }}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </nav>
        {selected ? (
          <div className="form-column" id="date-range">
            <h3 id="date-title">Date range</h3>
            <p className="decision-copy">{selected.label}</p>
            <p id="date-span" className="decision-copy">
              {spanCopy(selected)}
            </p>
            <div className="field">
              <label htmlFor="date-from">From</label>
              <input
                id="date-from"
                type="date"
                value={draft.from}
                min={bounds.from ?? undefined}
                max={bounds.to ?? undefined}
                aria-describedby={describedBy}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((prev) => ({ ...prev, from: value, custom: true }));
                  setDateError(null);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="date-to">To</label>
              <input
                id="date-to"
                type="date"
                value={draft.to}
                min={bounds.from ?? undefined}
                max={bounds.to ?? undefined}
                aria-describedby={describedBy}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((prev) => ({ ...prev, to: value, custom: true }));
                  setDateError(null);
                }}
              />
            </div>
            {dateError ? (
              <p id="date-error" className="field-error" role="alert">
                {dateError}
              </p>
            ) : null}
            <div className="actions">
              <button type="button" className="button" onClick={submit}>
                Continue
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={!bounds.from || !bounds.to}
                onClick={() => {
                  setDraft({ from: bounds.from ?? "", to: bounds.to ?? "", custom: false });
                  setDateError(null);
                }}
              >
                Reset to full range
              </button>
            </div>
          </div>
        ) : (
          <p id="choose-hint" className="field-error">
            Choose a 1:1 conversation.
          </p>
        )}
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
