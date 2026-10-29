"""Experimental wording lint (plan section 3.8) and the section scrub that uses it."""

from __future__ import annotations

import json
import logging

from psychosight import safety
from psychosight.experimental import strings as T
from psychosight.experimental.section import apply_wording_lint, shell_section
from tests.exp_helpers import FakeTracks, make_episode
from psychosight.experimental.section import run_experimental
from psychosight.storage import Store


def test_lint_experimental_strips_allow_list_and_flags_banned():
    for text in T.ALLOW_LIST_CONSTANTS:
        assert safety.lint_experimental(text) == [], text
    assert safety.lint_experimental(T.BANNER + " you are a narcissist")
    assert safety.lint_experimental("you are a narcissist")
    assert safety.lint_experimental("you have depression")
    assert safety.lint_experimental("he is addicted")
    assert safety.lint_experimental("a clinical cutoff")
    assert safety.lint_experimental("at risk of something")
    assert safety.lint_experimental("high score")
    assert safety.lint_experimental("the number is low")
    assert safety.lint_experimental("below average")
    assert safety.lint_experimental("75th percentile")
    assert safety.lint_experimental("clin\u200bical relapse")
    # Trait words are allowed inside the section. The global lint still flags them.
    assert safety.lint_experimental("neuroticism") == []
    assert safety.lint("neuroticism")
    # Marker wording that merely contains "low-" is not a high/low score claim.
    assert safety.lint_experimental("Hopeless or low-energy wording (AI rating)") == []
    assert safety.lint_experimental(T.LINT_FALLBACK) == []


def test_global_lint_patterns_unchanged():
    assert any("diagnos" in p for p in safety.BANNED)
    assert safety.lint("This suggests a clinical elevation")
    # The banner is allow-listed only for the experimental lint. The global lint still flags it.
    assert safety.lint(T.BANNER)
    assert safety.lint_experimental(T.BANNER) == []


def test_scrub_replaces_hit_and_logs_only_the_rule(caplog):
    caplog.set_level(logging.INFO)
    section = shell_section("not_run", T.REASON_NOT_REQUESTED, ("me",))
    planted = "you are a narcissist"
    section["dimensions"][0]["per_speaker"]["me"]["contributions"][0]["label"] = planted
    cleaned = apply_wording_lint(section)
    label = cleaned["dimensions"][0]["per_speaker"]["me"]["contributions"][0]["label"]
    assert label == T.LINT_FALLBACK
    assert cleaned["banner"] == T.BANNER
    assert cleaned["how_it_works"] == T.HOW_IT_WORKS
    assert planted not in caplog.text
    assert any("experimental lint rule=" in rec.message and "narcissis" in rec.message for rec in caplog.records)
    assert planted not in json.dumps([rec.message for rec in caplog.records])


def test_run_experimental_scrubs_before_return(tmp_path, caplog, monkeypatch):
    caplog.set_level(logging.INFO)
    fake = FakeTracks()
    fake.bad_label = "you are a narcissist"
    fake.install(monkeypatch)
    section, stats = run_experimental(
        episodes=[make_episode()], selection={"ep1": "top_signal"}, provider=object(),
        store=Store(tmp_path / "s.db"), llm_ran=False, speakers=("me",), week_order=["2025-W40"],
        progress=None)
    assert section["dimensions"][0]["per_speaker"]["me"]["contributions"][0]["label"] == T.LINT_FALLBACK
    assert "you are a narcissist" not in caplog.text
    assert stats.llm_calls == 0


def test_holistic_prompt_is_exp_allow_listed_and_episode_prompt_is_not():
    from psychosight import safety
    from psychosight.experimental import llm_exp
    assert llm_exp.HOLISTIC_SYSTEM_PROMPT in safety.EXP_ALLOW_LIST
    assert safety.lint_experimental(llm_exp.HOLISTIC_SYSTEM_PROMPT) == []
    assert llm_exp.HOLISTIC_SYSTEM_PROMPT not in safety.ALLOW_LIST
    for speakers in (("me",), ("me", "other")):
        assert llm_exp.episode_system_prompt(speakers) not in safety.EXP_ALLOW_LIST
