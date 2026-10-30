#!/usr/bin/env python3
"""Small terminal UI for exporting macOS Messages conversations."""

from __future__ import annotations

import argparse
import contextlib
import curses
import hashlib
import json
import os
import platform
import plistlib
import re
import shutil
import sqlite3
import sys
import tempfile
from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Iterator, Mapping, Optional, Union


APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
MIN_PYTHON = (3, 9)
DEFAULT_DB_PATH = Path.home() / "Library" / "Messages" / "chat.db"
DEFAULT_OUT_DIR = Path("exports")
DEFAULT_STATE_PATH = Path.home() / ".msgexport" / "state.json"
CHUNK_OPTIONS = ("day", "week", "month")
EXPORT_SCOPES = ("since_last", "full")
NANP_REGIONS = frozenset(
    {
        "AG",
        "AI",
        "AS",
        "BB",
        "BM",
        "BS",
        "CA",
        "DM",
        "DO",
        "GD",
        "GU",
        "JM",
        "KN",
        "KY",
        "LC",
        "MP",
        "MS",
        "PR",
        "SX",
        "TC",
        "TT",
        "US",
        "VC",
        "VG",
        "VI",
    }
)


@dataclass(frozen=True)
class Conversation:
    rowid: int
    guid: str
    label: str
    chat_identifier: str
    service_name: str
    message_count: int
    latest_date: Optional[datetime]
    participants: tuple[str, ...]
    chat_name: str = ""
    display_label: str = ""
    earliest_date: Optional[datetime] = None


@dataclass(frozen=True)
class ContactValue:
    label: str
    value: str


@dataclass(frozen=True)
class ContactProfile:
    contact_id: str
    display_name: str
    given_name: str = ""
    middle_name: str = ""
    family_name: str = ""
    nickname: str = ""
    organization: str = ""
    job_title: str = ""
    department: str = ""
    phones: tuple[ContactValue, ...] = ()
    emails: tuple[ContactValue, ...] = ()
    photo_data: Optional[bytes] = None
    photo_mime_type: str = ""
    region_code: str = ""


@dataclass(frozen=True)
class AttachmentRef:
    filename: str
    transfer_name: str
    mime_type: str


@dataclass(frozen=True)
class MessageRow:
    rowid: int
    guid: str
    raw_date: int
    sent_at: Optional[datetime]
    sender: str
    body: str
    attachments: tuple[AttachmentRef, ...]
    display_sender: str = ""


@dataclass(frozen=True)
class ExportCutoff:
    message_rowid: int
    message_guid: str
    message_date: int
    exported_at: str
    label: str

    @classmethod
    def from_dict(cls, value: object) -> Optional["ExportCutoff"]:
        if not isinstance(value, dict):
            return None
        try:
            return cls(
                message_rowid=int(value["message_rowid"]),
                message_guid=str(value.get("message_guid") or ""),
                message_date=int(value.get("message_date") or 0),
                exported_at=str(value.get("exported_at") or ""),
                label=str(value.get("label") or ""),
            )
        except (KeyError, TypeError, ValueError):
            return None

    def to_dict(self) -> dict[str, object]:
        return {
            "message_rowid": self.message_rowid,
            "message_guid": self.message_guid,
            "message_date": self.message_date,
            "exported_at": self.exported_at,
            "label": self.label,
        }


@dataclass(frozen=True)
class ExportResult:
    output_dir: Optional[Path]
    file_count: int
    message_count: int
    scope: str
    previous_cutoff: Optional[ExportCutoff]
    new_cutoff: Optional[ExportCutoff]


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export a selected iMessage conversation to chunked Markdown files."
    )
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB_PATH),
        help=f"Path to Messages chat.db. Default: {DEFAULT_DB_PATH}",
    )
    parser.add_argument(
        "--out",
        default=str(DEFAULT_OUT_DIR),
        help=f"Output directory. Default: {DEFAULT_OUT_DIR}",
    )
    parser.add_argument(
        "--state",
        default=str(DEFAULT_STATE_PATH),
        help=f"Cutoff state file. Default: {DEFAULT_STATE_PATH}",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check local setup and Messages database access, then exit.",
    )
    return parser.parse_args(argv)


def expand_path(path: Union[str, os.PathLike[str]]) -> Path:
    return Path(path).expanduser().resolve()


def database_state_key(db_path: Path) -> str:
    return hashlib.sha256(str(db_path).encode("utf-8")).hexdigest()[:24]


