import type { Conversation, DateRangeClamp } from "./types";

/**
 * Wire names for GET /conversations and the date bounds on each item.
 * Rename a value here if a field name changes.
 */
export const conversationFields = {
  limit: "limit",
  offset: "offset",
  q: "q",
  total: "total",
  totalHeader: "X-Total-Count",
  messageCount: "message_count",
  firstMessageAt: "first_message_at",
  lastMessageAt: "last_message_at",
  firstMessageDate: "first_message_date",
  lastMessageDate: "last_message_date",
} as const;

export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
export const MAX_PAGE_SIZE = 200;
export const MAX_QUERY_LENGTH = 200;
export const DEFAULT_PAGE_SIZE = 10;

export const DATE_RANGE_INVALID_MESSAGE = "date_from must be on or before date_to.";

export interface ConversationQuery {
  limit: number;
  offset: number;
  q: string;
}

export interface ConversationsFetch {
  body: unknown;
  totalHeader: string | null;
}

export interface ConversationPage {
  conversations: Conversation[];
  total: number;
  chat_db: {
    available: boolean;
    error: { code: string; message: string } | null;
  };
  paging: "server" | "client";
}

export interface DateBounds {
  from: string | null;
  to: string | null;
}

export type DateRangeResolution =
  | { ok: true; clamp: DateRangeClamp | null }
  | { ok: false; code: "DATE_RANGE_INVALID" | "DATE_RANGE_OUT_OF_BOUNDS"; message: string };

interface CatalogItem {
  id: string;
  label: string;
  handles?: string[];
  message_count: number | null;
  latest_date: string | null;
  first_message_at: string | null;
  last_message_at: string | null;
  first_message_date: string | null;
  last_message_date: string | null;
  is_group: boolean;
  supported: boolean;
  is_demo: boolean;
  participant_count: number;
}

export function dateRangeOutOfBoundsMessage(from: string, to: string): string {
  return `The date range does not overlap this conversation. Messages run from ${from} to ${to} (inclusive, local dates).`;
}

export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  const whole = Math.floor(limit);
  if (whole < 1) return 1;
  if (whole > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return whole;
}

export function validateConversationQuery(query: ConversationQuery): string | null {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_PAGE_SIZE) {
    return `limit must be between 1 and ${MAX_PAGE_SIZE}.`;
  }
  if (!Number.isInteger(query.offset) || query.offset < 0) {
    return "offset must be 0 or greater.";
  }
  if (query.q.length > MAX_QUERY_LENGTH) {
    return `q must be at most ${MAX_QUERY_LENGTH} characters.`;
  }
  return null;
}

export function conversationsQueryString(query: ConversationQuery): string {
  const params = new URLSearchParams();
  params.set(conversationFields.limit, String(clampLimit(query.limit)));
  const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset)) : 0;
  params.set(conversationFields.offset, String(offset));
  const q = query.q.trim().slice(0, MAX_QUERY_LENGTH);
  if (q) params.set(conversationFields.q, q);
  return params.toString();
}

export function calendarDay(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

export function dateBounds(conversation: Pick<Conversation, "first_message_date" | "last_message_date">): DateBounds {
  return {
    from: calendarDay(conversation.first_message_date),
    to: calendarDay(conversation.last_message_date),
  };
}

export function rangeFits(from: string, to: string, bounds: DateBounds): boolean {
  if (!from || !to || from > to) return false;
  if (!bounds.from || !bounds.to) return false;
  return from >= bounds.from && to <= bounds.to;
}

export function resolveDateRange(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  boundsFrom: string | null | undefined,
  boundsTo: string | null | undefined,
): DateRangeResolution {
  const from = dateFrom || null;
  const to = dateTo || null;
  if (from && to && from > to) {
    return { ok: false, code: "DATE_RANGE_INVALID", message: DATE_RANGE_INVALID_MESSAGE };
  }
  const lo = calendarDay(boundsFrom);
  const hi = calendarDay(boundsTo);
  if (!lo || !hi) return { ok: true, clamp: null };
  const effFrom = from ?? lo;
  const effTo = to ?? hi;
  if (effFrom > hi || effTo < lo) {
    return { ok: false, code: "DATE_RANGE_OUT_OF_BOUNDS", message: dateRangeOutOfBoundsMessage(lo, hi) };
  }
  const appliedFrom = from ? (from < lo ? lo : from) : null;
  const appliedTo = to ? (to > hi ? hi : to) : null;
  if (appliedFrom === from && appliedTo === to) return { ok: true, clamp: null };
  return {
    ok: true,
    clamp: {
      requested: { date_from: from, date_to: to },
      applied: { date_from: appliedFrom, date_to: appliedTo },
      bounds: { date_from: lo, date_to: hi },
    },
  };
}

export function dateRangeProblem(
  from: string,
  to: string,
  bounds: DateBounds,
): string | null {
  const result = resolveDateRange(from, to, bounds.from, bounds.to);
  return result.ok ? null : result.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : null;
}

export function mapConversation(raw: unknown): Conversation | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  const count = raw[conversationFields.messageCount];
  const isGroup = raw.is_group === true;
  return {
    id: raw.id,
    label: typeof raw.label === "string" && raw.label.length > 0 ? raw.label : raw.id,
    message_count: typeof count === "number" && Number.isFinite(count) ? count : null,
    latest_date: asNullableString(raw.latest_date),
    first_message_at: asNullableString(raw[conversationFields.firstMessageAt]),
    last_message_at: asNullableString(raw[conversationFields.lastMessageAt]),
    first_message_date: calendarDay(asNullableString(raw[conversationFields.firstMessageDate])),
    last_message_date: calendarDay(asNullableString(raw[conversationFields.lastMessageDate])),
    is_group: isGroup,
    supported: typeof raw.supported === "boolean" ? raw.supported : !isGroup,
    is_demo: raw.is_demo === true,
    participant_count: typeof raw.participant_count === "number" && Number.isFinite(raw.participant_count) ? raw.participant_count : 0,
  };
}

