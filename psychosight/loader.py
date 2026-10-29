"""Load and normalize one 1:1 conversation via msgexport (imported, never its Markdown)."""

from __future__ import annotations

import logging
import re
import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

from . import config, msgexport, synthetic
from .errors import DateRangeInvalid, DateRangeOutOfBounds, FullDiskAccessRequired, GroupChatUnsupported, NotFound
from .models import ConversationData, Msg, utc

log = logging.getLogger("psychosight.loader")

OBJ_REPLACEMENT = "\ufffc"
TAPBACK_RE = re.compile(
    r"^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned|Reacted .{1,8} to|Removed an? .{1,20} from)"
    r" [\u201c\"].*[\u201d\"]$",
    re.DOTALL,
)


def _fda_error(db_path: Path, exc: BaseException) -> FullDiskAccessRequired:
    return FullDiskAccessRequired(
        f"Cannot read the Messages database at {db_path} ({type(exc).__name__}). On macOS, grant Full Disk Access "
        "to the app running the backend (System Settings > Privacy & Security > Full Disk Access), then restart it. "
        "You can use the demo conversation meanwhile."
    )


def _open(db_path: Path):
    try:
        return msgexport.snapshot_connection(db_path)
    except Exception as exc:  # pragma: no cover - contextmanager creation does not raise
        raise _fda_error(db_path, exc)


def is_group(conv: msgexport.Conversation) -> bool:
    return len(conv.participants) > 1


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _day(dt: Optional[datetime]) -> Optional[str]:
    return dt.date().isoformat() if dt else None


def _bounds_fields(first: Optional[datetime], last: Optional[datetime]) -> dict:
    """first/last message timestamps (ISO 8601 with the local UTC offset, like ``latest_date``) and their
    local dates (YYYY-MM-DD, the same day convention ``date_from``/``date_to`` filter on)."""
    return {
        "first_message_at": _iso(first),
        "last_message_at": _iso(last),
        "first_message_date": _day(first),
        "last_message_date": _day(last),
    }


def conversation_summary(conv: msgexport.Conversation) -> dict:
    group = is_group(conv)
    return {
        "id": str(conv.rowid),
        "label": msgexport.conversation_title(conv),
        "message_count": conv.message_count,
        "latest_date": _iso(conv.latest_date),
        **_bounds_fields(conv.earliest_date, conv.latest_date),
        "is_group": group,
        "supported": not group,
        "is_demo": False,
        "participant_count": len(conv.participants),
    }


def _demo_msgs() -> List[Msg]:
    return normalize_rows(synthetic.generate_rows())


def demo_summary() -> dict:
    msgs = _demo_msgs()
    first = msgs[0].ts if msgs else None
    last = msgs[-1].ts if msgs else None
    return {
        "id": config.DEMO_CONVERSATION_ID,
        "label": config.DEMO_LABEL,
        "message_count": len(msgs),
        "latest_date": _iso(last),
        **_bounds_fields(first, last),
        "is_group": False,
        "supported": True,
        "is_demo": True,
        "participant_count": 1,
    }


def demo_matches(q: Optional[str]) -> bool:
    needle = (q or "").casefold().strip()
    return not needle or needle in f"{config.DEMO_LABEL} {config.DEMO_CONVERSATION_ID}".casefold()


def _conv_matches(conv: msgexport.Conversation, needle: str) -> bool:
    """Case-insensitive substring over display name/label and handles (chat identifier, participants)."""
    hay = " ".join((msgexport.conversation_title(conv), conv.label, conv.chat_name, conv.chat_identifier,
                    " ".join(conv.participants))).casefold()
    return needle in hay


def list_conversations(db_path: Optional[Path] = None, q: Optional[str] = None) -> List[dict]:
    """chat.db conversations, most recent activity first. ``q`` filters by display name or handle."""
    db_path = db_path or config.chat_db_path()
    try:
        with msgexport.snapshot_connection(db_path) as conn:
            convs = msgexport.list_conversations(conn)
    except (OSError, sqlite3.Error) as exc:
        raise _fda_error(db_path, exc)
    needle = (q or "").casefold().strip()
    if needle:
        convs = [c for c in convs if _conv_matches(c, needle)]
    log.info("listed conversations count=%d filtered=%s", len(convs), bool(needle))
    return [conversation_summary(c) for c in convs]