class StateStore:
    def __init__(self, path: Path, db_path: Path):
        self.path = path
        self.db_path = db_path
        self.db_key = database_state_key(db_path)
        self._data: Optional[dict[str, object]] = None

    def load(self) -> dict[str, object]:
        if self._data is not None:
            return self._data
        if not self.path.exists():
            self._data = {"version": 1, "databases": {}}
            return self._data
        with self.path.open("r", encoding="utf-8") as fh:
            loaded = json.load(fh)
        if not isinstance(loaded, dict):
            raise RuntimeError(f"Invalid state file: {self.path}")
        loaded.setdefault("version", 1)
        loaded.setdefault("databases", {})
        if not isinstance(loaded["databases"], dict):
            raise RuntimeError(f"Invalid state file databases section: {self.path}")
        self._data = loaded
        return self._data

    def save(self) -> None:
        data = self.load()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.path.parent, 0o700)
        except OSError:
            pass

        fd, temp_name = tempfile.mkstemp(
            prefix=".state-",
            suffix=".json",
            dir=self.path.parent,
            text=True,
        )
        temp_path = Path(temp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2, sort_keys=True)
                fh.write("\n")
            os.replace(temp_path, self.path)
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def database_state(self) -> dict[str, object]:
        data = self.load()
        databases = data.setdefault("databases", {})
        if not isinstance(databases, dict):
            raise RuntimeError(f"Invalid state file databases section: {self.path}")
        database = databases.setdefault(
            self.db_key,
            {"path": str(self.db_path), "conversations": {}},
        )
        if not isinstance(database, dict):
            database = {"path": str(self.db_path), "conversations": {}}
            databases[self.db_key] = database
        database["path"] = str(self.db_path)
        conversations = database.setdefault("conversations", {})
        if not isinstance(conversations, dict):
            database["conversations"] = {}
        return database

    def get_cutoff(self, conversation: Conversation) -> Optional[ExportCutoff]:
        database = self.database_state()
        conversations = database.get("conversations", {})
        if not isinstance(conversations, dict):
            return None
        return ExportCutoff.from_dict(conversations.get(conversation.guid))

    def set_cutoff(self, conversation: Conversation, cutoff: ExportCutoff) -> None:
        database = self.database_state()
        conversations = database.setdefault("conversations", {})
        if not isinstance(conversations, dict):
            conversations = {}
            database["conversations"] = conversations
        conversations[conversation.guid] = cutoff.to_dict()
        self.save()


