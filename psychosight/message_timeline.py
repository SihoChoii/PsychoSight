"""Read an episode's original messages on demand, locally. Never persist message bodies.

The bounded, five-minute memory cache avoids copying chat.db on every zoom/pan. Report
summaries remain authoritative: changed/deleted source episodes fail explicitly.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import OrderedDict
from datetime import datetime
import threading
import time
import math

from . import config, loader, sessionize
from .errors import InvalidRequest, NotFound, PsychoSightError
from .models import utc


class TimelineUnavailable(PsychoSightError):
    code = "TIMELINE_UNAVAILABLE"
    http_status = 409


class MessageTimeline:
    def __init__(self):
        self._cache = OrderedDict()
        self._lock = threading.Lock()

    def discard(self, report_id):
        with self._lock:
            self._cache.pop(report_id, None)

    def page(self, report, episode_id, *, offset=0, limit=500, expected_hash=None, start_ms=None, end_ms=None):
        if offset < 0 or not 1 <= limit <= 500:
            raise InvalidRequest("offset must be nonnegative and limit must be between 1 and 500.")
        if (start_ms is None) != (end_ms is None) or start_ms is not None and (
                not math.isfinite(start_ms) or not math.isfinite(end_ms) or start_ms >= end_ms):
            raise InvalidRequest("Supply a finite start_ms and end_ms with start_ms before end_ms.")
        episode = next((e for e in report.get("episodes", []) if e["episode_id"] == episode_id), None)
        if episode is None:
            raise NotFound("This episode is not in the saved report.")
        header = report["header"]
        key = report["report_id"]
        version = report["run_meta"]["created_at"]
        # Serialize source loading as well as cache writes; concurrent page requests share one snapshot.
        with self._lock:
            now = time.monotonic()
            for old in list(self._cache):
                if self._cache[old][0] < now:
                    self._cache.pop(old)
            cached = self._cache.get(key)
            if cached is None or cached[1] != version:
                source = loader.load_conversation(header["conversation_id"], loader.parse_date(header["date_from"]),
                                                  loader.parse_date(header["date_to"]))
                msgs = source.msgs
                times = [utc(m.ts) for m in msgs]
                cached = (now + 300, version, msgs, times, {})
                # At most two conversations / 100k messages / 8M characters each, in memory only.
                if len(msgs) <= 100_000 and sum(len(m.text) for m in msgs) <= 8_000_000:
                    self._cache[key] = cached
                    self._cache.move_to_end(key)
                    while len(self._cache) > 2:
                        self._cache.popitem(last=False)
            else:
                self._cache.move_to_end(key)
        msgs, times, indexes = cached[2:]
        index_key = (episode_id, expected_hash)
        index = indexes.get(index_key)
        if index is None:
            start = utc(datetime.fromisoformat(episode["start"]))
            end = utc(datetime.fromisoformat(episode["end"]))
            selected = msgs[bisect_left(times, start):bisect_right(times, end)]
            counts = {side: sum(m.speaker == side for m in selected) for side in ("me", "other")}
            turns = sessionize.build_turns(selected, report["run_meta"].get("thresholds", {}).get("turn_gap_s", config.TURN_GAP_S))
            if (not selected or counts != episode["messages"] or utc(selected[0].ts) != start
                    or utc(selected[-1].ts) != end or expected_hash and sessionize.episode_hash(turns) != expected_hash):
                raise TimelineUnavailable("Messages for this episode have changed or are no longer available. Run a new analysis to refresh the timeline.")
            turn_ids = {m.id: f"{episode_id}-turn-{i + 1}" for i, turn in enumerate(turns) for m in turn.msgs}
            records = [{"id": m.id, "timestamp": m.ts.isoformat(), "speaker": m.speaker,
                        "text": m.text, "episode_id": episode_id, "turn_id": turn_ids[m.id]} for m in selected]
            index = ([m.ts.timestamp() * 1000 for m in selected], records)
            indexes[index_key] = index
        instants, records = index
        lo = bisect_left(instants, start_ms) if start_ms is not None else 0
        hi = bisect_left(instants, end_ms) if end_ms is not None else len(records)
        total = hi - lo
        page = records[min(hi, lo + offset):min(hi, lo + offset + limit)]
        return {"episode_id": episode_id, "total": total, "offset": offset,
                "next_offset": offset + len(page) if offset + len(page) < total else None,
                "messages": page}
