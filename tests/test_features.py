from __future__ import annotations

from datetime import datetime, timedelta

from psychosight import config, features, loader, sessionize
from psychosight.features import count_absolutist, count_i, count_we, tokenize
from psychosight.models import Msg

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo  # type: ignore

LA = ZoneInfo("America/Los_Angeles")


def test_absolutist_list_is_the_19_words():
    assert len(features.ABSOLUTIST_WORDS) == 19


def test_absolutist_fixed_sentences():
    cases = {
        "You always do this and you never listen": 2,
        "It's not always like that": 0,
        "I almost never cry, nearly everything is fine": 0,
        "Everyone must know that it was totally complete": 4,
        "absolutely nothing ever changes, every single time, all of it": 5,
        "I'm ALWAYS tired": 1,
        "Nothing": 1,
        "fully allowed, alright, evermore": 0,
    }
    for sentence, expected in cases.items():
        assert count_absolutist(tokenize(sentence)) == expected, sentence


def test_pronouns():
    toks = tokenize("I think I'm right, my plan is mine. We're fine, us and our ourselves")
    assert count_i(toks) == 4  # i, i'm, my, mine
    assert count_we(toks) == 4  # we're, us, our, ourselves


def test_curly_apostrophe():
    assert tokenize("I\u2019m here") == ["i'm", "here"]


def _week(start, n_words_me, n_words_other, episodes=1):
    msgs, t, i = [], start, 0
    for e in range(episodes):
        t = start + timedelta(hours=3 * e)
        for speaker, n in (("other", n_words_other), ("me", n_words_me)):
            i += 1
            msgs.append(Msg(f"m{i}", t, speaker, " ".join(["word"] * max(n // episodes, 1))))
            t += timedelta(seconds=60)
    return msgs


def test_insufficient_data_is_null_not_zero():
    start = datetime(2025, 10, 6, 12, tzinfo=LA)
    eps = sessionize.sessionize(_week(start, 50, 400))
    out = features.compute(eps)
    absol = next(s for s in out["series"] if s["key"] == "absolutist_pct")
    me = absol["points"][0]["me"]
    assert me == {"value": None, "count": 50, "reason": "insufficient data"}
    assert absol["points"][0]["other"]["value"] == 0.0  # enough words, genuinely zero
    lat = next(s for s in out["series"] if s["key"] == "reply_latency_median_s")
    assert lat["points"][0]["me"]["value"] is None and lat["approximate"] is True


def test_iso_week_at_year_boundary():
    # 2024-12-30 (Mon) belongs to ISO week 2025-W01; 2027-01-01 (Fri) belongs to 2026-W53.
    eps = sessionize.sessionize([Msg("a", datetime(2024, 12, 30, 9, tzinfo=LA), "me", "hi"),
                                 Msg("b", datetime(2027, 1, 1, 9, tzinfo=LA), "me", "hi")])
    out = features.compute(eps)
    assert [w["week"] for w in out["weeks"]] == ["2025-W01", "2026-W53"]
    assert out["weeks"][0]["start_date"] == "2024-12-30"


def test_latency_initiation_double_text_late_night():
    t = datetime(2025, 10, 7, 2, 0, tzinfo=LA)  # 02:00 local
    msgs = [Msg("1", t, "other", "hey"), Msg("2", t + timedelta(seconds=100), "me", "hi"),
            Msg("3", t + timedelta(seconds=400), "me", "still there"),  # follow-up turn
            Msg("4", t + timedelta(seconds=700), "other", "yes")]
    eps = sessionize.sessionize(msgs)
    st = features.compute(eps)
    by = {s["key"]: s for s in st["series"]}
    assert by["late_night_episodes"]["overall"]["other"] == {"value": 1, "count": 1}
    assert by["late_night_episodes"]["overall"]["me"] == {"value": 0, "count": 0}
    assert st["episode_stats"]["ep-0001"]["latencies"] == {"me": [100.0], "other": [300.0]}
    assert st["episode_stats"]["ep-0001"]["late_night"] is True


def test_demo_series_shape_and_quiet_week():
    eps = sessionize.sessionize(loader.load_demo().msgs)
    out = features.compute(eps)
    weeks = [w["week"] for w in out["weeks"]]
    assert len(weeks) == 25 and "2025-W46" not in weeks  # the quiet week has no episodes
    by = {s["key"]: s for s in out["series"]}
    for s in out["series"]:
        assert len(s["points"]) == len(out["weeks"])
    # Planted arc: the conflict weeks have the highest absolutist rate, the busy weeks the slowest replies from me.
    absol = {p["week"]: p["me"]["value"] for p in by["absolutist_pct"]["points"]}
    assert max(absol, key=lambda w: absol[w] or 0) in ("2025-W43", "2025-W44", "2025-W45")
    lat = {p["week"]: p["me"]["value"] for p in by["reply_latency_median_s"]["points"]}
    assert all(lat[w] > 300 for w in ("2025-W38", "2025-W39", "2025-W40")) and lat["2025-W32"] < 120
    assert config.MIN_WORDS == 300