@contextlib.contextmanager
def snapshot_connection(db_path: Path) -> Iterator[sqlite3.Connection]:
    """Open Messages read-only, copy it to a temp DB, and query the copy."""
    if not db_path.exists():
        raise FileNotFoundError(f"Messages database not found: {db_path}")

    temp_dir = Path(tempfile.mkdtemp(prefix="msgexport-"))
    snapshot_path = temp_dir / "chat.db"
    try:
        source: Optional[sqlite3.Connection] = None
        target: Optional[sqlite3.Connection] = None
        try:
            source_uri = sqlite_readonly_uri(db_path)
            source = sqlite3.connect(source_uri, uri=True)
            target = sqlite3.connect(snapshot_path)
            source.backup(target)
        finally:
            if target is not None:
                target.close()
            if source is not None:
                source.close()

        conn = sqlite3.connect(snapshot_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def sqlite_readonly_uri(db_path: Path) -> str:
    return f"{db_path.resolve().as_uri()}?mode=ro"


def imessage_date_to_datetime(value: Optional[Union[int, float]]) -> Optional[datetime]:
    if value in (None, 0):
        return None
    raw = float(value)
    seconds = raw / 1_000_000_000 if abs(raw) > 1_000_000_000_000 else raw
    return (APPLE_EPOCH + timedelta(seconds=seconds)).astimezone()


def list_conversations(conn: sqlite3.Connection) -> list[Conversation]:
    participant_rows = conn.execute(
        """
        SELECT chj.chat_id, h.id
        FROM chat_handle_join chj
        JOIN handle h ON h.ROWID = chj.handle_id
        ORDER BY h.id COLLATE NOCASE
        """
    ).fetchall()
    participants_by_chat: dict[int, list[str]] = defaultdict(list)
    for row in participant_rows:
        participants_by_chat[int(row["chat_id"])].append(row["id"] or "")

    rows = conn.execute(
        """
        SELECT
            c.ROWID AS rowid,
            c.guid,
            c.chat_identifier,
            c.display_name,
            c.service_name,
            COUNT(m.ROWID) AS message_count,
            MAX(m.date) AS latest_date,
            MIN(NULLIF(m.date, 0)) AS earliest_date
        FROM chat c
        LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
        LEFT JOIN message m ON m.ROWID = cmj.message_id
        GROUP BY c.ROWID
        HAVING message_count > 0
        ORDER BY latest_date DESC, c.ROWID DESC
        """
    ).fetchall()

    conversations: list[Conversation] = []
    for row in rows:
        participants = tuple(
            p for p in participants_by_chat.get(int(row["rowid"]), []) if p
        )
        label = conversation_label(
            display_name=row["display_name"],
            chat_identifier=row["chat_identifier"],
            participants=participants,
            fallback_guid=row["guid"],
            rowid=int(row["rowid"]),
        )
        conversations.append(
            Conversation(
                rowid=int(row["rowid"]),
                guid=row["guid"] or "",
                label=label,
                chat_identifier=row["chat_identifier"] or "",
                service_name=row["service_name"] or "",
                message_count=int(row["message_count"] or 0),
                latest_date=imessage_date_to_datetime(row["latest_date"]),
                participants=participants,
                chat_name=(row["display_name"] or "").strip(),
                earliest_date=imessage_date_to_datetime(row["earliest_date"]),
            )
        )
    return conversations


def conversation_label(
    *,
    display_name: Optional[str],
    chat_identifier: Optional[str],
    participants: Iterable[str],
    fallback_guid: Optional[str],
    rowid: int,
) -> str:
    if display_name and display_name.strip():
        return display_name.strip()
    if chat_identifier and chat_identifier.strip():
        return chat_identifier.strip()

    participant_list = [p for p in participants if p]
    if participant_list:
        shown = participant_list[:3]
        suffix = f" (+{len(participant_list) - 3})" if len(participant_list) > 3 else ""
        return ", ".join(shown) + suffix

    if fallback_guid:
        return fallback_guid
    return f"Chat {rowid}"


def conversation_title(conversation: Conversation) -> str:
    """Return the friendly label when enrichment is available."""
    return conversation.display_label or conversation.label


def identifier_match_keys(
    value: str,
    region_code: str = "",
) -> tuple[str, ...]:
    """Return conservative email/phone keys for matching Messages handles."""
    normalized = (value or "").strip()
    if not normalized:
        return ()
    lowered = normalized.casefold()
    if lowered.startswith("mailto:"):
        lowered = lowered[7:]
    if "@" in lowered:
        return (f"email:{lowered}",)
    if lowered.startswith("tel:"):
        normalized = normalized[4:].strip()
        lowered = normalized.casefold()

    phone_value = re.sub(
        r"(?:;ext=|ext\.?|x)\s*\d+\s*$",
        "",
        normalized,
        flags=re.IGNORECASE,
    )
    digits = re.sub(r"\D", "", phone_value)
    if len(digits) < 7:
        return (f"identifier:{lowered}",)

    source = phone_value.strip()
    international = source.startswith("+") or source.startswith("00")
    canonical_digits = (
        digits[2:]
        if source.startswith("00") and digits.startswith("00")
        else digits
    )
    keys = [f"phone:{canonical_digits}"]
    region = (region_code or "").strip().upper()

    # Cross-format aliases are deliberately limited to representations whose
    # country code and local trunk form agree with the Mac's current region.
    # Generic suffix matching can confuse unrelated numbers across countries.
    if international:
        if (
            region in NANP_REGIONS
            and len(canonical_digits) == 11
            and canonical_digits.startswith("1")
        ):
            keys.append(f"phone:nanp:{canonical_digits[1:]}")
        elif region in {"GB", "UK"} and canonical_digits.startswith("44"):
            national = canonical_digits[2:]
            if len(national) in {9, 10}:
                keys.append(f"phone:trunk:44:0{national}")
        elif region == "KR" and canonical_digits.startswith("82"):
            national = canonical_digits[2:]
            if len(national) in {8, 9, 10}:
                keys.append(f"phone:trunk:82:0{national}")
    else:
        if (
            region in NANP_REGIONS
            and len(canonical_digits) == 10
            and canonical_digits[0] in "23456789"
        ):
            keys.append(f"phone:nanp:{canonical_digits}")
        elif (
            region in NANP_REGIONS
            and len(canonical_digits) == 11
            and canonical_digits.startswith("1")
        ):
            keys.append(f"phone:nanp:{canonical_digits[1:]}")
        if (
            region in {"GB", "UK"}
            and len(canonical_digits) in {10, 11}
            and canonical_digits.startswith("0")
        ):
            keys.append(f"phone:trunk:44:{canonical_digits}")
        if (
            region == "KR"
            and re.fullmatch(
                r"(?:02\d{7,8}|0(?:1\d|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70)"
                r"\d{7,8})",
                canonical_digits,
            )
        ):
            keys.append(f"phone:trunk:82:{canonical_digits}")
    return tuple(dict.fromkeys(keys))


def contact_for_identifier(
    identifier: str,
    contacts: Optional[Mapping[str, ContactProfile]],
) -> Optional[ContactProfile]:
    if not contacts:
        return None
    direct = contacts.get(identifier)
    if direct is not None:
        return direct

    matches: dict[str, ContactProfile] = {}
    for candidate, profile in contacts.items():
        wanted = set(
            identifier_match_keys(identifier, profile.region_code)
        )
        if wanted.intersection(
            identifier_match_keys(candidate, profile.region_code)
        ):
            matches[profile.contact_id] = profile
    if len(matches) != 1:
        return None
    return next(iter(matches.values()))


def contact_display_name(profile: ContactProfile, fallback: str) -> str:
    for value in (
        profile.display_name,
        profile.nickname,
        " ".join(
            part
            for part in (
                profile.given_name,
                profile.middle_name,
                profile.family_name,
            )
            if part
        ),
        profile.organization,
    ):
        if value and value.strip():
            return value.strip()
    return fallback


def identifier_hint(identifier: str) -> str:
    if "@" in identifier:
        return identifier
    digits = re.sub(r"\D", "", identifier)
    if len(digits) >= 4:
        return f"••• {digits[-4:]}"
    return identifier


def duplicate_contact_display_names(
    conversation: Conversation,
    contacts: Optional[Mapping[str, ContactProfile]],
) -> set[str]:
    """Return names shared by multiple distinct contacts in a conversation."""
    if not contacts:
        return set()
    counts: dict[str, int] = defaultdict(int)
    seen_contacts: set[str] = set()
    for identifier in conversation.participants:
        profile = contact_for_identifier(identifier, contacts)
        if profile is None or profile.contact_id in seen_contacts:
            continue
        seen_contacts.add(profile.contact_id)
        counts[contact_display_name(profile, identifier).casefold()] += 1
    return {name for name, count in counts.items() if count > 1}


def enrich_conversation(
    conversation: Conversation,
    contacts: Optional[Mapping[str, ContactProfile]],
) -> Conversation:
    """Add a Contacts-derived display label without changing stable raw fields."""
    if conversation.chat_name or not contacts:
        return conversation

    resolved: list[tuple[str, str, Optional[ContactProfile]]] = []
    seen_contacts: set[str] = set()
    matched_any = False
    for identifier in conversation.participants:
        profile = contact_for_identifier(identifier, contacts)
        if profile is not None:
            matched_any = True
            if profile.contact_id in seen_contacts:
                continue
            seen_contacts.add(profile.contact_id)
            name = contact_display_name(profile, identifier)
        else:
            name = identifier
        resolved.append((name, identifier, profile))

    if not matched_any or not resolved:
        return conversation

    name_counts: dict[str, int] = defaultdict(int)
    for name, _, profile in resolved:
        if profile is not None:
            name_counts[name.casefold()] += 1

    names: list[str] = []
    for name, identifier, profile in resolved:
        if profile is not None and name_counts[name.casefold()] > 1:
            names.append(f"{name} ({identifier_hint(identifier)})")
        else:
            names.append(name)
    shown = names[:3]
    suffix = f" (+{len(names) - 3})" if len(names) > 3 else ""
    return replace(conversation, display_label=", ".join(shown) + suffix)


def fetch_messages(
    conn: sqlite3.Connection,
    conversation: Conversation,
    cutoff: Optional[ExportCutoff] = None,
    contacts: Optional[Mapping[str, ContactProfile]] = None,
) -> list[MessageRow]:
    cutoff_rowid = cutoff.message_rowid if cutoff else 0
    attachment_rows = conn.execute(
        """
        SELECT
            maj.message_id,
            COALESCE(a.filename, '') AS filename,
            COALESCE(a.transfer_name, '') AS transfer_name,
            COALESCE(a.mime_type, '') AS mime_type
        FROM chat_message_join cmj
        JOIN message_attachment_join maj ON maj.message_id = cmj.message_id
        JOIN attachment a ON a.ROWID = maj.attachment_id
        WHERE cmj.chat_id = ?
          AND maj.message_id > ?
        ORDER BY maj.message_id, a.ROWID
        """,
        (conversation.rowid, cutoff_rowid),
    ).fetchall()
    attachments_by_message: dict[int, list[AttachmentRef]] = defaultdict(list)
    for row in attachment_rows:
        attachments_by_message[int(row["message_id"])].append(
            AttachmentRef(
                filename=row["filename"],
                transfer_name=row["transfer_name"],
                mime_type=row["mime_type"],
            )
        )

    rows = conn.execute(
        """
        SELECT
            m.ROWID AS rowid,
            m.guid,
            m.text,
            m.attributedBody,
            m.date,
            m.is_from_me,
            h.id AS handle_id
        FROM chat_message_join cmj
        JOIN message m ON m.ROWID = cmj.message_id
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        WHERE cmj.chat_id = ?
          AND m.ROWID > ?
        ORDER BY m.date ASC, m.ROWID ASC
        """,
        (conversation.rowid, cutoff_rowid),
    ).fetchall()

    duplicate_names = duplicate_contact_display_names(conversation, contacts)
    messages: list[MessageRow] = []
    for row in rows:
        body = message_body(row["text"], row["attributedBody"])
        sender = "Me" if int(row["is_from_me"] or 0) else (row["handle_id"] or "Unknown")
        profile = None if sender == "Me" else contact_for_identifier(sender, contacts)
        display_sender = contact_display_name(profile, sender) if profile else ""
        if display_sender.casefold() in duplicate_names:
            display_sender = f"{display_sender} ({identifier_hint(sender)})"
        messages.append(
            MessageRow(
                rowid=int(row["rowid"]),
                guid=row["guid"] or "",
                raw_date=int(row["date"] or 0),
                sent_at=imessage_date_to_datetime(row["date"]),
                sender=sender,
                body=body,
                attachments=tuple(attachments_by_message.get(int(row["rowid"]), [])),
                display_sender=display_sender,
            )
        )
    return messages


def message_body(text: Optional[str], attributed_body: Optional[bytes]) -> str:
    if text:
        return text
    return decode_attributed_body(attributed_body)


def decode_attributed_body(blob: Optional[bytes]) -> str:
    if not blob:
        return ""

    try:
        archive = plistlib.loads(blob)
    except Exception:
        return decode_blob_fallback(blob)

    objects = archive.get("$objects") if isinstance(archive, dict) else None
    if isinstance(objects, list):
        for obj in objects:
            if isinstance(obj, dict):
                for key in ("NSString", "NS.string", "NSCString"):
                    if key in obj:
                        value = resolve_plist_ref(objects, obj[key])
                        candidate = normalize_body_candidate(value)
                        if candidate is not None:
                            return candidate

    candidates = [
        candidate
        for candidate in walk_plist_strings(archive)
        if looks_like_message_text(candidate)
    ]
    if candidates:
        return max(candidates, key=len)

    return decode_blob_fallback(blob)


def resolve_plist_ref(objects: list[object], value: object) -> object:
    if isinstance(value, plistlib.UID):
        index = value.data
        if 0 <= index < len(objects):
            return objects[index]
    return value


def normalize_body_candidate(value: object) -> Optional[str]:
    if isinstance(value, str):
        return value
    if isinstance(value, bytes):
        decoded = decode_blob_fallback(value)
        return decoded or None
    return None


def walk_plist_strings(value: object) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, inner in value.items():
            if isinstance(key, str) and looks_like_message_text(key):
                yield key
            yield from walk_plist_strings(inner)
    elif isinstance(value, (list, tuple)):
        for inner in value:
            yield from walk_plist_strings(inner)


def looks_like_message_text(value: str) -> bool:
    if not value:
        return False
    ignored_prefixes = ("$", "NS", "__k", "IM", "NSNumber", "NSDictionary")
    ignored_exact = {
        "NSString",
        "NSObject",
        "NSMutableString",
        "NSAttributedString",
        "NSAttributes",
        "NSColor",
        "NSFont",
        "NSParagraphStyle",
    }
    stripped = value.strip()
    if not stripped or stripped in ignored_exact:
        return False
    return not stripped.startswith(ignored_prefixes)


def decode_blob_fallback(blob: bytes) -> str:
    decoded = blob.decode("utf-8", errors="ignore")
    decoded = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]+", " ", decoded)
    decoded = re.sub(r"\s+", " ", decoded).strip()
    return decoded


