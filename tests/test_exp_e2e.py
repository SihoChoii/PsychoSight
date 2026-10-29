"""End-to-end experimental scores.

Direction, gating, quote separation, and forbidden keys call the pipeline and skip until
Tracks A–D replace the NotImplementedError stubs. Fixture size checks and the stored
1.0.0 report check in test_exp_schema.py run before that merge.

The pipeline call uses the frozen API field names as keyword arguments:
``experimental_scores=True`` and ``score_other=True``.
"""

from __future__ import annotations

import inspect
import json

import jsonschema
import pytest

from psychosight import pipeline
from psychosight.experimental import contract
from psychosight.experimental import strings
from psychosight.mock_provider import MockProvider
from psychosight.storage import Store
from tests.exp_fixtures import (
    ME_MARKER_WORDS,
    NEUTRAL_WORDS,
    OTHER_ANGER_WORDS,
    OTHER_MARKER_WORDS,
    OTHER_SWEAR_WORDS,
    BuiltConversation,
    build_conversation,
)

_SCHEMA = None


def _validator():
    global _SCHEMA
    if _SCHEMA is None:
        from psychosight import config
        _SCHEMA = json.loads(config.SCHEMA_PATH.read_text())
    return jsonschema.Draft202012Validator(_SCHEMA, format_checker=jsonschema.FormatChecker())


def _tracks_ad_ready() -> bool:
    """False while any A–D stub still raises NotImplementedError."""
    try:
        from psychosight.experimental import deterministic, llm_exp, mock_exp, scoring, section
    except Exception:
        return False
    probes = (
        (deterministic.compute_deterministic, ([], ("me",)), {}),
        (mock_exp.complete, ("TASK: EXPERIMENTAL", "x", 0), {}),
        (scoring.not_run_section, ("not requested",), {}),
        (scoring.build_section, (None, None, [], []), {"speakers": ("me",), "llm_ran": False}),
        (llm_exp.score_llm, (None, [], None), {"speakers": ("me",), "budget": None, "holistic": False}),
        (section.run_experimental, (), {
            "episodes": [], "selection": {}, "provider": None, "store": None,
            "llm_ran": False, "speakers": ("me",), "week_order": [], "progress": None,
        }),
    )
    for fn, args, kwargs in probes:
        try:
            fn(*args, **kwargs)
        except NotImplementedError:
            return False
        except Exception:
            continue
    return True


