from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)


def apple_ns(dt: datetime) -> int:
    return int((dt - APPLE_EPOCH).total_seconds() * 1_000_000_000)


def make_chat_db(path: Path, chats):
    """chats: list of (participants, [(datetime, is_from_me, handle_or_None, text)])."""
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT, service_name TEXT);
        CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
        CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
        CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB, date INTEGER,
                              is_from_me INTEGER, handle_id INTEGER);
        CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
        CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, filename TEXT, transfer_name TEXT, mime_type TEXT);
        CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
        """
    )
    handles = {}
    mid = 0
    for cid, (participants, messages) in enumerate(chats, start=1):
        ident = participants[0] if len(participants) == 1 else f"chat{cid}000"
        conn.execute("INSERT INTO chat VALUES (?,?,?,?,?)", (cid, f"chat-guid-{cid}", ident, "", "iMessage"))
        for p in participants:
            if p not in handles:
                handles[p] = len(handles) + 1
                conn.execute("INSERT INTO handle VALUES (?,?)", (handles[p], p))
            conn.execute("INSERT INTO chat_handle_join VALUES (?,?)", (cid, handles[p]))
        for ts, from_me, handle, text in messages:
            mid += 1
            conn.execute("INSERT INTO message VALUES (?,?,?,?,?,?,?)",
                         (mid, f"m-{mid}", text, None, apple_ns(ts), 1 if from_me else 0,
                          0 if from_me else handles[handle]))
            conn.execute("INSERT INTO chat_message_join VALUES (?,?)", (cid, mid))
    conn.commit()
    conn.close()
    return path