def slugify(value: str, limit: int = 60) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    slug = re.sub(r"-+", "-", slug)
    return (slug[:limit].strip("-") or "conversation")


def chunk_key(dt: Optional[datetime], chunk: str) -> str:
    if dt is None:
        return "unknown-date"
    if chunk == "day":
        return dt.strftime("%Y-%m-%d")
    if chunk == "week":
        iso = dt.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    if chunk == "month":
        return dt.strftime("%Y-%m")
    raise ValueError(f"Unsupported chunk: {chunk}")


def export_scope_label(scope: str) -> str:
    if scope == "since_last":
        return "Since last export"
    if scope == "full":
        return "Full conversation"
    return scope


def format_cutoff(cutoff: ExportCutoff) -> str:
    date = imessage_date_to_datetime(cutoff.message_date)
    if date:
        date_text = date.strftime("%Y-%m-%d %H:%M:%S %Z")
    else:
        date_text = "unknown date"
    return f"row {cutoff.message_rowid} ({date_text})"


def unique_output_dir(
    base_dir: Path,
    conversation: Conversation,
    chunk: str,
    scope: str = "full",
) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    scope_part = "since-last-" if scope == "since_last" else ""
    base_name = (
        f"{slugify(conversation_title(conversation))}-"
        f"{scope_part}{chunk}-{timestamp}"
    )
    candidate = base_dir / base_name
    suffix = 2
    while candidate.exists():
        candidate = base_dir / f"{base_name}-{suffix}"
        suffix += 1
    return candidate


