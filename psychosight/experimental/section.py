"""Track D: run_experimental() orchestrator used by the pipeline.

Calls Track A, then Track B when the main LLM ran, then Track C. Any failure becomes a section
with status ``failed`` so the main report still returns. The experimental call budget is created
here: the frozen signature has no budget parameter, and this budget is not the rubric budget.
"""

from __future__ import annotations

import copy
import json
import logging
from functools import lru_cache
from typing import Optional, Sequence, Tuple

import jsonschema

from .. import config, rubric
from . import deterministic, llm_exp, scoring
from . import strings as exp_strings
from .contract import (
    DIMENSIONS, DIRECTION_CODES, ENV_EXP_MAX_LLM_CALLS, EXP_ANCHORS_VERSION, EXP_HOLISTIC_PROMPT_VERSION,
    EXP_MAX_CONFIDENCE, EXP_MAX_LLM_CALLS, EXP_MIN_EPISODES, EXP_MIN_WORDS, EXP_PROMPT_VERSION,
    EXP_SCORING_VERSION, EXP_SEED, SOURCE_CODES, ExpLLMStats, markers_for,
)

log = logging.getLogger("psychosight.experimental.section")


def scored_speakers(speakers: Optional[Sequence[str]]) -> Tuple[str, ...]:
    """``("me",)`` or ``("me", "other")``. ``me`` is always included; order matches the schema enum."""
    include_other = any(s == "other" for s in (speakers or ()))
    if include_other:
        return ("me", "other")
    return ("me",)


def shell_section(status: str, reason: str, speakers: Sequence[str] = ("me",)) -> dict:
    """Schema-valid section used when Track C is not available, or the stage failed.

    Every registry marker is listed. Speaker score, band and confidence are null unless status is
    ``ok`` (this helper is only for ``not_run`` and ``failed``). Contribution status stays
    ``not_run`` because that enum has no ``failed``.
    """
    scored = scored_speakers(speakers)
    # speakers_scored records who was requested. The other person's block is null when not requested,
    # matching Track C's build_section and not_run_section.

    def speaker_block(dimension, block_status: str, block_reason: str) -> dict:
        return {
            "status": block_status,
            "reason": block_reason,
            "score": None,
            "band": None,
            "confidence": None,
            "n_episodes": 0,
            "n_words": 0,
            "contributions": [_not_run_contribution(m) for m in markers_for(dimension.key)],
            "trend": [],
            "quote_ids": [],
        }

    dimensions = []
    for dim in DIMENSIONS:
        me = speaker_block(dim, status, reason)
        other = speaker_block(dim, status, reason) if "other" in scored else None
        dimensions.append({
            "key": dim.key,
            "label": dim.label,
            "family": dim.family,
            "evidence_strength": dim.evidence_strength,
            "evidence_note": dim.evidence_note,
            "citations": [{"short": cite.short, "doi": cite.doi} for cite in dim.citations],
            "per_speaker": {"me": me, "other": other},
        })
    return {
        "status": status,
        "reason": reason,
        "banner": exp_strings.BANNER,
        "title": exp_strings.TITLE,
        "scale_note": exp_strings.SCALE_NOTE,
        "footer_support": exp_strings.FOOTER_SUPPORT,
        "how_it_works": exp_strings.HOW_IT_WORKS,
        "scoring_version": EXP_SCORING_VERSION,
        "prompt_versions": {"episode": EXP_PROMPT_VERSION, "holistic": EXP_HOLISTIC_PROMPT_VERSION},
        "anchors_version": EXP_ANCHORS_VERSION,
        "speakers_scored": list(scored),
        "thresholds": {
            "min_episodes": EXP_MIN_EPISODES,
            "min_words": EXP_MIN_WORDS,
            "max_confidence": EXP_MAX_CONFIDENCE,
        },
        "dimensions": dimensions,
        "quotes": [],
    }


def _not_run_contribution(marker) -> dict:
    return {
        "marker_key": marker.id,
        "label": marker.label,
        "source": SOURCE_CODES[marker.source],
        "direction": DIRECTION_CODES[marker.direction],
        "weight": 0,
        "value": None,
        "unit": marker.unit,
        "sub_score": None,
        "anchor_source": "not run",
        "status": "not_run",
        "quote_ids": [],
    }


def experimental_budget():
    """Separate from the rubric's 200-call budget. ``PSYCHOSIGHT_EXP_MAX_LLM_CALLS`` overrides the cap."""
    raw = config._env(ENV_EXP_MAX_LLM_CALLS)
    limit = EXP_MAX_LLM_CALLS
    if raw:
        try:
            parsed = int(raw)
        except ValueError:
            parsed = -1
        if parsed >= 0:
            limit = parsed
    return rubric.CallBudget(limit)


def _selected_episodes(episodes, selection) -> list:
    """``selection`` is the dict from ``rubric.select_episodes`` (episode id -> reason) or a list of episodes."""
    if isinstance(selection, dict):
        ids = set(selection)
        return [ep for ep in (episodes or []) if getattr(ep, "id", None) in ids]
    if selection is None:
        return []
    return list(selection)


