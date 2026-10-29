"""Load and normalize one 1:1 conversation via msgexport (imported, never its Markdown)."""

from __future__ import annotations

import logging
import re
import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Iterable, List, Optional

from . import config, msgexport, synthetic
from .errors import FullDiskAccessRequired, GroupChatUnsupported, NotFound
from .models import ConversationData, Msg

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


def conversation_summary(conv: msgexport.Conversation) -> dict:
    group = is_group(conv)
    return {
        "id": str(conv.rowid),
        "label": msgexport.conversation_title(conv),
        "message_count": conv.message_count,
        "latest_date": conv.latest_date.isoformat() if conv.latest_date else None,
        "is_group": group,
        "supported": not group,
        "is_demo": False,
        "participant_count": len(conv.participants),
    }


def demo_summary() -> dict:
    rows = synthetic.generate_rows()
    return {
        "id": config.DEMO_CONVERSATION_ID,
        "label": config.DEMO_LABEL,
        "message_count": len(rows),
        "latest_date": max(r.sent_at for r in rows).isoformat(),
        "is_group": False,
        "supported": True,
        "is_demo": True,
        "participant_count": 1,
    }


def list_conversations(db_path: Optional[Path] = None) -> List[dict]:
    db_path = db_path or config.chat_db_path()
    try:
        with msgexport.snapshot_connection(db_path) as conn:
            convs = msgexport.list_conversations(conn)
    except (OSError, sqlite3.Error) as exc:
        raise _fda_error(db_path, exc)
    log.info("listed conversations count=%d", len(convs))
    return [conversation_summary(c) for c in convs]


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
    out.sort(key=lambda m: (m.ts, m.id))
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


def find_conversation(conn, conversation_id: str) -> msgexport.Conversation:
    for conv in msgexport.list_conversations(conn):
        if str(conv.rowid) == str(conversation_id):
            return conv
    raise NotFound(f"No conversation with id '{conversation_id}'.")


def check_supported(conversation_id: str, db_path: Optional[Path] = None) -> None:
    """Fast pre-check for the API: raises NotFound / GroupChatUnsupported / FullDiskAccessRequired."""
    if conversation_id == config.DEMO_CONVERSATION_ID:
        return
    db_path = db_path or config.chat_db_path()
    try:
        with msgexport.snapshot_connection(db_path) as conn:
            conv = find_conversation(conn, conversation_id)
    except (OSError, sqlite3.Error) as exc:
        raise _fda_error(db_path, exc)
    if is_group(conv):
        raise GroupChatUnsupported("Group chats are not supported yet; pick a 1:1 conversation.")


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