def cutoff_from_messages(
    conversation: Conversation,
    messages: list[MessageRow],
) -> Optional[ExportCutoff]:
    if not messages:
        return None
    newest = max(messages, key=lambda message: message.rowid)
    return ExportCutoff(
        message_rowid=newest.rowid,
        message_guid=newest.guid,
        message_date=newest.raw_date,
        exported_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        label=conversation.label,
    )


def photo_extension(mime_type: str, data: bytes) -> str:
    normalized = (mime_type or "").casefold().split(";", 1)[0]
    extensions = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/tiff": ".tiff",
        "image/heic": ".heic",
        "image/heif": ".heif",
    }
    if normalized in extensions:
        return extensions[normalized]
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if data.startswith((b"II*\x00", b"MM\x00*")):
        return ".tiff"
    return ".img"


def write_contact_photos(
    destination: Path,
    conversation: Conversation,
    contacts: Optional[Mapping[str, ContactProfile]],
) -> dict[str, Path]:
    photo_paths: dict[str, Path] = {}
    if not contacts:
        return photo_paths

    profiles: dict[str, ContactProfile] = {}
    for identifier in conversation.participants:
        profile = contact_for_identifier(identifier, contacts)
        if profile is not None and profile.photo_data:
            profiles[profile.contact_id] = profile
    if not profiles:
        return photo_paths

    contacts_dir = destination / "contacts"
    contacts_dir.mkdir(mode=0o700)
    for profile in profiles.values():
        photo_data = profile.photo_data or b""
        digest = hashlib.sha256(profile.contact_id.encode("utf-8")).hexdigest()[:10]
        stem = slugify(contact_display_name(profile, "contact"), limit=42)
        relative_path = Path("contacts") / (
            f"{stem}-{digest}{photo_extension(profile.photo_mime_type, photo_data)}"
        )
        output_path = destination / relative_path
        output_path.write_bytes(photo_data)
        try:
            os.chmod(output_path, 0o600)
        except OSError:
            pass
        photo_paths[profile.contact_id] = relative_path
    return photo_paths


def markdown_text(value: str) -> str:
    single_line = " ".join((value or "").replace("\x00", "").split())
    return re.sub(r"([\\`*_\[\]<>])", r"\\\1", single_line)


def markdown_code(value: str) -> str:
    single_line = " ".join((value or "").replace("\x00", "").split())
    return f"`{single_line.replace('`', '′')}`"


def contact_role(profile: ContactProfile) -> str:
    role_parts = [
        value.strip()
        for value in (profile.job_title, profile.department)
        if value and value.strip()
    ]
    role = ", ".join(dict.fromkeys(role_parts))
    organization = profile.organization.strip()
    if role and organization:
        return f"{role} at {organization}"
    return role or organization


def contact_values_markdown(values: Iterable[ContactValue]) -> str:
    parts: list[str] = []
    for item in values:
        label = markdown_text(item.label or "Other")
        parts.append(f"{label}: {markdown_code(item.value)}")
    return "; ".join(parts)


def write_contact_summary(
    fh: object,
    conversation: Conversation,
    contacts: Optional[Mapping[str, ContactProfile]],
    photo_paths: Mapping[str, Path],
) -> None:
    if not contacts:
        return

    entries: list[tuple[str, Optional[ContactProfile]]] = []
    seen_profiles: set[str] = set()
    has_match = False
    for identifier in conversation.participants:
        profile = contact_for_identifier(identifier, contacts)
        if profile is not None:
            has_match = True
            if profile.contact_id in seen_profiles:
                continue
            seen_profiles.add(profile.contact_id)
        entries.append((identifier, profile))
    if not has_match:
        return

    fh.write("- Participants:\n")
    for identifier, profile in entries:
        if profile is None:
            fh.write(f"  - {markdown_code(identifier)}\n")
            continue

        name = markdown_text(contact_display_name(profile, identifier))
        details = [f"**{name}**", f"Messages: {markdown_code(identifier)}"]
        role = contact_role(profile)
        if role:
            details.append(markdown_text(role))
        photo_path = photo_paths.get(profile.contact_id)
        if photo_path is not None:
            details.append(f"[Profile photo]({photo_path.as_posix()})")
        fh.write(f"  - {' — '.join(details)}\n")

        phones = contact_values_markdown(profile.phones)
        if phones:
            fh.write(f"    - Phones: {phones}\n")
        emails = contact_values_markdown(profile.emails)
        if emails:
            fh.write(f"    - Emails: {emails}\n")


