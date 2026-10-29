"""Turns (same speaker, gap < TURN_GAP_S) and episodes (gap > EPISODE_GAP_S starts a new one).

All arithmetic is on tz-aware datetimes, so midnight and DST changes need no special casing.
"""

from __future__ import annotations

import hashlib
import re
from typing import List

from . import config
from .features import tokenize
from .models import Episode, Msg, Turn, elapsed_s, utc

_WS = re.compile(r"\s+")


def build_turns(msgs: List[Msg], turn_gap_s: int = config.TURN_GAP_S) -> List[Turn]:
    turns: List[Turn] = []
    for m in msgs:
        last = turns[-1] if turns else None
        if last and last.speaker == m.speaker and elapsed_s(last.end, m.ts) < turn_gap_s:
            last.msgs.append(m)
        else:
            turns.append(Turn(m.speaker, [m]))
    return turns


def normalized_text(turns: List[Turn]) -> str:
    return "\n".join(f"{t.speaker}: {_WS.sub(' ', m.text.lower()).strip()}" for t in turns for m in t.msgs)


def episode_hash(turns: List[Turn]) -> str:
    return hashlib.sha256(normalized_text(turns).encode("utf-8")).hexdigest()


def sessionize(
    msgs: List[Msg],
    turn_gap_s: int = config.TURN_GAP_S,
    episode_gap_s: int = config.EPISODE_GAP_S,
) -> List[Episode]:
    groups: List[List[Msg]] = []
    for m in sorted(msgs, key=lambda x: (utc(x.ts), x.id)):
        if groups and elapsed_s(groups[-1][-1].ts, m.ts) <= episode_gap_s:
            groups[-1].append(m)
        else:
            groups.append([m])
    episodes: List[Episode] = []
    for i, group in enumerate(groups, start=1):
        turns = build_turns(group, turn_gap_s)
        counts = {"me": 0, "other": 0}
        for m in group:
            counts[m.speaker] += len(tokenize(m.text))
        episodes.append(Episode(id=f"ep-{i:04d}", turns=turns, hash=episode_hash(turns), word_counts=counts))
    return episodes