def _walk_keys(node):
    if isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from _walk_keys(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk_keys(value)


def _block(report: dict, key: str, speaker: str) -> dict:
    dim = next(item for item in report["experimental_scores"]["dimensions"] if item["key"] == key)
    block = dim["per_speaker"][speaker]
    assert isinstance(block, dict), (key, speaker)
    return block


def _assert_no_forbidden(section: dict) -> None:
    found = [key for key in _walk_keys(section) if key in contract.FORBIDDEN_KEYS]
    assert found == []


def _assert_quotes_isolated(report: dict, built: BuiltConversation) -> None:
    section = report["experimental_scores"]
    exp_ids = {quote["id"] for quote in section["quotes"]}
    top_ids = {quote["quote_id"] for quote in report["quotes"]}
    assert exp_ids.isdisjoint(top_ids)
    assert all(not quote_id.startswith("xq_") for quote_id in top_ids)
    by_speaker = {"me": [], "other": []}
    for msg in built.messages:
        by_speaker[msg.speaker].append(msg.text)
    for quote in section["quotes"]:
        assert quote["id"].startswith("xq_")
        assert quote["text"]
        assert any(quote["text"] in text for text in by_speaker[quote["speaker"]])
    for obs in report["observations"].get("items") or []:
        for quote in obs.get("quotes") or []:
            assert quote["quote_id"] not in exp_ids
            assert not str(quote["quote_id"]).startswith("xq_")
        assert not any(str(item).startswith("xq_") for item in obs.get("item_keys") or [])


def _assert_confidence(report: dict) -> None:
    for dim in report["experimental_scores"]["dimensions"]:
        spec = contract.DIMENSIONS_BY_KEY[dim["key"]]
        for block in dim["per_speaker"].values():
            if not isinstance(block, dict):
                continue
            assert block["confidence"] != "high"
            if block["confidence"] is not None:
                assert block["confidence"] in contract.CONFIDENCES
            if block["status"] == "ok" and (spec.max_confidence == "low" or spec.evidence_strength != "moderate"):
                assert block["confidence"] == "low", (dim["key"], block["confidence"])


def _analyze(monkeypatch, tmp_path, built: BuiltConversation, *, llm_opt_in: bool, report_id: str) -> dict:
    monkeypatch.delenv("PSYCHOSIGHT_EXPERIMENTAL", raising=False)
    monkeypatch.setenv("PSYCHOSIGHT_DEMO_PROVIDER", "mock")
    data = built.as_conversation()

    def _load(conversation_id, date_from=None, date_to=None, db_path=None):
        assert conversation_id == built.conversation_id
        return data

    monkeypatch.setattr(pipeline.loader, "load_conversation", _load)
    params = inspect.signature(pipeline.run_analysis).parameters
    missing = [name for name in ("experimental_scores", "score_other") if name not in params]
    if missing:
        pytest.fail(
            "run_analysis is missing %s; the frozen API fields need to reach the pipeline" % ", ".join(missing)
        )
    kwargs = dict(
        llm_opt_in=llm_opt_in,
        mode="full" if llm_opt_in else "deterministic_only",
        store=Store(tmp_path / f"{report_id}.db"),
        save=True,
        experimental_scores=True,
        score_other=True,
        report_id=report_id,
    )
    if llm_opt_in:
        kwargs["provider"] = MockProvider()
    stages = []
    report = pipeline.run_analysis(
        built.conversation_id, progress=lambda stage, _cur, _tot: stages.append(stage), **kwargs
    )
    assert "experimental" in stages
    section = report["experimental_scores"]
    _assert_no_forbidden(section)
    _assert_quotes_isolated(report, built)
    _assert_confidence(report)
    _validator().validate(report)
    return report


# Directions the planted markers must move, versus a neutral control of the same size.
_DIRECTIONS = (
    ("neuroticism", "me", "gt"),
    ("anxiety_language", "me", "gt"),
    ("depression_language", "me", "gt"),
    ("anger_hostility_language", "other", "gt"),
    ("agreeableness", "other", "lt"),
)


def _assert_directions(planted: dict, control: dict) -> None:
    assert planted["experimental_scores"]["status"] == "ok", planted["experimental_scores"].get("reason")
    assert control["experimental_scores"]["status"] == "ok", control["experimental_scores"].get("reason")
    assert planted["header"]["word_counts"] == control["header"]["word_counts"]
    assert planted["header"]["episode_count"] == control["header"]["episode_count"]
    for key, speaker, op in _DIRECTIONS:
        left = _block(planted, key, speaker)
        right = _block(control, key, speaker)
        assert left["status"] == "ok", (key, speaker, "planted", left["status"], left.get("reason"))
        assert right["status"] == "ok", (key, speaker, "control", right["status"], right.get("reason"))
        if op == "gt":
            assert left["score"] > right["score"], (key, speaker, left["score"], right["score"])
        else:
            assert left["score"] < right["score"], (key, speaker, left["score"], right["score"])


def test_fixture_sizes_straddle_thresholds_and_plant_markers():
    below_eps = build_conversation(n_episodes=19, words_me=1900, words_other=1900, planted=False)
    above_eps = build_conversation(n_episodes=20, words_me=1600, words_other=1600, planted=False)
    below_words = build_conversation(n_episodes=20, words_me=1499, words_other=1499, planted=False)
    above_words = build_conversation(n_episodes=20, words_me=1500, words_other=1500, planted=False)
    assert below_eps.n_episodes == 19 and below_eps.words["me"] == 1900
    assert above_eps.n_episodes == 20 and above_eps.words == {"me": 1600, "other": 1600}
    assert below_words.words == {"me": 1499, "other": 1499}
    assert above_words.words == {"me": 1500, "other": 1500}
    assert len(below_words.episodes) == 20

    planted = build_conversation(n_episodes=4, words_me=80, words_other=80, planted=True)
    control = build_conversation(n_episodes=4, words_me=80, words_other=80, planted=False)
    me_planted = " ".join(msg.text for msg in planted.messages if msg.speaker == "me").split()
    other_planted = " ".join(msg.text for msg in planted.messages if msg.speaker == "other").split()
    control_tokens = {tok for msg in control.messages for tok in msg.text.split()}
    assert any(tok in ME_MARKER_WORDS for tok in me_planted)
    assert "i" in me_planted
    assert any(tok in OTHER_ANGER_WORDS for tok in other_planted)
    assert any(tok in OTHER_SWEAR_WORDS for tok in other_planted)
    assert control_tokens.isdisjoint(ME_MARKER_WORDS)
    assert control_tokens.isdisjoint(OTHER_MARKER_WORDS)
    assert control_tokens.isdisjoint({"i", "me", "my", "we", "you"})
    assert set(NEUTRAL_WORDS).isdisjoint(ME_MARKER_WORDS + OTHER_MARKER_WORDS)


@pytest.mark.skipif(not _tracks_ad_ready(), reason="tracks A-D not merged")
class TestExperimentalPipeline:
    def test_planted_dimensions_move_against_control_without_llm(self, monkeypatch, tmp_path):
        kwargs = dict(n_episodes=28, words_me=2800, words_other=2800)
        planted = _analyze(
            monkeypatch, tmp_path,
            build_conversation(planted=True, conversation_id="exp-planted", **kwargs),
            llm_opt_in=False, report_id="det-planted",
        )
        control = _analyze(
            monkeypatch, tmp_path,
            build_conversation(planted=False, conversation_id="exp-control", **kwargs),
            llm_opt_in=False, report_id="det-control",
        )
        _assert_directions(planted, control)
        assert planted["run_meta"]["llm_opt_in"] is False
        # Word-count-only: episode AI items and the overall rating do not run.
        neuroticism = _block(planted, "neuroticism", "me")
        sources = {item["marker_key"]: item for item in neuroticism["contributions"]}
        assert sources["llm.expressed_worry"]["status"] == "not_run"
        assert sources["holistic.neuroticism"]["status"] == "not_run"

    def test_planted_dimensions_move_with_mock_llm_and_quotes_stay_in_section(self, monkeypatch, tmp_path):
        kwargs = dict(n_episodes=28, words_me=2800, words_other=2800)
        planted = _analyze(
            monkeypatch, tmp_path,
            build_conversation(planted=True, conversation_id="exp-planted-llm", **kwargs),
            llm_opt_in=True, report_id="llm-planted",
        )
        control = _analyze(
            monkeypatch, tmp_path,
            build_conversation(planted=False, conversation_id="exp-control-llm", **kwargs),
            llm_opt_in=True, report_id="llm-control",
        )
        assert planted["run_meta"]["provider"] == "mock"
        assert control["run_meta"]["provider"] == "mock"
        _assert_directions(planted, control)

    def test_nineteen_episodes_are_insufficient_and_twenty_are_ok(self, monkeypatch, tmp_path):
        thin = _analyze(
            monkeypatch, tmp_path,
            build_conversation(n_episodes=19, words_me=1900, words_other=1900, planted=False, conversation_id="exp-e19"),
            llm_opt_in=False, report_id="e19",
        )
        enough = _analyze(
            monkeypatch, tmp_path,
            build_conversation(n_episodes=20, words_me=1600, words_other=1600, planted=False, conversation_id="exp-e20"),
            llm_opt_in=False, report_id="e20",
        )
        for speaker in ("me", "other"):
            blocked = _block(thin, "neuroticism", speaker)
            assert blocked["status"] == "insufficient_data"
            assert blocked["reason"] == strings.REASON_TOO_FEW_EPISODES
            assert blocked["score"] is None and blocked["band"] is None and blocked["confidence"] is None
            assert blocked["n_episodes"] == 19 and blocked["n_words"] == 1900
            opened = _block(enough, "neuroticism", speaker)
            assert opened["status"] == "ok", opened.get("reason")
            assert isinstance(opened["score"], int)
            assert opened["n_episodes"] == 20 and opened["n_words"] == 1600
            assert opened["confidence"] == "low"

    def test_1499_words_are_insufficient_and_1500_are_ok(self, monkeypatch, tmp_path):
        thin = _analyze(
            monkeypatch, tmp_path,
            build_conversation(n_episodes=20, words_me=1499, words_other=1499, planted=False, conversation_id="exp-w1499"),
            llm_opt_in=False, report_id="w1499",
        )
        enough = _analyze(
            monkeypatch, tmp_path,
            build_conversation(n_episodes=20, words_me=1500, words_other=1500, planted=False, conversation_id="exp-w1500"),
            llm_opt_in=False, report_id="w1500",
        )
        for speaker in ("me", "other"):
            blocked = _block(thin, "extraversion", speaker)
            assert blocked["status"] == "insufficient_data"
            assert blocked["reason"] == strings.REASON_TOO_FEW_WORDS
            assert blocked["score"] is None and blocked["n_words"] == 1499 and blocked["n_episodes"] == 20
            opened = _block(enough, "extraversion", speaker)
            assert opened["status"] == "ok", opened.get("reason")
            assert isinstance(opened["score"], int)
            assert opened["n_words"] == 1500 and opened["n_episodes"] == 20
            assert opened["band"]["lo"] <= opened["band"]["hi"]