def export_conversation(
    conn: sqlite3.Connection,
    conversation: Conversation,
    chunk: str,
    out_dir: Path,
    scope: str = "full",
    cutoff: Optional[ExportCutoff] = None,
    state_store: Optional[StateStore] = None,
    contacts: Optional[Mapping[str, ContactProfile]] = None,
) -> ExportResult:
    if chunk not in CHUNK_OPTIONS:
        raise ValueError(f"chunk must be one of {', '.join(CHUNK_OPTIONS)}")
    if scope not in EXPORT_SCOPES:
        raise ValueError(f"scope must be one of {', '.join(EXPORT_SCOPES)}")

    active_cutoff = cutoff if scope == "since_last" else None
    display_conversation = enrich_conversation(conversation, contacts)
    messages = fetch_messages(
        conn,
        conversation,
        active_cutoff,
        contacts=contacts,
    )
    if not messages:
        return ExportResult(
            output_dir=None,
            file_count=0,
            message_count=0,
            scope=scope,
            previous_cutoff=active_cutoff,
            new_cutoff=None,
        )

    destination = unique_output_dir(out_dir, display_conversation, chunk, scope)
    destination.mkdir(parents=True, exist_ok=False)
    photo_paths = write_contact_photos(
        destination,
        display_conversation,
        contacts,
    )

    grouped: dict[str, list[MessageRow]] = defaultdict(list)
    for message in messages:
        grouped[chunk_key(message.sent_at, chunk)].append(message)

    for key in sorted(grouped):
        write_markdown_chunk(
            destination / f"{key}.md",
            display_conversation,
            chunk,
            key,
            grouped[key],
            scope,
            active_cutoff,
            contacts,
            photo_paths,
        )

    new_cutoff = cutoff_from_messages(conversation, messages)
    if new_cutoff and state_store:
        state_store.set_cutoff(conversation, new_cutoff)

    return ExportResult(
        output_dir=destination,
        file_count=len(grouped),
        message_count=len(messages),
        scope=scope,
        previous_cutoff=active_cutoff,
        new_cutoff=new_cutoff,
    )


def write_markdown_chunk(
    path: Path,
    conversation: Conversation,
    chunk: str,
    key: str,
    messages: list[MessageRow],
    scope: str = "full",
    previous_cutoff: Optional[ExportCutoff] = None,
    contacts: Optional[Mapping[str, ContactProfile]] = None,
    photo_paths: Optional[Mapping[str, Path]] = None,
) -> None:
    with path.open("w", encoding="utf-8") as fh:
        fh.write(f"# {markdown_text(conversation_title(conversation))}\n\n")
        fh.write(f"- Chunk: {chunk} / {key}\n")
        fh.write(f"- Export scope: {export_scope_label(scope)}\n")
        if previous_cutoff:
            fh.write(f"- Previous cutoff: {format_cutoff(previous_cutoff)}\n")
        fh.write(f"- Service: {conversation.service_name or 'Unknown'}\n")
        fh.write(f"- Messages: {len(messages)}\n")
        write_contact_summary(
            fh,
            conversation,
            contacts,
            photo_paths or {},
        )
        fh.write("\n")

        for message in messages:
            timestamp = (
                message.sent_at.strftime("%Y-%m-%d %H:%M:%S %Z")
                if message.sent_at
                else "Unknown time"
            )
            sender = message.display_sender or message.sender
            fh.write(f"## {timestamp} - {markdown_text(sender)}\n\n")
            fh.write((message.body or "[No text]").rstrip() + "\n\n")
            if message.attachments:
                fh.write("Attachments:\n")
                for attachment in message.attachments:
                    label = attachment.transfer_name or Path(attachment.filename).name or "Attachment"
                    detail = attachment.filename or "No local filename"
                    mime = f" ({attachment.mime_type})" if attachment.mime_type else ""
                    fh.write(f"- {label}: {detail}{mime}\n")
                fh.write("\n")


def filter_conversations(
    conversations: list[Conversation],
    query: str,
) -> list[Conversation]:
    needle = query.casefold().strip()
    if not needle:
        return conversations
    return [
        conversation
        for conversation in conversations
        if needle in conversation_search_text(conversation)
    ]


def conversation_search_text(conversation: Conversation) -> str:
    values = (
        conversation.label,
        conversation.chat_identifier,
        conversation.service_name,
        " ".join(conversation.participants),
    )
    return " ".join(values).casefold()


def run_tui(conn: sqlite3.Connection, out_dir: Path, state_store: StateStore) -> None:
    conversations = list_conversations(conn)
    if not conversations:
        raise RuntimeError("No conversations were found in the Messages database.")
    curses.wrapper(tui_main, conversations, conn, out_dir, state_store)


def tui_main(
    stdscr: curses.window,
    conversations: list[Conversation],
    conn: sqlite3.Connection,
    out_dir: Path,
    state_store: StateStore,
) -> None:
    curses.curs_set(0)
    stdscr.keypad(True)
    if curses.has_colors():
        curses.start_color()
        curses.use_default_colors()
        curses.init_pair(1, curses.COLOR_BLACK, curses.COLOR_CYAN)
        curses.init_pair(2, curses.COLOR_CYAN, -1)

    conversation = choose_conversation(stdscr, conversations, state_store)
    if conversation is None:
        return
    cutoff = state_store.get_cutoff(conversation)
    scope = "full"
    if cutoff:
        selected_scope = choose_export_scope(stdscr, conversation, cutoff)
        if selected_scope is None:
            return
        scope = selected_scope
    chunk = choose_chunk(stdscr, conversation)
    if chunk is None:
        return

    show_busy(stdscr, conversation, chunk, scope)
    result = export_conversation(
        conn,
        conversation,
        chunk,
        out_dir,
        scope=scope,
        cutoff=cutoff,
        state_store=state_store,
    )
    show_result(stdscr, result)


