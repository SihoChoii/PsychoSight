"""Track C scoring rules (plan section 3.5) with hand-built deterministic and LLM fixtures.

Nothing here imports Track A or Track B implementations. Schema checks use the 1.1.0 subtree.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jsonschema
import pytest

from psychosight.experimental import contract as c
from psychosight.experimental import scoring
from psychosight.experimental import strings as T
from psychosight.experimental.contract import (
    BIG_FIVE,
    DIMENSIONS,
    EXP_MAX_CONFIDENCE,
    EXP_MEDIUM_AGREEMENT,
    EXP_MIN_EPISODES,
    EXP_MIN_WORDS,
    EXP_SEED,
    DeterministicResult,
    ExpLLMResult,
    ExpLLMStats,
    ExpQuote,
    MarkerObservation,
)
from psychosight.experimental.scoring import (
    _effective_shares,
    _evidence_penalty,
    _percentile,
    _subscore,
    build_section,
    not_run_section,
)
from psychosight.features import week_key
from psychosight.models import Episode, Msg, Turn

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "schemas" / "report.schema.json").read_text())
ANCHORS = json.loads(
    (ROOT / "psychosight" / "experimental" / "data" / "exp_anchors_v1.json").read_text())
W40 = datetime(2025, 9, 29, 12, 0, tzinfo=timezone.utc)
MARKER_UNIT = {}
for _marker in c.MARKERS:
    MARKER_UNIT.setdefault(_marker.id, _marker.unit)
ANCHOR_BY_ID = ANCHORS["markers"]


def _validator():
    sub = {"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"], "$ref": "#/$defs/experimentalScores"}
    return jsonschema.Draft202012Validator(sub, format_checker=jsonschema.FormatChecker())


def _def_validator(name):
    sub = {"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"], "$ref": f"#/$defs/{name}"}
    return jsonschema.Draft202012Validator(sub, format_checker=jsonschema.FormatChecker())


def _null_other_schema_bug(error):
    """prefixItems for low-max dimensions put ``other`` in a oneOf whose second branch has no
    ``type: object``, so null matches both branches. The frozen schema rejects a me-only section.
    """
    return error.validator == "oneOf" and error.instance is None and "per_speaker" in str(error.json_path)


def _assert_section(section):
    errors = [err for err in _validator().iter_errors(section) if not _null_other_schema_bug(err)]
    assert not errors, errors[0]
    for dim in section["dimensions"]:
        _def_validator("expDimension").validate({
            **{k: v for k, v in dim.items() if k != "per_speaker"},
            "per_speaker": {"me": dim["per_speaker"]["me"], "other": dim["per_speaker"]["other"]},
        })
        _def_validator("expSpeakerScore").validate(dim["per_speaker"]["me"])
        if dim["per_speaker"]["other"] is not None:
            _def_validator("expSpeakerScore").validate(dim["per_speaker"]["other"])
    for quote in section["quotes"]:
        _def_validator("expQuote").validate(quote)
    _assert_no_forbidden(section)
    _assert_confidence_bounds(section)


def _walk(node):
    if isinstance(node, dict):
        for key, value in node.items():
            yield key, value
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def _assert_no_forbidden(section):
    keys = [key for key, _value in _walk(section)]
    for banned in c.FORBIDDEN_KEYS:
        assert banned not in keys


def _assert_confidence_bounds(section):
    for dim in section["dimensions"]:
        for side in ("me", "other"):
            block = dim["per_speaker"][side]
            if block is None:
                continue
            assert block["confidence"] in (None, "low", "medium")
            if dim["evidence_strength"] in ("weak", "very_weak") and block["confidence"] is not None:
                assert block["confidence"] == "low"
            if block["status"] != "ok":
                assert block["score"] is None and block["band"] is None and block["confidence"] is None
                assert isinstance(block["reason"], str) and block["reason"]


def _episode(i, ts, me_words, other_words=0, me_text="hello from me", other_text="hello from other"):
    return Episode(
        id=f"ep-{i:04d}",
        turns=[
            Turn("me", [Msg(id=f"m{i}-me", ts=ts, speaker="me", text=me_text)]),
            Turn("other", [Msg(id=f"m{i}-ot", ts=ts, speaker="other", text=other_text)]),
        ],
        word_counts={"me": me_words, "other": other_words},
    )


def _episodes(n, words_each, ts=W40, other_words=0, me_text="hello from me", other_text="hello from other"):
    return [_episode(i + 1, ts, words_each, other_words, me_text, other_text) for i in range(n)]


def _encode(value, unit):
    if unit in ("% of words", "% of messages"):
        return float(value) * 100.0, 10000.0
    return float(value), 1.0


def _observe(episodes, speaker, values):
    observations = []
    for episode in episodes:
        week = week_key(episode)
        for marker_id, value in values.items():
            num, den = _encode(value, MARKER_UNIT[marker_id])
            observations.append(MarkerObservation(marker_id, speaker, episode.id, num, den, week))
    return observations


def _midpoint(marker_id, marker):
    anchor = ANCHOR_BY_ID[marker_id]
    if marker.requires_wwbp:
        return float(anchor["c"])
    return (float(anchor["lo"]) + float(anchor["hi"])) / 2.0


def _endpoint(marker_id, which):
    return float(ANCHOR_BY_ID[marker_id][which])


def _det(observations, words, episode_counts, unavailable=None):
    return DeterministicResult(observations, words, episode_counts, unavailable or {})


def _llm(speakers, agreeing, agreement, observations=None, quotes=None, unstable=None, holistic=3.0):
    if isinstance(agreeing, int):
        agreeing = {sp: agreeing for sp in speakers}
    if not isinstance(agreement, dict):
        agreement = {sp: agreement for sp in speakers}
    unstable = unstable or {}
    return ExpLLMResult(
        status="ok",
        reason=None,
        observations=list(observations or []),
        agreeing_episodes=dict(agreeing),
        agreement_rate=dict(agreement),
        unstable_items={sp: list(unstable.get(sp, ())) for sp in speakers},
        holistic={sp: {key: holistic for key in BIG_FIVE} for sp in speakers},
        quotes=list(quotes or []),
        stats=ExpLLMStats(),
    )


def _dim(section, key):
    return next(dim for dim in section["dimensions"] if dim["key"] == key)


def _block(section, key, speaker="me"):
    return _dim(section, key)["per_speaker"][speaker]


def _by_marker(block):
    return {row["marker_key"]: row for row in block["contributions"]}


def _constant_case(n=20, words_each=75, speakers=("me",), llm_ran=True, agreement=0.8, holistic=3.0,
                   unavailable=None, values_for=None, ts=W40):
    """Every registry marker at its anchor midpoint (rubric items at 3) so each sub-score is 0.5."""
    episodes = _episodes(n, words_each, ts=ts)
    observations = []
    per_speaker_values = {}
    for speaker in speakers:
        if values_for is None:
            values = {}
            seen = set()
            for marker in c.MARKERS:
                if marker.id in seen or marker.source == "holistic":
                    continue
                seen.add(marker.id)
                values[marker.id] = 3.0 if marker.source == "llm" else _midpoint(marker.id, marker)
        else:
            values = values_for
        per_speaker_values[speaker] = values
        observations.extend(_observe(episodes, speaker, values))
    words = {sp: n * words_each for sp in speakers}
    counts = {sp: n for sp in speakers}
    det = _det(observations, words, counts, unavailable)
    llm = _llm(speakers, n, agreement, observations=[
        obs for obs in observations if obs.marker_id.startswith("llm.")
    ], holistic=holistic) if llm_ran else None
    # Deterministic observations must not be dropped: the LLM result only carries llm.* rows.
    det.observations = [obs for obs in observations if not obs.marker_id.startswith("llm.")]
    if llm is not None:
        llm.observations = [obs for obs in observations if obs.marker_id.startswith("llm.")]
    return det, llm, episodes, [week_key(episodes[0])]


# ---------------------------------------------------------------- anchors file


def test_anchors_file_is_final_and_covers_every_marker():
    assert "draft" not in ANCHORS
    assert ANCHORS["anchors_version"] == c.EXP_ANCHORS_VERSION
    assert "placeholder" not in ANCHORS["note"].lower()
    seen = set()
    for marker in c.MARKERS:
        if marker.id in seen:
            continue
        seen.add(marker.id)
        anchor = ANCHOR_BY_ID[marker.id]
        assert anchor["anchor_source"]
        assert "draft" not in anchor["note"].lower()
        if marker.requires_wwbp:
            assert anchor["anchor_source"] == "engineering anchor"
            assert {"c", "k"} <= set(anchor)
        elif marker.source in ("llm", "holistic"):
            assert (anchor["lo"], anchor["hi"]) == (1, 5)
            assert anchor["anchor_source"] == "rubric scale"
        elif marker.id in ("neg_emotion_rate", "i_rate"):
            assert anchor["anchor_source"] == "Rude, Gortner & Pennebaker 2004"
        else:
            assert anchor["anchor_source"] == "engineering anchor"
            assert anchor["lo"] < anchor["hi"]
    neg = ANCHOR_BY_ID["neg_emotion_rate"]
    assert (neg["lo"], neg["hi"]) == (1.63, 2.92)
    first = ANCHOR_BY_ID["i_rate"]
    assert (first["lo"], first["hi"]) == (10.76, 12.17)


# ---------------------------------------------------------------- pure rules


def test_percentile_is_linear_type7():
    assert _percentile([5], 0.1) == 5
    # n=4, p=0.1 -> rank 0.3 -> 10 * 0.7 + 20 * 0.3
    assert _percentile([10, 20, 30, 40], 0.1) == pytest.approx(13.0)
    assert _percentile([10, 20, 30, 40], 0.9) == pytest.approx(37.0)
    assert _percentile([10, 20, 30, 40], 0.5) == pytest.approx(25.0)


def test_evidence_penalty_adds_no_llm_widen_and_covers_weak():
    assert _evidence_penalty("moderate", True) == 5
    assert _evidence_penalty("small", True) == 10
    assert _evidence_penalty("weak", True) == 15
    assert _evidence_penalty("very_weak", True) == 20
    assert _evidence_penalty("moderate", False) == 15
    assert _evidence_penalty("very_weak", False) == 30


def test_linear_subscore_clamps_and_down_markers_flip():
    long_word = next(m for m in c.MARKERS if m.id == "long_word_share")
    anchor = ANCHOR_BY_ID["long_word_share"]
    assert _subscore(10, long_word, anchor) == 0
    assert _subscore(20, long_word, anchor) == 1
    assert _subscore(15, long_word, anchor) == pytest.approx(0.5)
    assert _subscore(100, long_word, anchor) == 1
    assert _subscore(-4, long_word, anchor) == 0
    swear = next(m for m in c.MARKERS if m.dimension == "conscientiousness" and m.id == "swear_rate")
    swear_anchor = ANCHOR_BY_ID["swear_rate"]
    assert swear.direction == -1
    assert _subscore(0, swear, swear_anchor) == 1
    assert _subscore(2, swear, swear_anchor) == 0
    assert _subscore(1, swear, swear_anchor) == pytest.approx(0.5)


def test_wwbp_logistic_and_published_rude_endpoints():
    wwbp = next(m for m in c.MARKERS if m.id == "wwbp.openness")
    anchor = ANCHOR_BY_ID["wwbp.openness"]
    assert _subscore(0, wwbp, anchor) == pytest.approx(0.5)
    assert _subscore(1, wwbp, anchor) == pytest.approx(1 / (1 + math.exp(-1)))
    neg = next(m for m in c.MARKERS if m.dimension == "depression_language" and m.id == "neg_emotion_rate")
    neg_anchor = ANCHOR_BY_ID["neg_emotion_rate"]
    assert _subscore(1.63, neg, neg_anchor) == 0
    assert _subscore(2.92, neg, neg_anchor) == 1
    assert _subscore((1.63 + 2.92) / 2, neg, neg_anchor) == pytest.approx(0.5)
    i_rate = next(m for m in c.MARKERS if m.dimension == "depression_language" and m.id == "i_rate")
    i_anchor = ANCHOR_BY_ID["i_rate"]
    assert _subscore(10.76, i_rate, i_anchor) == 0
    assert _subscore(12.17, i_rate, i_anchor) == 1


def test_caps_clip_once_and_redistribute_proportionally():
    kept = [m for m in c.markers_for("conscientiousness") if m.id != "wwbp.conscientiousness"]
    shares = _effective_shares(kept)
    assert shares["swear_rate"] == pytest.approx(0.4)
    assert shares["llm.follows_through_on_plans"] == pytest.approx(0.2)
    assert shares["holistic.conscientiousness"] == pytest.approx(0.4)
    avoidant = list(c.markers_for("attachment_avoidant_language"))
    shares = _effective_shares(avoidant)
    assert shares["we_rate"] == pytest.approx(0.5)
    assert shares["llm.emotional_disclosure"] == pytest.approx(0.25)
    assert shares["llm.deflects_closeness"] == pytest.approx(0.25)
    # No deterministic receiver: the one pass clips, then renormalizing restores equal shares.
    only_r = [m for m in c.markers_for("addictive_language") if m.source == "llm"]
    shares = _effective_shares(only_r)
    assert shares["llm.urge_or_loss_of_control_wording"] == pytest.approx(0.5)
    assert shares["llm.using_to_cope_wording"] == pytest.approx(0.5)


# ---------------------------------------------------------------- gating, index, confidence


def test_thresholds_are_per_speaker_and_exact():
    episodes = _episodes(20, 75)
    values = {"long_word_share": 15, "empath_intellect": 1}
    me_obs = _observe(episodes, "me", values)
    other_obs = _observe(episodes[:19], "other", values)
    det = _det(me_obs + other_obs, {"me": 1500, "other": 5000}, {"me": 5, "other": 100},
               {"wwbp.openness": T.REASON_WWBP_MISSING})
    llm = _llm(("me", "other"), {"me": 20, "other": 19}, 0.5)
    section = build_section(det, llm, episodes, [week_key(episodes[0])], speakers=("me", "other"), llm_ran=True)
    _assert_section(section)
    me = _block(section, "openness", "me")
    other = _block(section, "openness", "other")
    assert me["status"] == "ok" and me["score"] is not None
    assert me["n_episodes"] == 20 and me["n_words"] == 1500
    assert other["status"] == "insufficient_data"
    assert other["reason"] == T.REASON_TOO_FEW_EPISODES
    assert other["n_episodes"] == 19 and other["score"] is None
    assert section["status"] == "ok" and section["reason"] is None
    assert section["speakers_scored"] == ["me", "other"]

    det_words = _det(me_obs, {"me": 1499}, {"me": 20})
    thin_words = build_section(det_words, _llm(("me",), 20, 1), episodes, [], speakers=("me",), llm_ran=True)
    assert _block(thin_words, "openness")["status"] == "insufficient_data"
    assert _block(thin_words, "openness")["reason"] == T.REASON_TOO_FEW_WORDS
    assert _block(thin_words, "openness")["n_words"] == 1499
    assert thin_words["status"] == "insufficient_data"

    both = build_section(
        _det(me_obs, {"me": 1499}, {"me": 19}), _llm(("me",), 19, 1), episodes, [],
        speakers=("me",), llm_ran=True)
    assert _block(both, "openness")["reason"] == T.REASON_TOO_FEW_EPISODES


def test_marker_rule_needs_two_markers_including_one_deterministic():
    episodes = _episodes(20, 75)
    week = [week_key(episodes[0])]
    only_d = _observe(episodes, "me", {"long_word_share": 15})
    section = build_section(_det(only_d, {"me": 1500}, {"me": 20}), None, episodes, week,
                            speakers=("me",), llm_ran=False)
    block = _block(section, "openness")
    assert block["status"] == "insufficient_data"
    assert block["reason"] == T.REASON_TOO_FEW_MARKERS
    row = _by_marker(block)["long_word_share"]
    assert row["status"] == "ok" and row["weight"] == 1
    assert row["sub_score"] == pytest.approx(0.5)

    two_r = _observe(episodes, "me", {
        "llm.urge_or_loss_of_control_wording": 3, "llm.using_to_cope_wording": 5,
    })
    llm = _llm(("me",), 20, 1, observations=two_r)
    section = build_section(_det([], {"me": 1500}, {"me": 20}), llm, episodes, week,
                            speakers=("me",), llm_ran=True)
    block = _block(section, "addictive_language")
    assert block["reason"] == T.REASON_TOO_FEW_MARKERS
    rows = _by_marker(block)
    assert rows["llm.urge_or_loss_of_control_wording"]["weight"] == pytest.approx(0.5)
    assert rows["llm.using_to_cope_wording"]["weight"] == pytest.approx(0.5)

    mixed_obs = _observe(episodes, "me", {"swear_rate": 1, "llm.follows_through_on_plans": 3})
    det = _det([o for o in mixed_obs if o.marker_id == "swear_rate"], {"me": 1500}, {"me": 20},
               {"wwbp.conscientiousness": T.REASON_WWBP_MISSING})
    llm = _llm(("me",), 20, 0.4, observations=[o for o in mixed_obs if o.marker_id.startswith("llm.")],
               holistic=None)
    llm.holistic = {"me": {key: None for key in BIG_FIVE}}
    section = build_section(det, llm, episodes, week, speakers=("me",), llm_ran=True)
    block = _block(section, "conscientiousness")
    assert block["status"] == "ok"
    assert _by_marker(block)["holistic.conscientiousness"]["status"] == "no_data"
    assert _by_marker(block)["wwbp.conscientiousness"]["status"] == "not_run"


def test_index_uses_full_precision_weights_and_python_round():
    episodes = _episodes(20, 75)
    week = [week_key(episodes[0])]

    def openness(empath_value):
        obs = _observe(episodes, "me", {"long_word_share": 20, "empath_intellect": empath_value})
        det = _det(obs, {"me": 1500}, {"me": 20}, {"wwbp.openness": T.REASON_WWBP_MISSING})
        return build_section(det, None, episodes, week, speakers=("me",), llm_ran=False)

    # Equal weights, subscores 1 and 0.01 -> 50.5 -> round half to even -> 50.
    low = _block(openness(0.02), "openness")
    assert low["status"] == "ok"
    assert low["score"] == 50
    # Subscores 1 and 0.03 -> 51.5 -> round half to even -> 52.
    high = _block(openness(0.06), "openness")
    assert high["score"] == 52

    anger_obs = _observe(episodes, "me", {"anger_rage_rate": 2, "swear_rate": 0})
    anger = build_section(_det(anger_obs, {"me": 1500}, {"me": 20}), None, episodes, week,
                          speakers=("me",), llm_ran=False)
    # 100 * 0.12 / 0.22 = 54.545... -> 55. R markers are not_run without the LLM.
    assert _block(anger, "anger_hostility_language")["score"] == 55
    rows = _by_marker(_block(anger, "anger_hostility_language"))
    assert rows["llm.escalating_language"]["status"] == "not_run"
    assert rows["llm.escalating_language"]["weight"] == 0
    assert rows["anger_rage_rate"]["sub_score"] == 1
    assert rows["swear_rate"]["sub_score"] == 0


def test_pooling_scales_percent_units_and_leaves_shares_and_valence():
    episodes = _episodes(2, 10)
    # 163 negative-emotion tokens across 10,000 words -> 1.63%, the published low anchor.
    neg = [
        MarkerObservation("neg_emotion_rate", "me", episodes[0].id, 100, 5000, week_key(episodes[0])),
        MarkerObservation("neg_emotion_rate", "me", episodes[1].id, 63, 5000, week_key(episodes[1])),
        MarkerObservation("i_rate", "me", episodes[0].id, 1076, 10000, week_key(episodes[0])),
    ]
    # den on i_rate is 10,000 words, num 1,076 -> 10.76%.
    share = [MarkerObservation("initiation_share", "me", episodes[0].id, 1, 2, week_key(episodes[0]))]
    messages = [MarkerObservation("double_text_rate", "me", episodes[0].id, 20, 100, week_key(episodes[0]))]
    tone = [MarkerObservation("vader_compound", "me", episodes[0].id, 0.5, 1, week_key(episodes[0]))]
    det = _det(neg + share + messages + tone, {"me": 10}, {"me": 1})
    section = build_section(det, None, episodes, [], speakers=("me",), llm_ran=False)
    dep = _by_marker(_block(section, "depression_language"))
    assert dep["neg_emotion_rate"]["value"] == pytest.approx(1.63)
    assert dep["neg_emotion_rate"]["sub_score"] == 0
    assert dep["neg_emotion_rate"]["anchor_source"] == "Rude, Gortner & Pennebaker 2004"
    assert dep["i_rate"]["value"] == pytest.approx(10.76)
    assert dep["i_rate"]["sub_score"] == 0
    assert dep["vader_compound"]["value"] == pytest.approx(0.5)
    assert dep["vader_compound"]["sub_score"] == 0  # down: positive tone does not raise this index
    extra = _by_marker(_block(section, "extraversion"))
    assert extra["initiation_share"]["value"] == pytest.approx(0.5)
    assert extra["initiation_share"]["sub_score"] == pytest.approx(0.5)
    anxious = _by_marker(_block(section, "attachment_anxious_language"))
    assert anxious["double_text_rate"]["value"] == pytest.approx(20)
    assert anxious["double_text_rate"]["unit"] == "% of messages"
    assert anxious["double_text_rate"]["sub_score"] == pytest.approx(0.5)


def test_wwbp_missing_is_not_run_and_logistic_midpoint_is_half():
    episodes = _episodes(20, 75)
    obs = _observe(episodes, "me", {"wwbp.openness": 0, "long_word_share": 15, "empath_intellect": 1})
    present = build_section(_det(obs, {"me": 1500}, {"me": 20}), None, episodes, [],
                            speakers=("me",), llm_ran=False)
    missing = build_section(
        _det([o for o in obs if o.marker_id != "wwbp.openness"], {"me": 1500}, {"me": 20},
             {"wwbp.openness": T.REASON_WWBP_MISSING}),
        None, episodes, [], speakers=("me",), llm_ran=False)
    got = _by_marker(_block(present, "openness"))["wwbp.openness"]
    assert got["status"] == "ok" and got["sub_score"] == pytest.approx(0.5)
    assert got["value"] == pytest.approx(0)
    gone = _by_marker(_block(missing, "openness"))["wwbp.openness"]
    assert gone["status"] == "not_run" and gone["weight"] == 0 and gone["value"] is None
    assert _block(missing, "openness")["status"] == "ok"


def test_effective_weights_sum_to_one_and_sort_descending():
    det, llm, episodes, weeks = _constant_case(n=20, words_each=75, llm_ran=True, agreement=0.9)
    section = build_section(det, llm, episodes, weeks, speakers=("me",), llm_ran=True)
    _assert_section(section)
    block = _block(section, "openness")
    weights = [row["weight"] for row in block["contributions"]]
    assert weights == sorted(weights, reverse=True)
    assert round(sum(weights), 3) == 1
    assert block["contributions"][0]["marker_key"] == "wwbp.openness"
    assert [row["marker_key"] for row in block["contributions"]] == [
        "wwbp.openness", "holistic.openness", "long_word_share", "empath_intellect"]
    capped = _by_marker(_block(section, "conscientiousness"))
    # wwbp stays in this constant case, so the holistic cap does not bind.
    no_wwbp = _constant_case(n=20, words_each=75, llm_ran=True,
                             unavailable={"wwbp.conscientiousness": T.REASON_WWBP_MISSING})
    capped_section = build_section(*no_wwbp[:3], no_wwbp[3], speakers=("me",), llm_ran=True)
    rows = _by_marker(_block(capped_section, "conscientiousness"))
    assert rows["swear_rate"]["weight"] == pytest.approx(0.4)
    assert rows["holistic.conscientiousness"]["weight"] == pytest.approx(0.4)
    assert rows["llm.follows_through_on_plans"]["weight"] == pytest.approx(0.2)
    assert rows["wwbp.conscientiousness"]["status"] == "not_run"
    order = [row["marker_key"] for row in _block(capped_section, "conscientiousness")["contributions"]]
    assert order[:3] == ["swear_rate", "holistic.conscientiousness", "llm.follows_through_on_plans"]


def test_confidence_is_medium_only_for_moderate_evidence_with_volume_and_agreement():
    def confidence(n, words_each, agreement, key="openness"):
        det, llm, episodes, weeks = _constant_case(
            n=n, words_each=words_each, llm_ran=True, agreement=agreement)
        section = build_section(det, llm, episodes, weeks, speakers=("me",), llm_ran=True)
        return _block(section, key)["confidence"], _block(section, key)["status"]

    assert confidence(30, 100, EXP_MEDIUM_AGREEMENT) == ("medium", "ok")
    assert confidence(30, 100, 1)[0] == "medium"
    assert confidence(29, 200, 1) == ("low", "ok")
    assert confidence(30, 99, 1) == ("low", "ok")  # 2,970 words
    assert confidence(30, 100, 0.799) == ("low", "ok")
    assert confidence(40, 200, None) == ("low", "ok")
    assert confidence(40, 200, 1, "addictive_language") == ("low", "ok")
    assert confidence(40, 200, 1, "anxiety_language") == ("low", "ok")
    assert confidence(40, 200, 1, "attachment_avoidant_language") == ("low", "ok")
    det, llm, episodes, weeks = _constant_case(n=40, words_each=200, llm_ran=False)
    section = build_section(det, llm, episodes, weeks, speakers=("me",), llm_ran=False)
    _assert_section(section)
    assert _block(section, "openness")["confidence"] == "low"
    for dim in section["dimensions"]:
        assert dim["per_speaker"]["me"]["confidence"] != "high"


def test_band_widens_by_evidence_and_no_llm_penalty_and_is_seeded():
    det, llm, episodes, weeks = _constant_case(n=20, words_each=75, llm_ran=True, agreement=1)
    with_llm = build_section(det, llm, episodes, weeks, speakers=("me",), llm_ran=True, seed=EXP_SEED)
    without = build_section(det, llm, episodes, weeks, speakers=("me",), llm_ran=False, seed=EXP_SEED)
    _assert_section(with_llm)
    _assert_section(without)
    for dim in DIMENSIONS:
        got = _block(with_llm, dim.key)
        bare = _block(without, dim.key)
        assert got["status"] == "ok"
        pen = _evidence_penalty(dim.evidence_strength, True)
        assert got["band"]["lo"] == max(0, got["score"] - pen)
        assert got["band"]["hi"] == min(100, got["score"] + pen)
        assert got["band"]["lo"] <= got["score"] <= got["band"]["hi"]
        # Avoidant language has a single word-count marker, so without the LLM it cannot score.
        if dim.key == "attachment_avoidant_language":
            assert bare["status"] == "insufficient_data"
            assert bare["reason"] == T.REASON_TOO_FEW_MARKERS
            continue
        assert bare["status"] == "ok"
        assert bare["score"] == got["score"]
        bare_pen = _evidence_penalty(dim.evidence_strength, False)
        assert bare["band"]["lo"] == max(0, bare["score"] - bare_pen)
        assert bare["band"]["hi"] == min(100, bare["score"] + bare_pen)
        assert bare["band"]["lo"] == got["band"]["lo"] - c.EXP_NO_LLM_BAND_PENALTY
        assert bare["band"]["hi"] == got["band"]["hi"] + c.EXP_NO_LLM_BAND_PENALTY

    again = build_section(det, llm, episodes, weeks, speakers=("me",), llm_ran=True, seed=EXP_SEED)
    assert again == with_llm
    # Constant episodes make every resample identical, so the seed does not move a point band.
    other_seed = build_section(det, llm, episodes, weeks, speakers=("me",), llm_ran=True, seed=EXP_SEED + 1)
    assert _block(other_seed, "openness")["band"] == _block(with_llm, "openness")["band"]


def test_varying_episodes_widen_the_bootstrap_band():
    constant = _constant_case(n=20, words_each=75, llm_ran=False)
    low = _episodes(10, 75, ts=W40)
    high_ts = W40 + timedelta(hours=1)
    high = [_episode(i + 11, high_ts, 75) for i in range(10)]
    episodes = low + high
    values_low = {"long_word_share": 10, "empath_intellect": 0}
    values_high = {"long_word_share": 20, "empath_intellect": 2}
    obs = _observe(low, "me", values_low) + _observe(high, "me", values_high)
    det = _det(obs, {"me": 1500}, {"me": 20}, {"wwbp.openness": T.REASON_WWBP_MISSING})
    varying = build_section(det, None, episodes, [week_key(episodes[0])], speakers=("me",), llm_ran=False,
                            seed=EXP_SEED)
    again = build_section(det, None, episodes, [week_key(episodes[0])], speakers=("me",), llm_ran=False,
                          seed=EXP_SEED)
    assert varying == again
    const_section = build_section(*constant[:3], constant[3], speakers=("me",), llm_ran=False, seed=EXP_SEED)
    const_band = _block(const_section, "openness")["band"]
    vary_band = _block(varying, "openness")["band"]
    assert (vary_band["hi"] - vary_band["lo"]) > (const_band["hi"] - const_band["lo"])
    moved = False
    for seed in (2, 3, 4, 7, 11):
        other = build_section(det, None, episodes, [week_key(episodes[0])], speakers=("me",), llm_ran=False,
                              seed=seed)
        if _block(other, "openness")["band"] != vary_band:
            moved = True
            break
    assert moved
    reordered = build_section(det, None, episodes, ["2025-W01", week_key(episodes[0])], speakers=("me",),
                              llm_ran=False, seed=EXP_SEED)
    assert _block(reordered, "openness")["band"] == vary_band
    assert _block(reordered, "openness")["score"] == _block(varying, "openness")["score"]


def test_floor_and_ceiling_scores_clamp_the_band():
    episodes = _episodes(20, 75)
    week = [week_key(episodes[0])]
    floor_values = {"wwbp.openness": -40, "long_word_share": 10, "empath_intellect": 0}
    floor = build_section(
        _det(_observe(episodes, "me", floor_values), {"me": 1500}, {"me": 20}),
        _llm(("me",), 20, 1, holistic=1,
             observations=_observe(episodes, "me", {})),
        episodes, week, speakers=("me",), llm_ran=True)
    # holistic 1 is the low rubric end. No llm observations; H is set, R is no_data.
    block = _block(floor, "openness")
    assert block["score"] == 0
    assert block["band"]["lo"] == 0
    assert block["band"]["hi"] == 5
    ceil_values = {"wwbp.openness": 40, "long_word_share": 20, "empath_intellect": 2}
    ceil = build_section(
        _det(_observe(episodes, "me", ceil_values), {"me": 1500}, {"me": 20}),
        _llm(("me",), 20, 1, holistic=5),
        episodes, week, speakers=("me",), llm_ran=True)
    block = _block(ceil, "openness")
    assert block["score"] == 100
    assert block["band"]["hi"] == 100
    assert block["band"]["lo"] == 95


def test_unstable_items_are_excluded_and_llm_payload_is_ignored_when_llm_did_not_run():
    episodes = _episodes(20, 75)
    week = [week_key(episodes[0])]
    obs = _observe(episodes, "me", {
        "neg_emotion_rate": 2.275, "anxiety_word_rate": 1, "i_rate": 11.465,
        "llm.expressed_worry": 5, "llm.reassurance_seeking": 1,
    })
    det = _det([o for o in obs if not o.marker_id.startswith("llm.")], {"me": 3000}, {"me": 30},
               {"wwbp.neuroticism": T.REASON_WWBP_MISSING})
    llm = _llm(("me",), 30, 0.9, observations=[o for o in obs if o.marker_id.startswith("llm.")],
               unstable={"me": ["expressed_worry"]}, holistic=3)
    section = build_section(det, llm, episodes, week, speakers=("me",), llm_ran=True)
    rows = _by_marker(_block(section, "neuroticism"))
    assert rows["llm.expressed_worry"]["status"] == "no_data"
    assert rows["llm.expressed_worry"]["value"] is None
    assert rows["llm.reassurance_seeking"]["status"] == "ok"
    ignored = build_section(det, llm, episodes, week, speakers=("me",), llm_ran=False)
    rows = _by_marker(_block(ignored, "neuroticism"))
    assert rows["llm.expressed_worry"]["status"] == "not_run"
    assert rows["llm.reassurance_seeking"]["status"] == "not_run"
    assert rows["holistic.neuroticism"]["status"] == "not_run"
    assert ignored["quotes"] == []


# ---------------------------------------------------------------- trend, quotes, section shape


def test_trend_uses_week_thresholds_and_week_order():
    weeks = {
        "2025-W40": (3, 100, {"long_word_share": 15, "empath_intellect": 1}),
        "2025-W41": (2, 200, {"long_word_share": 15, "empath_intellect": 1}),
        "2025-W42": (3, 99, {"long_word_share": 15, "empath_intellect": 1}),
        "2025-W43": (3, 150, {"long_word_share": 15}),
        "2025-W44": (9, 100, {"long_word_share": 20, "empath_intellect": 2}),
    }
    mondays = {
        "2025-W40": W40,
        "2025-W41": W40 + timedelta(days=7),
        "2025-W42": W40 + timedelta(days=14),
        "2025-W43": W40 + timedelta(days=21),
        "2025-W44": W40 + timedelta(days=28),
    }
    episodes = []
    observations = []
    n = 0
    total_words = 0
    for week, (count, words, values) in weeks.items():
        for _ in range(count):
            n += 1
            episodes.append(_episode(n, mondays[week], words))
            observations.extend(_observe([episodes[-1]], "me", values))
            total_words += words
    assert n == 20
    det = _det(observations, {"me": total_words}, {"me": n}, {"wwbp.openness": T.REASON_WWBP_MISSING})
    order = ["2025-W39", "2025-W41", "2025-W40", "2025-W42", "2025-W43"]
    section = build_section(det, None, episodes, order, speakers=("me",), llm_ran=False)
    _assert_section(section)
    trend = _block(section, "openness")["trend"]
    assert [point["week"] for point in trend] == [
        "2025-W41", "2025-W40", "2025-W42", "2025-W43", "2025-W44"]
    by_week = {point["week"]: point for point in trend}
    assert by_week["2025-W40"]["score"] == 50
    assert by_week["2025-W40"]["n_episodes"] == 3 and by_week["2025-W40"]["n_words"] == 300
    assert by_week["2025-W40"]["reason"] is None
    assert by_week["2025-W41"]["score"] is None and by_week["2025-W41"]["reason"] == T.REASON_TREND_THIN_WEEK
    assert by_week["2025-W41"]["n_episodes"] == 2
    assert by_week["2025-W42"]["score"] is None and by_week["2025-W42"]["n_words"] == 297
    assert by_week["2025-W42"]["reason"] == T.REASON_TREND_THIN_WEEK
    assert by_week["2025-W43"]["score"] is None and by_week["2025-W43"]["reason"] == T.REASON_TOO_FEW_MARKERS
    assert by_week["2025-W44"]["score"] == 100
    assert _block(section, "openness")["status"] == "ok"
    # A speaker under the episode gate still gets a week that itself clears the week rule.
    short = episodes[:3]
    short_det = _det(_observe(short, "me", {"long_word_share": 15, "empath_intellect": 1}),
                     {"me": 300}, {"me": 3}, {"wwbp.openness": T.REASON_WWBP_MISSING})
    short_section = build_section(short_det, None, short, ["2025-W40"], speakers=("me",), llm_ran=False)
    assert _block(short_section, "openness")["status"] == "insufficient_data"
    assert _block(short_section, "openness")["trend"][0]["score"] == 50


def test_quotes_are_verbatim_capped_and_shared_by_marker_id():
    me_text = "please read this worry quote today"
    other_text = "nothing to cite"
    episodes = _episodes(20, 75, me_text=me_text, other_text=other_text)
    start = me_text.index("worry quote")
    end = start + len("worry quote")
    later = me_text.index("today")
    quotes = [
        ExpQuote("llm.expressed_worry", "me", "ep-0005", 0, start, end),
        ExpQuote("llm.expressed_worry", "me", "ep-0001", 0, start, end),
        ExpQuote("llm.expressed_worry", "me", "ep-0001", 0, later, later + len("today")),
        ExpQuote("llm.expressed_worry", "other", "ep-0001", 0, 0, 5),  # message 0 is me
        ExpQuote("llm.expressed_worry", "me", "ep-0002", 0, 0, 500),  # end past the message
        ExpQuote("anger_rage_rate", "me", "ep-0003", 0, 0, len("please")),
    ]
    values = {
        "wwbp.neuroticism": 0, "neg_emotion_rate": 2.275, "anxiety_word_rate": 1, "i_rate": 11.465,
        "llm.expressed_worry": 4, "llm.reassurance_seeking": 2,
        "anger_rage_rate": 1, "swear_rate": 1,
    }
    # Keep the fixture inside the gate and give anger its own deterministic pair.
    obs = _observe(episodes, "me", values)
    det = _det([o for o in obs if not o.marker_id.startswith("llm.")], {"me": 1500}, {"me": 20})
    llm = _llm(("me",), 20, 0.85, observations=[o for o in obs if o.marker_id.startswith("llm.")], quotes=quotes)
    section = build_section(det, llm, episodes, [week_key(episodes[0])], speakers=("me",), llm_ran=True)
    _assert_section(section)
    worry = _by_marker(_block(section, "neuroticism"))["llm.expressed_worry"]
    assert worry["quote_ids"] == ["xq_001", "xq_002"]
    by_id = {quote["id"]: quote for quote in section["quotes"]}
    assert by_id["xq_001"]["text"] == "worry quote"
    assert by_id["xq_002"]["text"] == "today"
    assert by_id["xq_001"]["episode_id"] == "ep-0001"
    assert by_id["xq_001"]["ts"] == episodes[0].msgs[0].ts.isoformat()
    assert by_id["xq_001"]["speaker"] == "me"
    assert by_id["xq_001"]["marker_key"] == "llm.expressed_worry"
    # The later episode and the invalid spans are not kept.
    assert all(quote["text"] != "please read this worry quote today"[:5] or quote["marker_key"] != "llm.expressed_worry"
               for quote in section["quotes"])
    assert "ep-0005" not in {quote["episode_id"] for quote in section["quotes"] if quote["marker_key"] == "llm.expressed_worry"}
    anxiety = _by_marker(_block(section, "anxiety_language"))["llm.expressed_worry"]
    assert anxiety["quote_ids"] == ["xq_001", "xq_002"]
    anger = _by_marker(_block(section, "anger_hostility_language"))["anger_rage_rate"]
    assert anger["quote_ids"] == ["xq_003"]
    assert by_id["xq_003"]["text"] == "please"
    speaker_ids = _block(section, "neuroticism")["quote_ids"]
    assert speaker_ids == worry["quote_ids"]
    referenced = set()
    for dim in section["dimensions"]:
        block = dim["per_speaker"]["me"]
        for row in block["contributions"]:
            assert len(row["quote_ids"]) <= 2
            referenced.update(row["quote_ids"])
        assert set(block["quote_ids"]) <= referenced
    assert {quote["id"] for quote in section["quotes"]} == referenced
    assert [quote["id"] for quote in section["quotes"]] == ["xq_001", "xq_002", "xq_003"]


def test_not_run_section_matches_the_schema_for_one_or_both_speakers():
    me_only = not_run_section(T.REASON_NOT_REQUESTED)
    _assert_section(me_only)
    assert me_only["status"] == "not_run"
    assert me_only["reason"] == T.REASON_NOT_REQUESTED
    assert me_only["speakers_scored"] == ["me"]
    assert me_only["quotes"] == []
    assert [dim["key"] for dim in me_only["dimensions"]] == [dim.key for dim in DIMENSIONS]
    block = me_only["dimensions"][0]["per_speaker"]["me"]
    assert block["status"] == "not_run" and block["reason"] == T.REASON_NOT_REQUESTED
    assert block["n_episodes"] == 0 and block["n_words"] == 0 and block["trend"] == []
    assert me_only["dimensions"][0]["per_speaker"]["other"] is None
    assert all(row["status"] == "not_run" and row["weight"] == 0 and row["value"] is None
               and row["quote_ids"] == [] for row in block["contributions"])
    both = not_run_section(T.REASON_DISABLED, speakers=("me", "other"))
    _assert_section(both)
    assert both["speakers_scored"] == ["me", "other"]
    assert both["dimensions"][3]["per_speaker"]["other"]["status"] == "not_run"
    assert both["dimensions"][3]["per_speaker"]["other"]["reason"] == T.REASON_DISABLED


def test_section_constants_citations_and_registry_order():
    det, llm, episodes, weeks = _constant_case(n=30, words_each=100, llm_ran=True, agreement=0.8)
    section = build_section(det, llm, episodes, weeks, speakers=("me",), llm_ran=True)
    _assert_section(section)
    assert section["title"] == T.TITLE
    assert section["banner"] == T.BANNER
    assert section["scale_note"] == T.SCALE_NOTE
    assert section["footer_support"] == T.FOOTER_SUPPORT
    assert section["how_it_works"] == T.HOW_IT_WORKS
    assert section["scoring_version"] == "exp-scores-v1"
    assert section["prompt_versions"] == {"episode": "traits-exp-v1", "holistic": "exp-holistic-v1"}
    assert section["anchors_version"] == "exp-anchors-v1"
    assert section["thresholds"] == {"min_episodes": EXP_MIN_EPISODES, "min_words": EXP_MIN_WORDS,
                                    "max_confidence": EXP_MAX_CONFIDENCE}
    assert len(section["dimensions"]) == 12
    for dim, reg in zip(section["dimensions"], DIMENSIONS):
        assert dim["key"] == reg.key
        assert dim["label"] == reg.label
        assert dim["family"] == reg.family
        assert dim["evidence_strength"] == reg.evidence_strength
        assert dim["evidence_note"] == reg.evidence_note
        assert dim["citations"] == [{"short": cite.short, "doi": cite.doi} for cite in reg.citations]
        rows = dim["per_speaker"]["me"]["contributions"]
        assert [row["marker_key"] for row in sorted(rows, key=lambda r: r["marker_key"])] == sorted(
            m.id for m in c.markers_for(reg.key))
        assert len(rows) == len(c.markers_for(reg.key))
        for row in rows:
            assert row["source"] in ("D", "R", "H")
            assert row["direction"] in ("up", "down")
            assert row["status"] in ("ok", "not_run", "no_data")
    assert section["status"] == "ok"
    # One dimension can fail the marker rule while the section stays ok.
    only = _observe(episodes, "me", {"substance_first_person_rate": 0.25})
    det.observations = [obs for obs in det.observations if not obs.marker_id.startswith("substance_")]
    det.observations.extend(only)
    # Rebuild cleanly: drop addictive D markers except one by filtering observations.
    kept = [obs for obs in _constant_case(n=30, words_each=100)[0].observations
            if obs.marker_id not in {
                "gambling_first_person_rate", "craving_phrase_rate", "late_night_episode_share",
                "substance_first_person_rate"}]
    kept.extend(_observe(episodes, "me", {"substance_first_person_rate": 0.25}))
    partial = _det(kept, {"me": 3000}, {"me": 30})
    llm = _llm(("me",), 30, 0.8, observations=[])
    mixed = build_section(partial, llm, episodes, weeks, speakers=("me",), llm_ran=True)
    assert _block(mixed, "openness")["status"] == "ok"
    assert _block(mixed, "addictive_language")["reason"] == T.REASON_TOO_FEW_MARKERS
    assert mixed["status"] == "ok"


def test_down_marker_direction_differs_by_dimension_for_the_same_value():
    episodes = _episodes(1, 10)
    obs = [MarkerObservation("we_rate", "me", episodes[0].id, 0, 100, week_key(episodes[0]))]
    section = build_section(_det(obs, {"me": 10}, {"me": 1}), None, episodes, [], speakers=("me",), llm_ran=False)
    # value 0 is the low raw anchor. Up raises the sub-score only after a flip, so up -> 0 and down -> 1.
    agree = _by_marker(_block(section, "agreeableness"))["we_rate"]
    avoid = _by_marker(_block(section, "attachment_avoidant_language"))["we_rate"]
    assert agree["direction"] == "up" and agree["sub_score"] == 0
    assert avoid["direction"] == "down" and avoid["sub_score"] == 1
    assert agree["value"] == 0
