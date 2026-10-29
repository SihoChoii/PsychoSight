"""compute_deterministic: fixed counts, weeks, first-person context, WWBP absence."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from psychosight.experimental import lexicons as L
from psychosight.experimental.contract import deterministic_marker_ids
from psychosight.experimental.deterministic import compute_deterministic
from psychosight.experimental.strings import REASON_WWBP_MISSING
from psychosight.features import count_absolutist, count_i, count_we, tokenize, week_key
from psychosight.models import Msg
from psychosight.sessionize import sessionize

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo  # type: ignore

LA = ZoneInfo("America/Los_Angeles")
WWBP_IDS = tuple(mid for mid in deterministic_marker_ids() if mid.startswith("wwbp."))


def _msg(i, ts, speaker, text):
    return Msg("m{0}".format(i), ts, speaker, text)


def _at(day, hour, minute=0):
    return datetime(2025, 10, day, hour, minute, tzinfo=LA)


def _by(result, speaker, marker):
    return [o for o in result.observations if o.speaker == speaker and o.marker_id == marker]


def test_every_marker_once_per_speaker_and_repeatable():
    eps = sessionize([
        _msg(1, _at(6, 12), "me", "I am happy and my friend is writing"),
        _msg(2, _at(6, 12, 1), "other", "you always yell"),
    ])
    first = compute_deterministic(eps, ("me", "other"))
    second = compute_deterministic(eps, ("me", "other"))
    assert first == second
    ids = set(deterministic_marker_ids())
    assert set(first.unavailable) & set(o.marker_id for o in first.observations) == set()
    assert {o.marker_id for o in first.observations} | set(first.unavailable) == ids
    assert first.unavailable == {}
    assert len(first.observations) == len(ids) * 2 * len(eps)
    # Registry order, then the requested speaker order, episode order.
    me = [o.marker_id for o in first.observations if o.speaker == "me"]
    assert me == [mid for mid in deterministic_marker_ids()]
    assert first.words["me"] == eps[0].word_counts["me"]
    assert first.words["other"] == eps[0].word_counts["other"]
    assert first.episodes_with_speaker == {"me": 1, "other": 1}
    assert all(o.week == week_key(eps[0]) for o in first.observations)


def test_only_requested_speaker_and_empty_input():
    eps = sessionize([_msg(1, _at(6, 12), "other", "hello there friend")])
    only = compute_deterministic(eps, ("me",))
    assert {o.speaker for o in only.observations} == {"me"}
    assert set(only.words) == {"me"}
    assert only.words["me"] == 0
    assert only.episodes_with_speaker == {"me": 0}
    empty = compute_deterministic([], ("me", "other"))
    assert empty.observations == []
    assert empty.words == {"me": 0, "other": 0}
    assert empty.episodes_with_speaker == {"me": 0, "other": 0}
    assert empty.unavailable == {}


def test_iso_week_bucketing():
    # 2024-12-30 is a Monday in ISO week 2025-W01; the next Monday is 2025-W02.
    first = datetime(2024, 12, 30, 9, tzinfo=LA)
    second = first + timedelta(days=7)
    eps = sessionize([
        _msg(1, first, "me", "hello"),
        _msg(2, second, "me", "hello again"),
    ])
    assert [week_key(ep) for ep in eps] == ["2025-W01", "2025-W02"]
    result = compute_deterministic(eps, ("me",))
    weeks = []
    for ep in eps:
        seen = {o.week for o in result.observations if o.episode_id == ep.id}
        assert seen == {week_key(ep)}
        weeks.append(week_key(ep))
    assert weeks == ["2025-W01", "2025-W02"]


def test_pronouns_absolutist_you_and_long_words_match_features():
    text = "I'm absolutely sure you're never late, but not always, and our beautiful plan is mine"
    eps = sessionize([_msg(1, _at(6, 15), "me", text)])
    result = compute_deterministic(eps, ("me",))
    toks = tokenize(text)
    me = {o.marker_id: o for o in result.observations}
    assert me["i_rate"].num == count_i(toks)
    assert me["we_rate"].num == count_we(toks)
    assert me["absolutist_rate"].num == count_absolutist(toks)
    assert count_absolutist(tokenize("not always")) == 0
    assert me["you_rate"].num == 1  # you're
    assert me["long_word_share"].num == sum(1 for t in toks if sum(ch.isalpha() for ch in t) >= 7)
    assert me["i_rate"].den == me["we_rate"].den == me["you_rate"].den == float(len(toks))
    assert count_i(toks) >= 2  # i'm, mine
    assert count_we(toks) == 1  # our
    assert "never" in toks and count_absolutist(toks) >= 1


def test_first_person_does_not_cross_messages():
    start = _at(7, 18)
    together = sessionize([_msg(1, start, "me", "I want a beer and I love the casino")])
    split = sessionize([
        _msg(1, start, "me", "I"),
        _msg(2, start + timedelta(seconds=10), "me", "beer casino"),
    ])
    third = sessionize([_msg(1, start, "me", "the beer and the casino")])
    a = {o.marker_id: o for o in compute_deterministic(together, ("me",)).observations}
    b = {o.marker_id: o for o in compute_deterministic(split, ("me",)).observations}
    c = {o.marker_id: o for o in compute_deterministic(third, ("me",)).observations}
    assert a["substance_first_person_rate"].num == 1
    assert a["gambling_first_person_rate"].num == 1
    assert b["substance_first_person_rate"].num == 0
    assert b["gambling_first_person_rate"].num == 0
    assert c["substance_first_person_rate"].num == 0
    assert c["gambling_first_person_rate"].num == 0
    # "I want a cup" is not a substance term (Empath alcohol includes cup; our list does not).
    cup = sessionize([_msg(1, start, "me", "I want a cup")])
    cup_obs = {o.marker_id: o for o in compute_deterministic(cup, ("me",)).observations}
    assert cup_obs["substance_first_person_rate"].num == 0


def test_craving_phrase_is_per_message():
    start = _at(8, 12)
    one = sessionize([_msg(1, start, "me", "I can't stop")])
    two = sessionize([
        _msg(1, start, "me", "can't"),
        _msg(2, start + timedelta(seconds=5), "me", "stop"),
    ])
    hit = {o.marker_id: o for o in compute_deterministic(one, ("me",)).observations}
    miss = {o.marker_id: o for o in compute_deterministic(two, ("me",)).observations}
    assert hit["craving_phrase_rate"].num == 2
    assert hit["craving_phrase_rate"].den == 3  # i, can't, stop
    assert miss["craving_phrase_rate"].num == 0


def test_initiation_late_night_and_double_text():
    # 02:00 local, other opens. Me's second message is its own turn (gap >= 30s).
    t = datetime(2025, 10, 7, 2, 0, tzinfo=LA)
    late = sessionize([
        _msg(1, t, "other", "hey"),
        _msg(2, t + timedelta(seconds=100), "me", "hi"),
        _msg(3, t + timedelta(seconds=400), "me", "still there"),
        _msg(4, t + timedelta(seconds=700), "other", "yes"),
    ])
    result = compute_deterministic(late, ("me", "other"))
    me_init = _by(result, "me", "initiation_share")[0]
    other_init = _by(result, "other", "initiation_share")[0]
    assert (me_init.num, me_init.den) == (0.0, 1.0)
    assert (other_init.num, other_init.den) == (1.0, 1.0)
    assert _by(result, "other", "late_night_episode_share")[0].num == 1.0
    assert _by(result, "me", "late_night_episode_share")[0].num == 0.0
    # One follow-up turn, two me messages.
    assert _by(result, "me", "double_text_rate")[0].num == 1.0
    assert _by(result, "me", "double_text_rate")[0].den == 2.0
    assert _by(result, "other", "double_text_rate")[0].num == 0.0
    assert _by(result, "other", "double_text_rate")[0].den == 2.0

    noon = sessionize([_msg(1, _at(7, 12), "me", "hello")])
    noon_obs = {o.marker_id: o for o in compute_deterministic(noon, ("me",)).observations}
    assert noon_obs["late_night_episode_share"].num == 0.0
    assert noon_obs["initiation_share"].num == 1.0

    # Half-open window: 01:00 counts, 04:00 does not. Same-turn messages are not a double text.
    at_one = sessionize([_msg(1, datetime(2025, 10, 8, 1, 0, tzinfo=LA), "me", "up")])
    at_four = sessionize([_msg(1, datetime(2025, 10, 8, 4, 0, tzinfo=LA), "me", "up")])
    before = sessionize([_msg(1, datetime(2025, 10, 8, 0, 59, tzinfo=LA), "me", "up")])
    assert _by(compute_deterministic(at_one, ("me",)), "me", "late_night_episode_share")[0].num == 1.0
    assert _by(compute_deterministic(at_four, ("me",)), "me", "late_night_episode_share")[0].num == 0.0
    assert _by(compute_deterministic(before, ("me",)), "me", "late_night_episode_share")[0].num == 0.0

    burst = sessionize([
        _msg(1, _at(9, 9), "me", "one"),
        _msg(2, _at(9, 9) + timedelta(seconds=10), "me", "two"),
        _msg(3, _at(9, 9) + timedelta(seconds=50), "me", "three"),
    ])
    doubles = _by(compute_deterministic(burst, ("me",)), "me", "double_text_rate")[0]
    assert doubles.num == 1.0  # the third message is the follow-up turn
    assert doubles.den == 3.0


def test_vader_mean_is_sum_over_messages():
    start = _at(10, 11)
    eps = sessionize([
        _msg(1, start, "me", "happy"),
        _msg(2, start + timedelta(seconds=5), "me", "not happy"),
    ])
    obs = {o.marker_id: o for o in compute_deterministic(eps, ("me",)).observations}
    per = [L.message_compound(tokenize(text)) for text in ("happy", "not happy")]
    assert obs["vader_compound"].num == pytest.approx(sum(per))
    assert obs["vader_compound"].den == 2.0
    assert per[0] > 0 > per[1]
    blank = sessionize([_msg(1, start, "me", "!!!")])
    blank_obs = {o.marker_id: o for o in compute_deterministic(blank, ("me",)).observations}
    assert blank_obs["vader_compound"].num == 0.0
    assert blank_obs["vader_compound"].den == 1.0
    assert compute_deterministic(blank, ("me",)).words["me"] == 0
    assert compute_deterministic(blank, ("me",)).episodes_with_speaker["me"] == 1


def test_wwbp_sum_per_hundred_words_and_absent_path(monkeypatch, tmp_path):
    raw = json.loads((Path(L.WWBP_DIR) / L.WWBP_JSON_NAME).read_text(encoding="utf-8"))
    eps = sessionize([_msg(1, _at(11, 16), "me", "art")])
    result = compute_deterministic(eps, ("me", "other"))
    me = {o.marker_id: o for o in result.observations if o.speaker == "me"}
    assert me["wwbp.openness"].num == pytest.approx(100.0 * raw["O"]["art"])
    assert me["wwbp.openness"].den == 1.0
    assert me["empath_intellect"].num == 1.0
    # Other wrote nothing: word rates have a zero denominator, episode shares still have den 1.
    other = {o.marker_id: o for o in result.observations if o.speaker == "other"}
    assert other["wwbp.openness"].den == 0.0
    assert other["initiation_share"].den == 1.0
    assert "wwbp.openness" not in result.unavailable

    monkeypatch.setattr(L, "WWBP_DIR", tmp_path / "deleted")
    absent = compute_deterministic(eps, ("me",))
    assert set(absent.unavailable) == set(WWBP_IDS)
    assert all(absent.unavailable[mid] == REASON_WWBP_MISSING for mid in WWBP_IDS)
    assert all(not o.marker_id.startswith("wwbp.") for o in absent.observations)
    assert {o.marker_id for o in absent.observations} | set(absent.unavailable) == set(deterministic_marker_ids())
    # Non-WWBP markers still come out, and a second call after the real directory is restored works.
    assert any(o.marker_id == "i_rate" for o in absent.observations)
    monkeypatch.setattr(L, "WWBP_DIR", Path(L.__file__).resolve().parent / "wwbp")
    restored = compute_deterministic(eps, ("me",))
    assert restored.unavailable == {}
    assert any(o.marker_id == "wwbp.neuroticism" for o in restored.observations)
