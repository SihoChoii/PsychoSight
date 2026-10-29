"""Local SQLite store. The LLM cache and episode/feature tables hold NO message bodies.

The `reports` table stores the report JSON, which contains short verbatim evidence quotes. Use
`delete_report` (CLI `delete-report`, API `DELETE /analyses/{id}`) to remove them.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS llm_scores (
    episode_hash TEXT NOT NULL, prompt_version TEXT NOT NULL, model TEXT NOT NULL, run_idx INTEGER NOT NULL,
    json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (episode_hash, prompt_version, model, run_idx)
);
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, conversation_label TEXT NOT NULL, mode TEXT NOT NULL,
    created_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS episodes (
    report_id TEXT NOT NULL, episode_id TEXT NOT NULL, conversation_id TEXT NOT NULL, start_ts TEXT, end_ts TEXT,
    hash TEXT, words_me INTEGER, words_other INTEGER, extractor_version TEXT,
    PRIMARY KEY (report_id, episode_id)
);
CREATE TABLE IF NOT EXISTS features (
    report_id TEXT NOT NULL, week TEXT NOT NULL, feature TEXT NOT NULL, speaker TEXT NOT NULL,
    value REAL, count INTEGER, extractor_version TEXT,
    PRIMARY KEY (report_id, week, feature, speaker)
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else config.db_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # --- LLM cache (scores + quote offsets only, no text) ---
    def get_score(self, episode_hash: str, prompt_version: str, model: str, run_idx: int) -> Optional[dict]:
        with self._lock:
            row = self._conn.execute(
                "SELECT json FROM llm_scores WHERE episode_hash=? AND prompt_version=? AND model=? AND run_idx=?",
                (episode_hash, prompt_version, model, run_idx)).fetchone()
        return json.loads(row[0]) if row else None

    def put_score(self, episode_hash: str, prompt_version: str, model: str, run_idx: int, data: dict) -> None:
        with self._lock:
            self._conn.execute("INSERT OR REPLACE INTO llm_scores VALUES (?,?,?,?,?,?)",
                               (episode_hash, prompt_version, model, run_idx, json.dumps(data), _now()))
            self._conn.commit()

    # --- reports (contain evidence quotes) ---
    def save_report(self, report: dict, hashes: Optional[dict] = None) -> None:
        hashes = hashes or {}
        h = report["header"]
        with self._lock:
            self._conn.execute("INSERT OR REPLACE INTO reports VALUES (?,?,?,?,?,?)",
                               (report["report_id"], h["conversation_id"], h["conversation_label"], report["mode"],
                                report["run_meta"]["created_at"], json.dumps(report)))
            self._conn.execute("DELETE FROM episodes WHERE report_id=?", (report["report_id"],))
            self._conn.execute("DELETE FROM features WHERE report_id=?", (report["report_id"],))
            ev = report["run_meta"]["extractor_version"]
            for e in report["episodes"]:
                self._conn.execute("INSERT INTO episodes VALUES (?,?,?,?,?,?,?,?,?)",
                                   (report["report_id"], e["episode_id"], h["conversation_id"], e["start"], e["end"],
                                    hashes.get(e["episode_id"]), e["words"]["me"], e["words"]["other"], ev))
            for f in report["series"]:
                for p in f["points"]:
                    for s in ("me", "other"):
                        self._conn.execute("INSERT INTO features VALUES (?,?,?,?,?,?,?)",
                                           (report["report_id"], p["week"], f["key"], s, p[s]["value"],
                                            p[s]["count"], ev))
            self._conn.commit()

    def get_report(self, report_id: str) -> Optional[dict]:
        with self._lock:
            row = self._conn.execute("SELECT json FROM reports WHERE id=?", (report_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def list_reports(self) -> List[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, conversation_id, conversation_label, mode, created_at FROM reports ORDER BY created_at DESC"
            ).fetchall()
        return [{"job_id": r[0], "conversation_id": r[1], "conversation_label": r[2], "mode": r[3], "created_at": r[4]}
                for r in rows]

    def delete_report(self, report_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM reports WHERE id=?", (report_id,))
            self._conn.execute("DELETE FROM episodes WHERE report_id=?", (report_id,))
            self._conn.execute("DELETE FROM features WHERE report_id=?", (report_id,))
            self._conn.commit()
            deleted = cur.rowcount > 0
        if deleted:
            with self._lock:
                self._conn.execute("VACUUM")  # do not leave deleted quotes in free pages
        return deleted
