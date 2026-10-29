"""Deterministic, descriptive features (no LLM). Me vs other and week vs week, with counts.

No norms, cutoffs or labels: values are shown as-is next to the count they are based on.
"""

from __future__ import annotations

import statistics
from collections import OrderedDict
from datetime import timedelta
from typing import Dict, List, Optional, Sequence

from . import config
from .models import SPEAKERS, Episode, elapsed_s, utc

# Al-Mosaiwi & Johnstone (2018) absolutist dictionary, 19 words (Table S2). Descriptive use only.
# "whole" is in the published list; "absolute" is not.
ABSOLUTIST_WORDS = frozenset([
    "absolutely", "all", "always", "complete", "completely", "constant", "constantly",
    "definitely", "entire", "ever", "every", "everyone", "everything", "full", "must", "never",
    "nothing", "totally", "whole",
])
QUALIFIERS = frozenset(["not", "almost", "nearly"])
I_WORDS = frozenset(["i", "me", "my", "mine", "myself"])
WE_WORDS = frozenset(["we", "us", "our", "ours", "ourselves"])
I_PREFIX = "i'"
WE_CONTRACTIONS = frozenset(["we're", "we've", "we'll", "we'd"])
LATE_NIGHT_HOURS = (1, 4)  # [01:00, 04:00) local

INSUFFICIENT = "insufficient data"


def _is_cjk(ch: str) -> bool:
    o = ord(ch)
    return (
        0x2E80 <= o <= 0x2EFF
        or 0x3040 <= o <= 0x30FF
        or 0x3400 <= o <= 0x9FFF
        or 0xAC00 <= o <= 0xD7AF
        or 0xF900 <= o <= 0xFAFF
        or 0x20000 <= o <= 0x2CEAF
    )


def _is_word_char(ch: str) -> bool:
    """ASCII letters/digits, or any other letter that is not counted per CJK character."""
    if _is_cjk(ch):
        return False
    if ch.isascii():
        return ch.isalpha() or ch.isdigit()
    return ch.isalpha() or ch.isdigit()


def tokenize(text: str) -> List[str]:
    """Word tokens. ASCII behavior matches the previous [a-z0-9] pattern, including one
    trailing apostrophe group ("don't", "i'm"). CJK and kana are one token per character so a
    non-English thread can reach the word floor; other letters stay with their word."""
    text = text.lower().replace("\u2019", "'").replace("\u2018", "'")
    tokens: List[str] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if _is_cjk(ch):
            tokens.append(ch)
            i += 1
            continue
        if _is_word_char(ch):
            j = i + 1
            while j < n and _is_word_char(text[j]):
                j += 1
            if j < n and text[j] == "'" and j + 1 < n and _is_word_char(text[j + 1]):
                j += 2
                while j < n and _is_word_char(text[j]):
                    j += 1
            tokens.append(text[i:j])
            i = j
            continue
        i += 1
    return tokens


def count_absolutist(tokens: Sequence[str]) -> int:
    n = 0
    for i, tok in enumerate(tokens):
        if tok in ABSOLUTIST_WORDS and not (i > 0 and tokens[i - 1] in QUALIFIERS):
            n += 1
    return n


def count_i(tokens: Sequence[str]) -> int:
    return sum(1 for t in tokens if t in I_WORDS or t.startswith(I_PREFIX))


def count_we(tokens: Sequence[str]) -> int:
    return sum(1 for t in tokens if t in WE_WORDS or t in WE_CONTRACTIONS)


def is_late_night(ep: Episode) -> bool:
    lo, hi = LATE_NIGHT_HOURS
    return lo <= ep.start.hour < hi


def week_key(ep: Episode) -> str:
    """ISO week of the episode start, in local time. isocalendar() is used instead of strftime
    %G/%V, which depend on the platform C library."""
    year, week, _weekday = ep.start.isocalendar()
    return f"{int(year)}-W{int(week):02d}"


def _side_stats(eps: Sequence[Episode]) -> Dict[str, dict]:
    stats = {s: {"messages": 0, "words": 0, "absolutist": 0, "i": 0, "we": 0, "turns": 0, "double": 0,
                 "latencies": [], "opened": 0, "late_opened": 0} for s in SPEAKERS}
    for ep in eps:
        stats[ep.initiator]["opened"] += 1
        if is_late_night(ep):
            stats[ep.initiator]["late_opened"] += 1
        prev = None
        for turn in ep.turns:
            st = stats[turn.speaker]
            st["turns"] += 1
            if prev is not None:
                if prev.speaker == turn.speaker:
                    st["double"] += 1
                else:
                    st["latencies"].append(elapsed_s(prev.end, turn.start))
            for m in turn.msgs:
                toks = tokenize(m.text)
                st["messages"] += 1
                st["words"] += len(toks)
                st["absolutist"] += count_absolutist(toks)
                st["i"] += count_i(toks)
                st["we"] += count_we(toks)
            prev = turn
    return stats


def _cell(value: Optional[float], count: int, enough: bool, digits: int = 2) -> dict:
    if value is None or not enough:
        return {"value": None, "count": count, "reason": INSUFFICIENT}
    return {"value": round(float(value), digits), "count": count}


def _pct(a: int, b: int) -> Optional[float]:
    return 100.0 * a / b if b else None


