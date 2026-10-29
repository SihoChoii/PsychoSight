"""Experimental scores contract (plan section 3): registry integrity, strings, schema 1.1.0, samples, hooks."""

from __future__ import annotations

import copy
import dataclasses
import importlib
import inspect
import json
import re
from pathlib import Path

import jsonschema
import pytest

from psychosight import config, safety
from psychosight.experimental import contract as c
from psychosight.experimental import strings as T

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "schemas" / "report.schema.json").read_text())
SAMPLE = json.loads((ROOT / "docs" / "sample_experimental_scores.json").read_text())

# Plan section 3.4, frozen: dimension -> [(marker id, source code, direction, weight)].
EXPECTED_MARKERS = {
    "openness": [("wwbp.openness", "D", 1, .43), ("long_word_share", "D", 1, .10), ("empath_intellect", "D", 1, .10),
                 ("holistic.openness", "H", 1, .29)],
    "conscientiousness": [("wwbp.conscientiousness", "D", 1, .37), ("swear_rate", "D", -1, .10),
                          ("llm.follows_through_on_plans", "R", 1, .05), ("holistic.conscientiousness", "H", 1, .29)],
    "extraversion": [("wwbp.extraversion", "D", 1, .42), ("pos_emotion_rate", "D", 1, .15),
                     ("social_word_rate", "D", 1, .10), ("initiation_share", "D", 1, .05),
                     ("holistic.extraversion", "H", 1, .29)],
    "agreeableness": [("wwbp.agreeableness", "D", 1, .35), ("anger_swear_rate", "D", -1, .15), ("we_rate", "D", 1, .10),
                      ("llm.validates_feelings", "R", 1, .05), ("llm.assigns_fault_to_other", "R", -1, .05),
                      ("llm.escalating_language", "R", -1, .05), ("llm.repair_attempts", "R", 1, .05),
                      ("holistic.agreeableness", "H", 1, .29)],
    "neuroticism": [("wwbp.neuroticism", "D", 1, .35), ("neg_emotion_rate", "D", 1, .15),
                    ("anxiety_word_rate", "D", 1, .10), ("i_rate", "D", 1, .10), ("llm.expressed_worry", "R", 1, .05),
                    ("llm.reassurance_seeking", "R", 1, .05), ("holistic.neuroticism", "H", 1, .29)],
    "depression_language": [("i_rate", "D", 1, .13), ("neg_emotion_rate", "D", 1, .10), ("vader_compound", "D", -1, .10),
                            ("absolutist_rate", "D", 1, .05), ("llm.hopeless_or_low_energy_wording", "R", 1, .05),
                            ("llm.negative_self_evaluation", "R", 1, .05)],
    "anxiety_language": [("anxiety_word_rate", "D", 1, .10), ("tentative_worry_rate", "D", 1, .08),
                         ("absolutist_rate", "D", 1, .05), ("llm.expressed_worry", "R", 1, .05),
                         ("llm.reassurance_seeking", "R", 1, .05)],
    "addictive_language": [("substance_first_person_rate", "D", 1, .05), ("gambling_first_person_rate", "D", 1, .05),
                           ("craving_phrase_rate", "D", 1, .05), ("late_night_episode_share", "D", 1, .05),
                           ("llm.urge_or_loss_of_control_wording", "R", 1, .05),
                           ("llm.using_to_cope_wording", "R", 1, .05)],
    "anger_hostility_language": [("anger_rage_rate", "D", 1, .12), ("swear_rate", "D", 1, .10),
                                 ("llm.escalating_language", "R", 1, .05), ("llm.assigns_fault_to_other", "R", 1, .05)],
    "narcissism_language": [("we_rate", "D", 1, .05), ("achievement_work_rate", "D", 1, .06), ("you_rate", "D", 1, .06),
                            ("tentative_anxiety_rate", "D", -1, .05), ("llm.topic_redirect_to_self", "R", 1, .05),
                            ("llm.superiority_or_entitlement_phrasing", "R", 1, .05),
                            ("llm.validates_feelings", "R", -1, .05)],
    "attachment_anxious_language": [("i_rate", "D", 1, .08), ("double_text_rate", "D", 1, .05),
                                    ("llm.reassurance_seeking", "R", 1, .05),
                                    ("llm.worry_about_the_relationship", "R", 1, .05)],
    "attachment_avoidant_language": [("we_rate", "D", -1, .08), ("llm.emotional_disclosure", "R", -1, .05),
                                     ("llm.deflects_closeness", "R", 1, .05)],
}
EXPECTED_DIMENSIONS = [
    ("openness", "big_five", "moderate", "medium"), ("conscientiousness", "big_five", "moderate", "medium"),
    ("extraversion", "big_five", "moderate", "medium"), ("agreeableness", "big_five", "moderate", "medium"),
    ("neuroticism", "big_five", "moderate", "medium"), ("depression_language", "wellbeing_language", "small", "low"),
    ("anxiety_language", "wellbeing_language", "small", "low"),
    ("addictive_language", "wellbeing_language", "very_weak", "low"),
    ("anger_hostility_language", "interpersonal", "small", "low"),
    ("narcissism_language", "interpersonal", "very_weak", "low"),
    ("attachment_anxious_language", "interpersonal", "very_weak", "low"),
    ("attachment_avoidant_language", "interpersonal", "very_weak", "low"),
]


