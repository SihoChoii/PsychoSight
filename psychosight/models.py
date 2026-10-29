"""Core data classes. Message text lives only in memory in these objects."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List

SPEAKERS = ("me", "other")


@dataclass(frozen=True)
class Msg:
    id: str
    ts: datetime  # tz-aware
    speaker: str  # "me" | "other"
    text: str
    is_group: bool = False

    def __repr__(self) -> str:  # keep bodies out of reprs/tracebacks
        return f"Msg(id={self.id!r}, ts={self.ts.isoformat()}, speaker={self.speaker!r}, chars={len(self.text)})"


@dataclass
class Turn:
    speaker: str
    msgs: List[Msg]

    @property
    def start(self) -> datetime:
        return self.msgs[0].ts

    @property
    def end(self) -> datetime:
        return self.msgs[-1].ts


@dataclass
class Episode:
    id: str
    turns: List[Turn]
    hash: str = ""
    word_counts: Dict[str, int] = field(default_factory=dict)

    @property
    def msgs(self) -> List[Msg]:
        return [m for t in self.turns for m in t.msgs]

    @property
    def start(self) -> datetime:
        return self.turns[0].start

    @property
    def end(self) -> datetime:
        return self.turns[-1].end

    @property
    def initiator(self) -> str:
        return self.turns[0].speaker

    @property
    def total_words(self) -> int:
        return sum(self.word_counts.values())

    def __repr__(self) -> str:
        return f"Episode(id={self.id!r}, turns={len(self.turns)}, words={self.word_counts})"


@dataclass
class ConversationData:
    conversation_id: str
    label: str
    msgs: List[Msg]
    is_demo: bool
    source: str  # "demo" | "chat.db"