FEATURE_DEFS = [
    ("message_count", "Messages", "messages", "messages", "Number of messages sent.", False, None),
    ("avg_words_per_message", "Words per message", "words", "words",
     "Average words per message (message length balance).", False, config.MIN_WORDS),
    ("absolutist_pct", "Absolutist-word rate", "% of words", "words",
     "Share of words from the 19-word absolutist list (Al-Mosaiwi & Johnstone), skipping words directly after "
     "not, almost or nearly. Descriptive only.", False, config.MIN_WORDS),
    ("i_pct", "I-words", "% of words", "words", "Share of words that are I, me, my, mine or myself. Descriptive only.",
     False, config.MIN_WORDS),
    ("we_pct", "We-words", "% of words", "words", "Share of words that are we, us, our, ours or ourselves. "
     "Descriptive only.", False, config.MIN_WORDS),
    ("initiation_pct", "Episodes opened", "% of episodes", "episodes",
     "Share of episodes this side opened (first message after a 20-minute gap).", False, config.MIN_EPISODES),
    ("reply_latency_median_s", "Median reply time", "seconds", "replies",
     "Median seconds from the other side's last message to this side's first reply in the same episode. "
     "Approximate.", True, config.MIN_REPLIES),
    ("double_text_pct", "Follow-up turns", "% of turns", "turns",
     "Share of this side's turns that follow their own previous turn with no reply in between.", False,
     config.MIN_TURNS),
    ("late_night_episodes", "Episodes opened 01:00-04:00", "episodes", "episodes",
     "Count of episodes this side opened between 01:00 and 04:00 local time. Neutral count.", False, None),
]


def _feature_cells(stats: Dict[str, dict], n_episodes: int) -> Dict[str, Dict[str, dict]]:
    out: Dict[str, Dict[str, dict]] = {k[0]: {} for k in FEATURE_DEFS}
    for s in SPEAKERS:
        st = stats[s]
        enough_words = st["words"] >= config.MIN_WORDS
        out["message_count"][s] = {"value": st["messages"], "count": st["messages"]}
        out["avg_words_per_message"][s] = _cell(st["words"] / st["messages"] if st["messages"] else None,
                                                st["words"], enough_words)
        out["absolutist_pct"][s] = _cell(_pct(st["absolutist"], st["words"]), st["words"], enough_words)
        out["i_pct"][s] = _cell(_pct(st["i"], st["words"]), st["words"], enough_words)
        out["we_pct"][s] = _cell(_pct(st["we"], st["words"]), st["words"], enough_words)
        out["initiation_pct"][s] = _cell(_pct(st["opened"], n_episodes), st["opened"],
                                         n_episodes >= config.MIN_EPISODES, 1)
        lat = st["latencies"]
        out["reply_latency_median_s"][s] = _cell(statistics.median(lat) if lat else None, len(lat),
                                                 len(lat) >= config.MIN_REPLIES, 1)
        out["double_text_pct"][s] = _cell(_pct(st["double"], st["turns"]), st["turns"],
                                          st["turns"] >= config.MIN_TURNS, 1)
        out["late_night_episodes"][s] = {"value": st["late_opened"], "count": st["opened"]}
    return out


def compute(episodes: List[Episode]) -> dict:
    """Returns {"weeks": [...], "series": [...], "episode_stats": {episode_id: {...}}}."""
    by_week: "OrderedDict[str, List[Episode]]" = OrderedDict()
    for ep in sorted(episodes, key=lambda e: utc(e.start)):
        by_week.setdefault(week_key(ep), []).append(ep)

    weeks, week_cells = [], {}
    for wk, eps in by_week.items():
        stats = _side_stats(eps)
        monday = eps[0].start.date() - timedelta(days=eps[0].start.weekday())
        weeks.append({
            "week": wk, "start_date": monday.isoformat(), "end_date": (monday + timedelta(days=6)).isoformat(),
            "episodes": len(eps),
            "messages": {s: stats[s]["messages"] for s in SPEAKERS},
            "words": {s: stats[s]["words"] for s in SPEAKERS},
        })
        week_cells[wk] = _feature_cells(stats, len(eps))

    overall = _feature_cells(_side_stats(episodes), len(episodes))
    series = []
    for key, label, unit, count_unit, desc, approx, min_count in FEATURE_DEFS:
        series.append({
            "key": key, "label": label, "unit": unit, "count_unit": count_unit, "description": desc,
            "approximate": approx, "min_count": min_count, "overall": overall[key],
            "points": [{"week": wk, "me": week_cells[wk][key]["me"], "other": week_cells[wk][key]["other"]}
                       for wk in by_week],
        })

    episode_stats = {}
    for ep in episodes:
        st = _side_stats([ep])
        pooled = ep.total_words < config.POOL_EPISODE_WORDS
        episode_stats[ep.id] = {
            "week": week_key(ep), "pooled": pooled, "late_night": is_late_night(ep),
            "words": {s: st[s]["words"] for s in SPEAKERS},
            "messages": {s: st[s]["messages"] for s in SPEAKERS},
            # Per-episode rates only for episodes with enough words; short ones count in the week only.
            "absolutist_pct": None if pooled else {s: _pct(st[s]["absolutist"], st[s]["words"]) for s in SPEAKERS},
            "latencies": {s: st[s]["latencies"] for s in SPEAKERS},
        }
    return {"weeks": weeks, "series": series, "episode_stats": episode_stats}


def episode_index(episodes: List[Episode], episode_stats: dict, selection: Optional[dict] = None) -> List[dict]:
    selection = selection or {}
    out = []
    for ep in episodes:
        st = episode_stats[ep.id]
        out.append({
            "episode_id": ep.id, "start": ep.start.isoformat(), "end": ep.end.isoformat(), "week": st["week"],
            "initiator": ep.initiator, "messages": st["messages"], "words": st["words"],
            "late_night_start": st["late_night"], "pooled": st["pooled"],
            "scored": ep.id in selection, "selection": selection.get(ep.id),
        })
    return out
