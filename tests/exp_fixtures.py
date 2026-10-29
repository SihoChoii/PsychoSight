"""Tiny conversations for experimental-score tests.

Word counts use ``features.tokenize`` (the same counter Track A must use). Episodes are
30 minutes apart so each pair of messages is its own episode, and both speakers write in
every episode.

``planted=True`` puts worry and negative-emotion words (plus a few tentative words, and
the token ``i``) in "me", and anger and swear words in "other". ``planted=False`` is a
neutral control that uses none of those tokens and no I/me/my or we/you pronouns.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Sequence

from zoneinfo import ZoneInfo

from psychosight.features import tokenize
from psychosight.models import ConversationData, Episode, Msg
from psychosight.sessionize import sessionize

LA = ZoneInfo("America/Los_Angeles")

# Short everyday tokens. Kept disjoint from the marker lists below.
NEUTRAL_WORDS: tuple = (
    "ok", "the", "plan", "note", "send", "file", "later", "today", "room", "desk",
    "lamp", "door", "week", "time", "call", "meet", "item", "list", "page", "line",
    "soon", "then", "also", "back", "here", "that", "this", "with", "from", "left",
    "blue", "copy", "done", "next",
)

# Worry / nervousness, negative emotion, and tentative wording. "me" only.
ME_WORRY_WORDS: tuple = (
    "worry", "worried", "worrying", "anxious", "anxiety", "nervous", "nervously",
    "afraid", "scared", "fear", "uneasy", "tense", "panic",
)
ME_NEGATIVE_WORDS: tuple = (
    "sad", "sadness", "unhappy", "upset", "hurt", "lonely", "miserable", "awful",
    "terrible", "cry", "crying", "hopeless", "gloomy", "sorrow", "grief",
)
ME_TENTATIVE_WORDS: tuple = ("maybe", "perhaps", "unsure", "wondering", "guess")
ME_MARKER_WORDS: tuple = ME_WORRY_WORDS + ME_NEGATIVE_WORDS + ME_TENTATIVE_WORDS

# Anger / rage and swear words. "other" only.
OTHER_ANGER_WORDS: tuple = (
    "angry", "anger", "mad", "furious", "rage", "raging", "hate", "hated",
    "annoyed", "hostile", "pissed", "irritated", "livid",
)
OTHER_SWEAR_WORDS: tuple = (
    "damn", "damned", "hell", "shit", "fuck", "fucking", "crap", "bastard", "asshole",
)
OTHER_MARKER_WORDS: tuple = OTHER_ANGER_WORDS + OTHER_SWEAR_WORDS

_MARKER_TOKENS = frozenset(ME_MARKER_WORDS + OTHER_MARKER_WORDS + ("i", "me", "my", "we", "you"))


@dataclass(frozen=True)
class BuiltConversation:
    conversation_id: str
    messages: List[Msg]
    episodes: List[Episode]
    planted: bool
    n_episodes: int
    words: Dict[str, int]

    def as_conversation(self) -> ConversationData:
        return ConversationData(self.conversation_id, "Experimental fixture", list(self.messages), False, "chat.db")


def _spread(total: int, n: int) -> List[int]:
    if n < 1:
        raise ValueError("n_episodes must be >= 1")
    if total < n:
        raise ValueError("need at least one word per episode for each speaker")
    base, extra = divmod(total, n)
    return [base + (1 if i < extra else 0) for i in range(n)]


def _tokens(pool: Sequence[str], n: int, *, first_person: bool) -> List[str]:
    out: List[str] = []
    i = 0
    while len(out) < n:
        if first_person and len(out) % 4 == 0:
            out.append("i")
        else:
            out.append(pool[i % len(pool)])
            i += 1
    return out


def build_conversation(
    *,
    n_episodes: int,
    words_me: int,
    words_other: int,
    planted: bool,
    conversation_id: str = "exp-planted",
    start: datetime = None,
) -> BuiltConversation:
    """Build ``n_episodes`` episodes with exactly the requested word counts per speaker."""
    me_counts = _spread(words_me, n_episodes)
    other_counts = _spread(words_other, n_episodes)
    me_pool = ME_MARKER_WORDS if planted else NEUTRAL_WORDS
    other_pool = OTHER_MARKER_WORDS if planted else NEUTRAL_WORDS
    start = start or datetime(2026, 1, 5, 10, 0, tzinfo=LA)
    messages: List[Msg] = []
    mid = 1
    for i in range(n_episodes):
        t = start + timedelta(minutes=30 * i)
        me_tokens = _tokens(me_pool, me_counts[i], first_person=planted)
        other_tokens = _tokens(other_pool, other_counts[i], first_person=False)
        messages.append(Msg(id=f"m{mid}", ts=t, speaker="me", text=" ".join(me_tokens)))
        mid += 1
        messages.append(Msg(id=f"m{mid}", ts=t + timedelta(seconds=10), speaker="other", text=" ".join(other_tokens)))
        mid += 1
    episodes = sessionize(messages)
    words = {
        "me": sum(ep.word_counts["me"] for ep in episodes),
        "other": sum(ep.word_counts["other"] for ep in episodes),
    }
    if len(episodes) != n_episodes or words["me"] != words_me or words["other"] != words_other:
        raise RuntimeError(f"fixture size mismatch: episodes={len(episodes)} words={words}")
    # tokenize() is what sessionize counted; keep a direct check on the message text too.
    recounted = {"me": 0, "other": 0}
    for msg in messages:
        recounted[msg.speaker] += len(tokenize(msg.text))
    if recounted != words:
        raise RuntimeError(f"tokenize recount {recounted} != sessionize {words}")
    return BuiltConversation(conversation_id, messages, episodes, planted, n_episodes, words)