def choose_conversation(
    stdscr: curses.window,
    conversations: list[Conversation],
    state_store: StateStore,
) -> Optional[Conversation]:
    query = ""
    selected = 0
    scroll = 0

    while True:
        filtered = filter_conversations(conversations, query)
        selected = max(0, min(selected, len(filtered) - 1))
        height, width = stdscr.getmaxyx()
        list_height = max(1, height - 5)
        if selected < scroll:
            scroll = selected
        elif selected >= scroll + list_height:
            scroll = selected - list_height + 1

        stdscr.clear()
        draw_title(stdscr, "Select Conversation")
        draw_line(stdscr, 1, f"Search: {query}", width)
        draw_line(stdscr, 2, "Enter export | / search | Esc clear | q quit", width)

        visible = filtered[scroll : scroll + list_height]
        if not visible:
            draw_line(stdscr, 4, "No matching conversations.", width)
        for idx, conversation in enumerate(visible, start=scroll):
            y = 4 + idx - scroll
            marker = ">" if idx == selected else " "
            latest = (
                conversation.latest_date.strftime("%Y-%m-%d")
                if conversation.latest_date
                else "unknown"
            )
            cutoff = state_store.get_cutoff(conversation)
            cutoff_text = f" cutoff {format_cutoff(cutoff)}" if cutoff else ""
            line = (
                f"{marker} {conversation.label} "
                f"[{conversation.service_name or 'Unknown'}] "
                f"{conversation.message_count} msgs latest {latest}"
                f"{cutoff_text}"
            )
            attr = curses.color_pair(1) if idx == selected else curses.A_NORMAL
            draw_line(stdscr, y, line, width, attr)

        stdscr.refresh()
        key = stdscr.getch()
        if key in (ord("q"), ord("Q")):
            return None
        if key in (10, 13, curses.KEY_ENTER):
            return filtered[selected] if filtered else None
        if key in (curses.KEY_UP, ord("k")):
            selected = max(0, selected - 1)
        elif key in (curses.KEY_DOWN, ord("j")):
            selected = min(max(0, len(filtered) - 1), selected + 1)
        elif key in (curses.KEY_NPAGE,):
            selected = min(max(0, len(filtered) - 1), selected + list_height)
        elif key in (curses.KEY_PPAGE,):
            selected = max(0, selected - list_height)
        elif key in (27,):
            query = ""
            selected = 0
            scroll = 0
        elif key in (curses.KEY_BACKSPACE, 127, 8):
            query = query[:-1]
            selected = 0
            scroll = 0
        elif key == ord("/"):
            curses.curs_set(1)
            query = prompt_query(stdscr, query)
            curses.curs_set(0)
            selected = 0
            scroll = 0
        elif 32 <= key <= 126:
            query += chr(key)
            selected = 0
            scroll = 0


def prompt_query(stdscr: curses.window, initial: str) -> str:
    query = initial
    while True:
        height, width = stdscr.getmaxyx()
        draw_line(stdscr, height - 1, f"Search: {query}", width, curses.color_pair(2))
        stdscr.move(height - 1, min(width - 1, len("Search: ") + len(query)))
        stdscr.refresh()
        key = stdscr.getch()
        if key in (10, 13, curses.KEY_ENTER):
            return query
        if key in (27,):
            return initial
        if key in (curses.KEY_BACKSPACE, 127, 8):
            query = query[:-1]
        elif 32 <= key <= 126:
            query += chr(key)


def choose_export_scope(
    stdscr: curses.window,
    conversation: Conversation,
    cutoff: ExportCutoff,
) -> Optional[str]:
    options = ("since_last", "full")
    selected = 0
    while True:
        height, width = stdscr.getmaxyx()
        stdscr.clear()
        draw_title(stdscr, "Choose Export Scope")
        draw_line(stdscr, 2, f"Conversation: {conversation.label}", width)
        draw_line(stdscr, 3, f"Last cutoff: {format_cutoff(cutoff)}", width)
        draw_line(stdscr, 5, "Enter choose | q quit", width)
        for idx, option in enumerate(options):
            label = export_scope_label(option)
            attr = curses.color_pair(1) if idx == selected else curses.A_NORMAL
            draw_line(stdscr, 7 + idx, f"{'>' if idx == selected else ' '} {label}", width, attr)
        stdscr.refresh()

        key = stdscr.getch()
        if key in (ord("q"), ord("Q"), 27):
            return None
        if key in (10, 13, curses.KEY_ENTER):
            return options[selected]
        if key in (curses.KEY_UP, curses.KEY_LEFT, ord("k")):
            selected = (selected - 1) % len(options)
        elif key in (curses.KEY_DOWN, curses.KEY_RIGHT, ord("j")):
            selected = (selected + 1) % len(options)