def full_validator():
    jsonschema.Draft202012Validator.check_schema(SCHEMA)
    return jsonschema.Draft202012Validator(SCHEMA, format_checker=jsonschema.FormatChecker())


def section_validator():
    sub = {"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"], "$ref": "#/$defs/experimentalScores"}
    return jsonschema.Draft202012Validator(sub, format_checker=jsonschema.FormatChecker())


def report_with_section(section):
    report = json.loads((ROOT / "docs" / "sample_report.json").read_text())
    report["schema_version"] = "1.1.0"
    report["experimental_scores"] = section
    report["run_meta"].update({
        "experimental_opt_in": True, "score_other_opt_in": True, "experimental_scoring_version": "exp-scores-v1",
        "experimental_prompt_versions": {"episode": "traits-exp-v1", "holistic": "exp-holistic-v1"},
        "experimental_llm_calls": 84, "experimental_cache_hits": 0})
    return report


def walk_keys(node):
    if isinstance(node, dict):
        for k, v in node.items():
            yield k
            yield from walk_keys(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk_keys(v)


def walk_strings(node):
    if isinstance(node, dict):
        for v in node.values():
            yield from walk_strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk_strings(v)
    elif isinstance(node, str):
        yield node


# ---------- registry ----------
def test_dimensions_exact_and_ordered():
    got = [(d.key, d.family, d.evidence_strength, d.max_confidence) for d in c.DIMENSIONS]
    assert got == EXPECTED_DIMENSIONS
    for d in c.DIMENSIONS:
        assert d.label == T.DIMENSION_LABELS[d.key] and d.label.endswith("(experimental language index)")
        assert d.evidence_note == T.EVIDENCE_NOTES[d.key] and d.evidence_note.startswith(
            "Language markers associated in research with ")
        assert d.citations and all(ci.short for ci in d.citations)
        assert d.family in T.FAMILY_LABELS
        if d.evidence_strength != "moderate":
            assert d.max_confidence == "low"
    assert list(T.DIMENSION_LABELS) == list(c.DIMENSION_KEYS)


def test_marker_registry_matches_plan_table():
    for dim in c.DIMENSION_KEYS:
        got = [(m.id, c.SOURCE_CODES[m.source], m.direction, m.weight) for m in c.markers_for(dim)]
        assert got == EXPECTED_MARKERS[dim], dim
    assert len(c.MARKERS) == sum(len(v) for v in EXPECTED_MARKERS.values())


def test_marker_registry_integrity():
    pairs = [(m.id, m.dimension) for m in c.MARKERS]
    assert len(pairs) == len(set(pairs))
    for m in c.MARKERS:
        assert m.dimension in c.DIMENSIONS_BY_KEY
        assert m.direction in (1, -1) and 0.05 <= m.weight <= 1
        assert m.unit in c.UNITS and m.label
        assert m.requires_wwbp == m.id.startswith("wwbp.")
        if m.source == "holistic":
            assert m.cap_share == 0.40 and m.dimension in c.BIG_FIVE and m.id == f"holistic.{m.dimension}"
        elif m.source == "llm":
            assert m.cap_share == 0.25 and m.id[len("llm."):] in c.EPISODE_ITEMS
        else:
            assert m.cap_share is None and m.source == "deterministic"
    for dim in c.DIMENSION_KEYS:
        assert any(m.source == "deterministic" for m in c.markers_for(dim)), dim
    used_items = {m.id[len("llm."):] for m in c.MARKERS if m.source == "llm"}
    assert used_items == set(c.EPISODE_ITEMS) == set(c.EPISODE_ITEM_LABELS)
    assert set(c.RUBRIC_V1_REUSED_ITEMS) <= set(c.EPISODE_ITEMS)
    # No I-talk for narcissism (Carey et al. 2015).
    assert "i_rate" not in {m.id for m in c.markers_for("narcissism_language")}


def test_registry_is_frozen():
    assert isinstance(c.MARKERS, tuple) and isinstance(c.DIMENSIONS, tuple)
    with pytest.raises(dataclasses.FrozenInstanceError):
        c.MARKERS[0].weight = 1.0  # type: ignore[misc]
    with pytest.raises(dataclasses.FrozenInstanceError):
        c.DIMENSIONS[0].label = "x"  # type: ignore[misc]


def test_rubric_v1_reused_items_exist_in_rubric():
    from psychosight.rubric import ITEM_KEYS
    assert set(c.RUBRIC_V1_REUSED_ITEMS) <= set(ITEM_KEYS)


def test_anchors_placeholder_covers_every_marker():
    data = json.loads((ROOT / "psychosight" / "experimental" / "data" / "exp_anchors_v1.json").read_text())
    assert data["anchors_version"] == c.EXP_ANCHORS_VERSION
    for m in c.MARKERS:
        a = data["markers"][m.id]
        assert a["anchor_source"]
        if m.requires_wwbp:
            assert {"c", "k"} <= set(a)
        else:
            assert a["lo"] < a["hi"]
        if m.source in ("llm", "holistic"):
            assert (a["lo"], a["hi"]) == (1, 5)


def test_constants_and_env_names():
    assert (c.EXP_SCORING_VERSION, c.EXP_PROMPT_VERSION, c.EXP_HOLISTIC_PROMPT_VERSION, c.EXP_ANCHORS_VERSION) == (
        "exp-scores-v1", "traits-exp-v1", "exp-holistic-v1", "exp-anchors-v1")
    assert (c.EXP_MAX_LLM_CALLS, c.EXP_MIN_EPISODES, c.EXP_MIN_WORDS, c.EXP_MEDIUM_EPISODES, c.EXP_MEDIUM_WORDS) == (
        110, 20, 1500, 30, 3000)
    assert (c.EXP_MEDIUM_AGREEMENT, c.EXP_BOOTSTRAP, c.EXP_SEED, c.EXP_HOLISTIC_MAX_WORDS) == (0.8, 200, 1017, 3000)
    assert (c.EXP_TREND_MIN_WORDS, c.EXP_TREND_MIN_EPISODES) == (300, 3)
    assert c.ENV_EXPERIMENTAL == "PSYCHOSIGHT_EXPERIMENTAL"
    assert c.ENV_EXP_MAX_LLM_CALLS == "PSYCHOSIGHT_EXP_MAX_LLM_CALLS"
    assert c.EVIDENCE_BAND_PENALTY == {"moderate": 5, "small": 10, "weak": 15, "very_weak": 20}
    assert "high" not in c.CONFIDENCES
    assert config.SCHEMA_VERSION == c.EXP_SCHEMA_VERSION == "1.1.0"


@pytest.mark.parametrize("name", list(c.TRACK_FUNCTIONS))
def test_track_function_signatures(name):
    module, params = c.TRACK_FUNCTIONS[name]
    fn = getattr(importlib.import_module(module), name)
    assert tuple(inspect.signature(fn).parameters) == params


# ---------- strings ----------
def test_fixed_strings_match_plan():
    assert T.BANNER.startswith("Experimental, not validated. These scores are not a diagnosis")
    assert T.SCALE_NOTE.startswith("0–100 experimental index. 50 is the midpoint of fixed reference points")
    assert T.EXPERIMENTAL_CONSENT.startswith("Show experimental personality and well-being language scores.")
    assert T.SCORE_OTHER_CONSENT.startswith("Also score the other person. They have not agreed to be scored.")
    assert T.FOOTER_SUPPORT.startswith("If anything in this conversation is weighing on you")
    assert T.TITLE == "Experimental scores"
    for s in T.ALLOW_LIST_CONSTANTS:
        assert s in safety.EXP_ALLOW_LIST


def test_constants_avoid_section_banned_terms():
    # Banned inside the section even for constants; "diagnos" is allowed only via the banner and consents.
    hard = [p for p in safety.EXP_BANNED if p != r"diagnos"]
    for s in T.ALLOW_LIST_CONSTANTS:
        low = safety._normalize_for_lint(s)
        assert [p for p in hard if re.search(p, low)] == [], s
    for s in (T.SCALE_NOTE, T.FOOTER_SUPPORT, T.HOW_IT_WORKS, *T.DIMENSION_LABELS.values(), *T.EVIDENCE_NOTES.values()):
        assert "diagnos" not in s.lower()


def test_exp_banned_patterns_compile_and_catch_examples():
    pats = [re.compile(p) for p in safety.EXP_BANNED]
    for bad in ("you are a narcissist", "you have depression", "he is addicted", "a clinical cutoff", "at risk",
                "high score", "below average", "75th percentile"):
        assert any(p.search(bad) for p in pats), bad
    assert callable(safety.lint_experimental)


# ---------- schema 1.1.0 ----------
@pytest.mark.parametrize("name", ["sample_report.json", "sample_report_deterministic_only.json"])
def test_old_reports_without_section_still_validate(name):
    report = json.loads((ROOT / "docs" / name).read_text())
    assert "experimental_scores" not in report
    full_validator().validate(report)
    report["schema_version"] = "1.1.0"
    full_validator().validate(report)


def test_schema_version_enum():
    assert SCHEMA["properties"]["schema_version"]["enum"] == ["1.0.0", "1.1.0"]
    assert "experimental_scores" not in SCHEMA["required"]
    assert "provider_note" in SCHEMA["$defs"]["runMeta"]["properties"]  # rich-demo field kept


def test_sample_validates_as_section_and_inside_report():
    section_validator().validate(SAMPLE)
    full_validator().validate(report_with_section(SAMPLE))


def test_schema_consts_match_strings_and_registry():
    props = SCHEMA["$defs"]["experimentalScores"]["properties"]
    assert props["banner"]["const"] == T.BANNER
    assert props["scale_note"]["const"] == T.SCALE_NOTE
    assert props["footer_support"]["const"] == T.FOOTER_SUPPORT
    assert props["how_it_works"]["const"] == T.HOW_IT_WORKS
    assert props["title"]["const"] == T.TITLE
    prefix = props["dimensions"]["prefixItems"]
    assert [p["properties"]["key"]["const"] for p in prefix] == list(c.DIMENSION_KEYS)
    assert [p["properties"]["label"]["const"] for p in prefix] == [d.label for d in c.DIMENSIONS]


def test_schema_rejects_bad_sections():
    v = section_validator()
    bad = copy.deepcopy(SAMPLE)
    bad["dimensions"][0]["per_speaker"]["me"]["confidence"] = "high"
    assert list(v.iter_errors(bad))
    bad = copy.deepcopy(SAMPLE)
    bad["dimensions"][9]["per_speaker"]["me"]["confidence"] = "medium"  # narcissism: max low
    assert list(v.iter_errors(bad))
    bad = copy.deepcopy(SAMPLE)
    bad["dimensions"][0], bad["dimensions"][1] = bad["dimensions"][1], bad["dimensions"][0]  # order
    assert list(v.iter_errors(bad))
    bad = copy.deepcopy(SAMPLE)
    bad["dimensions"].pop()
    assert list(v.iter_errors(bad))
    bad = copy.deepcopy(SAMPLE)
    bad["dimensions"][0]["per_speaker"]["me"]["percentile"] = 80
    assert list(v.iter_errors(bad))
    bad = copy.deepcopy(SAMPLE)
    bad["banner"] = "Scores"
    assert list(v.iter_errors(bad))
    bad = copy.deepcopy(SAMPLE)
    bad["dimensions"][0]["per_speaker"]["me"]["score"] = 101
    assert list(v.iter_errors(bad))


def test_forbidden_keys_absent_from_schema_section_and_sample():
    subtree_names = ["experimentalScores", "expDimension", "expSpeakerScore", "expContribution", "expTrendPoint",
                     "expQuote", "expCitation"]
    for name in subtree_names:
        keys = set(walk_keys(SCHEMA["$defs"][name]))
        assert not keys & set(c.FORBIDDEN_KEYS), name
    assert not set(walk_keys(SAMPLE)) & set(c.FORBIDDEN_KEYS)


# ---------- hand-written sample ----------
def test_sample_shape_and_rules():
    assert SAMPLE["speakers_scored"] == ["me", "other"]
    assert [d["key"] for d in SAMPLE["dimensions"]] == list(c.DIMENSION_KEYS)
    statuses = []
    quote_ids = {q["id"] for q in SAMPLE["quotes"]}
    for d in SAMPLE["dimensions"]:
        dim = c.DIMENSIONS_BY_KEY[d["key"]]
        for sp in ("me", "other"):
            s = d["per_speaker"][sp]
            assert s is not None
            statuses.append(s["status"])
            assert s["confidence"] in ("low", "medium", None)
            if dim.max_confidence == "low":
                assert s["confidence"] in ("low", None)
            assert {x["marker_key"] for x in s["contributions"]} == {m.id for m in c.markers_for(d["key"])}
            assert set(s["quote_ids"]) <= quote_ids
            for x in s["contributions"]:
                assert set(x["quote_ids"]) <= quote_ids
            if s["status"] == "ok":
                assert s["band"]["lo"] <= s["score"] <= s["band"]["hi"]
                assert abs(sum(x["weight"] for x in s["contributions"]) - 1) < 0.01
    assert "insufficient_data" in statuses and statuses.count("ok") >= 20
    for q in SAMPLE["quotes"]:
        assert q["speaker"] in ("me", "other") and q["text"]


def test_sample_strings_pass_section_lint_patterns():
    allowed = set(T.ALLOW_LIST_CONSTANTS)
    for s in walk_strings(SAMPLE):
        if s in allowed:
            continue
        low = safety._normalize_for_lint(s)
        assert [p for p in safety.EXP_BANNED if re.search(p, low)] == [], s


# ---------- mock dispatch ----------
@pytest.mark.parametrize("prefix", [c.PROMPT_PREFIX_EPISODE, c.PROMPT_PREFIX_HOLISTIC])
def test_mock_provider_routes_experimental_prompts(monkeypatch, prefix):
    from psychosight.experimental import mock_exp
    from psychosight.llm import LLMResult
    from psychosight.mock_provider import MockProvider

    seen = {}

    def fake(system, user, run_idx=0):
        seen.update(system=system, user=user, run_idx=run_idx)
        return LLMResult(content="{}")

    monkeypatch.setattr(mock_exp, "complete", fake)
    out = MockProvider().complete(prefix + "\n...", "data", run_idx=1)
    assert out.content == "{}" and seen == {"system": prefix + "\n...", "user": "data", "run_idx": 1}
