from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from psychosight.models import Msg
from psychosight.sessionize import build_turns, sessionize

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo  # type: ignore

LA = ZoneInfo("America/Los_Angeles")
T0 = datetime(2025, 10, 1, 12, 0, 0, tzinfo=LA)


def m(i, ts, speaker="me", text="hello there"):
    return Msg(id=f"m{i}", ts=ts, speaker=speaker, text=text)


@pytest.mark.parametrize("gap,turns", [(29, 1), (30, 2), (31, 2)])
def test_turn_boundary(gap, turns):
    msgs = [m(1, T0), m(2, T0 + timedelta(seconds=gap))]
    assert len(build_turns(msgs)) == turns
    assert len(sessionize(msgs)) == 1


@pytest.mark.parametrize("gap,episodes", [(19 * 60 + 59, 1), (20 * 60, 1), (20 * 60 + 1, 2)])
def test_episode_boundary(gap, episodes):
    msgs = [m(1, T0), m(2, T0 + timedelta(seconds=gap), "other")]
    assert len(sessionize(msgs)) == episodes


def test_speaker_change_starts_new_turn_even_if_fast():
    msgs = [m(1, T0), m(2, T0 + timedelta(seconds=2), "other"), m(3, T0 + timedelta(seconds=4))]
    assert [t.speaker for t in build_turns(msgs)] == ["me", "other", "me"]


def test_cross_midnight_stays_one_episode():
    start = datetime(2025, 10, 1, 23, 55, tzinfo=LA)
    msgs = [m(i, start + timedelta(minutes=5 * i), "me" if i % 2 else "other") for i in range(4)]
    eps = sessionize(msgs)
    assert len(eps) == 1
    assert eps[0].start.date() != eps[0].end.date()


def test_dst_fall_back_uses_real_elapsed_time():
    # 2025-11-02 01:50 PDT -> 01:05 PST is 15 real minutes later (wall clock goes backwards).
    a = datetime(2025, 11, 2, 1, 50, tzinfo=LA, fold=0)
    b = datetime(2025, 11, 2, 1, 5, tzinfo=LA, fold=1)
    assert (b - a) != timedelta(minutes=15)  # same-zone subtraction is wall-clock in Python
    a_utc, b_utc = a.astimezone(timezone.utc), b.astimezone(timezone.utc)
    assert b_utc - a_utc == timedelta(minutes=15)
    msgs = [m(1, a_utc.astimezone(LA)), m(2, b_utc.astimezone(LA), "other")]
    assert len(sessionize(msgs)) == 1


def test_dst_spring_forward_gap():
    # 2025-03-09 01:50 PST -> 03:05 PDT is 15 real minutes.
    a = datetime(2025, 3, 9, 1, 50, tzinfo=LA).astimezone(timezone.utc)
    b = datetime(2025, 3, 9, 3, 5, tzinfo=LA).astimezone(timezone.utc)
    msgs = [m(1, a.astimezone(LA)), m(2, b.astimezone(LA), "other")]
    assert len(sessionize(msgs)) == 1


def test_single_message_and_empty():
    assert sessionize([]) == []
    eps = sessionize([m(1, T0, text="just one message")])
    assert len(eps) == 1 and eps[0].word_counts == {"me": 3, "other": 0}
    assert eps[0].id == "ep-0001" and len(eps[0].hash) == 64


def test_hash_depends_on_text_and_speaker_not_ids():
    a = sessionize([m(1, T0, text="Hi  there"), m(2, T0 + timedelta(seconds=40), "other", "yo")])[0]
    b = sessionize([m(7, T0, text="hi there"), m(8, T0 + timedelta(seconds=50), "other", "yo")])[0]
    c = sessionize([m(1, T0, "other", "hi there"), m(2, T0 + timedelta(seconds=40), "me", "yo")])[0]
    assert a.hash == b.hash != c.hash


def test_ordering_across_fall_back_uses_real_time():
    first = datetime(2025, 11, 2, 1, 50, tzinfo=LA, fold=0)   # PDT, earlier in real time
    second = datetime(2025, 11, 2, 1, 10, tzinfo=LA, fold=1)  # PST, 20 real minutes later
    eps = sessionize([m(2, second, "other"), m(1, first)])
    assert len(eps) == 1 and [t.speaker for t in eps[0].turns] == ["me", "other"]