def choose_chunk(stdscr: curses.window, conversation: Conversation) -> Optional[str]:
    selected = 0
    while True:
        height, width = stdscr.getmaxyx()
        stdscr.clear()
        draw_title(stdscr, "Choose Chunk Size")
        draw_line(stdscr, 2, f"Conversation: {conversation.label}", width)
        draw_line(stdscr, 3, f"Messages: {conversation.message_count}", width)
        draw_line(stdscr, 5, "Enter export | q quit", width)
        for idx, option in enumerate(CHUNK_OPTIONS):
            label = option.capitalize()
            attr = curses.color_pair(1) if idx == selected else curses.A_NORMAL
            draw_line(stdscr, 7 + idx, f"{'>' if idx == selected else ' '} {label}", width, attr)
        stdscr.refresh()

        key = stdscr.getch()
        if key in (ord("q"), ord("Q"), 27):
            return None
        if key in (10, 13, curses.KEY_ENTER):
            return CHUNK_OPTIONS[selected]
        if key in (curses.KEY_UP, curses.KEY_LEFT, ord("k")):
            selected = (selected - 1) % len(CHUNK_OPTIONS)
        elif key in (curses.KEY_DOWN, curses.KEY_RIGHT, ord("j")):
            selected = (selected + 1) % len(CHUNK_OPTIONS)


def show_busy(
    stdscr: curses.window,
    conversation: Conversation,
    chunk: str,
    scope: str,
) -> None:
    height, width = stdscr.getmaxyx()
    stdscr.clear()
    draw_title(stdscr, "Exporting")
    draw_line(stdscr, 2, f"Conversation: {conversation.label}", width)
    draw_line(stdscr, 3, f"Scope: {export_scope_label(scope)}", width)
    draw_line(stdscr, 4, f"Chunk: {chunk}", width)
    draw_line(stdscr, min(height - 2, 6), "Writing Markdown files...", width)
    stdscr.refresh()


def show_result(stdscr: curses.window, result: ExportResult) -> None:
    height, width = stdscr.getmaxyx()
    stdscr.clear()
    draw_title(stdscr, "Export Complete" if result.message_count else "No New Messages")
    draw_line(stdscr, 2, f"Messages exported: {result.message_count}", width)
    draw_line(stdscr, 3, f"Files created: {result.file_count}", width)
    draw_line(stdscr, 4, f"Scope: {export_scope_label(result.scope)}", width)
    next_y = 6
    if result.output_dir:
        draw_wrapped(stdscr, next_y, f"Output: {result.output_dir}", width)
        next_y += 2
    if result.new_cutoff:
        draw_wrapped(stdscr, next_y, f"Cutoff updated: {format_cutoff(result.new_cutoff)}", width)
    elif result.previous_cutoff:
        draw_wrapped(stdscr, next_y, f"Cutoff unchanged: {format_cutoff(result.previous_cutoff)}", width)
    draw_line(stdscr, height - 2, "Press any key to exit.", width)
    stdscr.refresh()
    stdscr.getch()


def draw_title(stdscr: curses.window, text: str) -> None:
    height, width = stdscr.getmaxyx()
    if height <= 0 or width <= 0:
        return
    attr = curses.A_BOLD
    draw_line(stdscr, 0, text, width, attr)


def draw_line(
    stdscr: curses.window,
    y: int,
    text: str,
    width: int,
    attr: int = curses.A_NORMAL,
) -> None:
    if y < 0:
        return
    height, _ = stdscr.getmaxyx()
    if y >= height:
        return
    safe = text[: max(0, width - 1)]
    stdscr.addstr(y, 0, safe.ljust(max(0, width - 1)), attr)


def draw_wrapped(stdscr: curses.window, y: int, text: str, width: int) -> None:
    line_width = max(20, width - 1)
    current_y = y
    remaining = text
    while remaining:
        draw_line(stdscr, current_y, remaining[:line_width], width)
        remaining = remaining[line_width:]
        current_y += 1


def check_environment(db_path: Path, out_dir: Path, state_path: Path) -> int:
    checks = [
        ("macOS", sys.platform == "darwin", platform.platform()),
        (
            "Python",
            sys.version_info >= MIN_PYTHON,
            f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        ),
        (
            "curses",
            hasattr(curses, "wrapper"),
            "terminal UI module available",
        ),
        (
            "Output location",
            is_writable_location(out_dir),
            str(out_dir),
        ),
        (
            "State location",
            is_writable_location(state_path.parent),
            str(state_path),
        ),
    ]

    success = True
    print("msgexport setup check")
    print("---------------------")
    for label, passed, detail in checks:
        success = success and passed
        status = "OK" if passed else "FAIL"
        print(f"{status:4} {label}: {detail}")

    try:
        with snapshot_connection(db_path) as conn:
            conversation_count = len(list_conversations(conn))
        print(f"OK   Messages database: {db_path} ({conversation_count} conversations)")
    except Exception as exc:
        success = False
        print(f"FAIL Messages database: {db_path}")
        print(f"     {exc}")
        print("     Grant Full Disk Access to the terminal app, then retry --check.")

    if success:
        print("\nReady. Run: python3 msgexport.py")
        return 0
    print("\nNot ready yet. Fix the failed checks above and retry.")
    return 1


def is_writable_location(path: Path) -> bool:
    candidate = path if path.exists() else path.parent
    while not candidate.exists() and candidate != candidate.parent:
        candidate = candidate.parent
    return candidate.exists() and os.access(candidate, os.W_OK)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    db_path = expand_path(args.db)
    out_dir = expand_path(args.out)
    state_path = expand_path(args.state)
    state_store = StateStore(state_path, db_path)

    try:
        if args.check:
            return check_environment(db_path, out_dir, state_path)
        with snapshot_connection(db_path) as conn:
            run_tui(conn, out_dir, state_store)
    except sqlite3.OperationalError as exc:
        print(f"Could not open Messages database: {exc}", file=sys.stderr)
        print(
            "On macOS, grant Full Disk Access to your terminal app if access is denied.",
            file=sys.stderr,
        )
        return 1
    except (FileNotFoundError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