export function toWire(item: CatalogItem): Record<string, unknown> {
  return {
    id: item.id,
    label: item.label,
    [conversationFields.messageCount]: item.message_count,
    latest_date: item.latest_date,
    [conversationFields.firstMessageAt]: item.first_message_at,
    [conversationFields.lastMessageAt]: item.last_message_at,
    [conversationFields.firstMessageDate]: item.first_message_date,
    [conversationFields.lastMessageDate]: item.last_message_date,
    is_group: item.is_group,
    supported: item.supported,
    is_demo: item.is_demo,
    participant_count: item.participant_count,
  };
}

export function filterCatalog<T extends { id: string; label: string; handles?: string[] }>(items: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return items.slice();
  return items.filter((item) => {
    const hay = `${item.label} ${item.id} ${(item.handles ?? []).join(" ")}`.toLowerCase();
    return hay.includes(needle);
  });
}

function conversationMatches(item: Conversation, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return `${item.label} ${item.id}`.toLowerCase().includes(needle);
}

function parseBodyTotal(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function parseHeaderTotal(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function parseChatDb(value: unknown): ConversationPage["chat_db"] {
  if (!isRecord(value)) return { available: true, error: null };
  const available = value.available !== false;
  const error = value.error;
  if (!available && isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    return { available: false, error: { code: error.code, message: error.message } };
  }
  return { available, error: null };
}

export function interpretConversationsResponse(
  body: unknown,
  query: ConversationQuery,
  totalHeader?: string | null,
): ConversationPage {
  const record = isRecord(body) ? body : {};
  const rawList = Array.isArray(record.conversations) ? record.conversations : [];
  const conversations = rawList.map(mapConversation).filter((item): item is Conversation => item !== null);
  const chat_db = parseChatDb(record.chat_db);
  const total = parseBodyTotal(record[conversationFields.total]) ?? parseHeaderTotal(totalHeader);
  if (total != null) {
    return { conversations, total, chat_db, paging: "server" };
  }
  const q = query.q.trim().slice(0, MAX_QUERY_LENGTH);
  const filtered = q ? conversations.filter((item) => conversationMatches(item, q)) : conversations;
  const limit = clampLimit(query.limit);
  const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset)) : 0;
  return {
    conversations: filtered.slice(offset, offset + limit),
    total: filtered.length,
    chat_db,
    paging: "client",
  };
}

export function buildServerPage(items: CatalogItem[], query: ConversationQuery): { body: Record<string, unknown>; totalHeader: string } {
  const filtered = filterCatalog(items, query.q);
  const limit = clampLimit(query.limit);
  const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset)) : 0;
  const q = query.q.trim().slice(0, MAX_QUERY_LENGTH);
  const page = filtered.slice(offset, offset + limit);
  const body: Record<string, unknown> = {
    conversations: page.map(toWire),
    chat_db: { available: true, error: null },
    [conversationFields.total]: filtered.length,
    [conversationFields.limit]: limit,
    [conversationFields.offset]: offset,
    [conversationFields.q]: q ? q : null,
  };
  return { body, totalHeader: String(filtered.length) };
}