def resolve_date_range(
    date_from: Optional[date],
    date_to: Optional[date],
    first: Optional[datetime],
    last: Optional[datetime],
) -> Tuple[Optional[date], Optional[date], Optional[dict]]:
    """Validate/clamp an inclusive local-date range against a conversation's first..last message.

    - ``date_from > date_to``: ``DateRangeInvalid``.
    - No overlap with [first day, last day]: ``DateRangeOutOfBounds`` (message states the valid bounds).
    - Partly outside: the given end(s) are clamped to the bounds; returns a ``date_range_clamped`` record
      ``{requested, applied, bounds}`` (each ``{date_from, date_to}``), else None.
    Open ends (None) stay open. Without bounds (no dated messages) the range is returned unchanged.
    """
    if date_from and date_to and date_from > date_to:
        raise DateRangeInvalid("date_from must be on or before date_to.")
    if first is None or last is None:
        return date_from, date_to, None
    lo, hi = first.date(), last.date()
    eff_from, eff_to = date_from or lo, date_to or hi
    if eff_from > hi or eff_to < lo:
        raise DateRangeOutOfBounds(
            f"The date range does not overlap this conversation. Messages run from {lo.isoformat()} "
            f"to {hi.isoformat()} (inclusive, local dates).")
    applied_from = max(date_from, lo) if date_from else None
    applied_to = min(date_to, hi) if date_to else None
    if (applied_from, applied_to) == (date_from, date_to):
        return date_from, date_to, None

    def pair(a, b):
        return {"date_from": a.isoformat() if a else None, "date_to": b.isoformat() if b else None}

    return applied_from, applied_to, {"requested": pair(date_from, date_to), "applied": pair(applied_from, applied_to),
                                      "bounds": pair(lo, hi)}


def _clean_body(body: str) -> str:
    return (body or "").replace(OBJ_REPLACEMENT, "").strip()


def normalize_rows(
    rows: Iterable[msgexport.MessageRow],
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    group: bool = False,
) -> List[Msg]:
    seen = set()
    out: List[Msg] = []
    dropped = {"empty": 0, "tapback": 0, "dup": 0, "range": 0, "undated": 0}
    for row in rows:
        if row.guid and row.guid in seen:
            dropped["dup"] += 1
            continue
        if row.guid:
            seen.add(row.guid)
        if row.sent_at is None:
            dropped["undated"] += 1
            continue
        ts = row.sent_at if row.sent_at.tzinfo else row.sent_at.astimezone()
        local_day = ts.date()
        if (date_from and local_day < date_from) or (date_to and local_day > date_to):
            dropped["range"] += 1
            continue
        text = _clean_body(row.body)
        if not text:
            dropped["empty"] += 1  # empty or attachment-only
            continue
        if TAPBACK_RE.match(text):
            dropped["tapback"] += 1
            continue
        out.append(Msg(id=row.guid or str(row.rowid), ts=ts, speaker="me" if row.sender == "Me" else "other",
                       text=text, is_group=group))
    out.sort(key=lambda m: (utc(m.ts), m.id))
    log.info("normalized messages kept=%d dropped=%s", len(out), dropped)
    return out


def parse_date(value: Optional[str]) -> Optional[date]:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    return datetime.strptime(value, "%Y-%m-%d").date()


def load_demo(date_from: Optional[date] = None, date_to: Optional[date] = None) -> ConversationData:
    msgs = normalize_rows(synthetic.generate_rows(), date_from, date_to)
    return ConversationData(config.DEMO_CONVERSATION_ID, config.DEMO_LABEL, msgs, True, "demo")


def _short_id(value: str, limit: int = 64) -> str:
    cleaned = " ".join((value or "").split())
    if len(cleaned) > limit:
        return cleaned[:limit] + "..."
    return cleaned or "(empty)"


def find_conversation(conn, conversation_id: str) -> msgexport.Conversation:
    for conv in msgexport.list_conversations(conn):
        if str(conv.rowid) == str(conversation_id):
            return conv
    raise NotFound(f"No conversation with id '{_short_id(conversation_id)}'.")


def check_supported(
    conversation_id: str, db_path: Optional[Path] = None,
) -> Tuple[Optional[datetime], Optional[datetime]]:
    """Fast pre-check for the API: raises NotFound / GroupChatUnsupported / FullDiskAccessRequired.

    Returns the conversation's (first, last) message timestamps for date-range validation.
    """
    if conversation_id == config.DEMO_CONVERSATION_ID:
        msgs = _demo_msgs()
        return (msgs[0].ts, msgs[-1].ts) if msgs else (None, None)
    db_path = db_path or config.chat_db_path()
    try:
        with msgexport.snapshot_connection(db_path) as conn:
            conv = find_conversation(conn, conversation_id)
    except (OSError, sqlite3.Error) as exc:
        raise _fda_error(db_path, exc)
    if is_group(conv):
        raise GroupChatUnsupported("Group chats are not supported yet; pick a 1:1 conversation.")
    return conv.earliest_date, conv.latest_date


def load_conversation(
    conversation_id: str,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db_path: Optional[Path] = None,
) -> ConversationData:
    if conversation_id == config.DEMO_CONVERSATION_ID:
        return load_demo(date_from, date_to)
    db_path = db_path or config.chat_db_path()
    try:
        with msgexport.snapshot_connection(db_path) as conn:
            conv = find_conversation(conn, conversation_id)
            if is_group(conv):
                raise GroupChatUnsupported("Group chats are not supported yet; pick a 1:1 conversation.")
            rows = msgexport.fetch_messages(conn, conv)
    except (OSError, sqlite3.Error) as exc:
        raise _fda_error(db_path, exc)
    msgs = normalize_rows(rows, date_from, date_to)
    return ConversationData(str(conv.rowid), msgexport.conversation_title(conv), msgs, False, "chat.db")