def _emit(progress, done: int, total: int) -> None:
    if progress is not None:
        progress("experimental", done, total)


def _stats_from(llm) -> ExpLLMStats:
    stats = getattr(llm, "stats", None) if llm is not None else None
    if isinstance(stats, ExpLLMStats):
        return stats
    return ExpLLMStats()


def _lint_string(value: str) -> str:
    # Imported lazily: safety imports this package while it is still loading.
    from ..safety import lint_experimental
    hits = lint_experimental(value)
    if not hits:
        return value
    for rule in hits:
        # Rule id only. The matched text is never logged.
        log.info("experimental lint rule=%s", rule)
    return exp_strings.LINT_FALLBACK


def _scrub(node) -> None:
    if isinstance(node, dict):
        for key, value in list(node.items()):
            if isinstance(value, str):
                node[key] = _lint_string(value)
            elif isinstance(value, (dict, list)):
                _scrub(value)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            if isinstance(value, str):
                node[index] = _lint_string(value)
            elif isinstance(value, (dict, list)):
                _scrub(value)


def apply_wording_lint(section: dict) -> dict:
    """Replace every string that hits ``lint_experimental`` with the fixed fallback."""
    if not isinstance(section, dict):
        raise TypeError("experimental section")
    cleaned = copy.deepcopy(section)
    _scrub(cleaned)
    return cleaned


@lru_cache(maxsize=1)
def _section_validator():
    raw = json.loads(config.SCHEMA_PATH.read_text())
    sub = {"$schema": raw["$schema"], "$defs": raw["$defs"], "$ref": "#/$defs/experimentalScores"}
    return jsonschema.Draft202012Validator(sub, format_checker=jsonschema.FormatChecker())


def _section_is_valid(section: dict) -> bool:
    try:
        return not list(_section_validator().iter_errors(section))
    except Exception as exc:  # noqa: BLE001
        log.warning("experimental section validator failed type=%s", type(exc).__name__)
        return True


def _failed_section(speakers: Sequence[str]) -> dict:
    try:
        return apply_wording_lint(shell_section("failed", exp_strings.REASON_FAILED, speakers))
    except Exception as exc:  # noqa: BLE001
        log.warning("experimental failure section failed type=%s", type(exc).__name__)
        return shell_section("failed", exp_strings.REASON_FAILED, speakers)


def not_run_section_or_shell(reason: str, speakers: Sequence[str] = ("me",)) -> dict:
    """Not-run section. Uses Track C's ``not_run_section`` when that implementation is present."""
    speakers = scored_speakers(speakers)
    section = None
    try:
        section = scoring.not_run_section(reason, speakers)
    except NotImplementedError:
        section = None
    except Exception as exc:  # noqa: BLE001
        log.warning("not_run_section failed type=%s", type(exc).__name__)
        section = None
    if isinstance(section, dict):
        try:
            cleaned = apply_wording_lint(section)
            if _section_is_valid(cleaned):
                return cleaned
            log.warning("not_run_section output invalid")
        except Exception as exc:  # noqa: BLE001
            log.warning("not_run_section lint failed type=%s", type(exc).__name__)
    try:
        return apply_wording_lint(shell_section("not_run", reason, speakers))
    except Exception as exc:  # noqa: BLE001
        log.warning("experimental not_run section failed type=%s", type(exc).__name__)
        return shell_section("not_run", reason, speakers)


def _finalize(section, speakers: Sequence[str]) -> dict:
    if isinstance(section, dict):
        cleaned = apply_wording_lint(section)
        if _section_is_valid(cleaned):
            return cleaned
        log.warning("experimental section invalid")
    return _failed_section(speakers)


def run_experimental(*, episodes, selection, provider, store, llm_ran: bool, speakers, week_order,
                     progress) -> Tuple[dict, ExpLLMStats]:
    """compute_deterministic -> score_llm (when llm_ran) -> build_section.

    Never raises. Progress is ``(stage, done, total)`` with stage ``experimental``. ``done/total``
    are experimental LLM calls. A failure yields status ``failed`` and ``strings.REASON_FAILED``.
    """
    speakers = scored_speakers(speakers)
    stats = ExpLLMStats()
    try:
        _emit(progress, 0, 0)
        det = deterministic.compute_deterministic(episodes, speakers)
        llm = None
        if llm_ran:
            budget = experimental_budget()
            selected = _selected_episodes(episodes, selection)

            def on_llm(done, total, _progress=progress):
                _emit(_progress, done, total)

            llm = llm_exp.score_llm(
                provider, selected, store, speakers=speakers, budget=budget, progress=on_llm, holistic=True)
            stats = _stats_from(llm)
        section = scoring.build_section(
            det, llm, episodes, list(week_order or []), speakers=speakers, llm_ran=bool(llm_ran), seed=EXP_SEED)
        return _finalize(section, speakers), stats
    except Exception as exc:  # noqa: BLE001
        log.warning("experimental stage failed type=%s", type(exc).__name__)
        return _failed_section(speakers), stats
