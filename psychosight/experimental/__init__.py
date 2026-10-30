"""Experimental scores (schema 1.1.0): optional, opt-in, not validated. See docs/EXPERIMENTAL_CONTRACT.md.

Removable as a unit; the main report never depends on it. ``wwbp/`` (Track A) is removable on its own.
"""

from __future__ import annotations

from .contract import (  # noqa: F401
    DIMENSIONS, DIMENSION_KEYS, EXP_SCORING_VERSION, MARKERS, DeterministicResult, ExpLLMResult, ExpLLMStats,
    ExpQuote, MarkerObservation,
)
from .deterministic import compute_deterministic  # noqa: F401
from .llm_exp import score_llm  # noqa: F401
from .scoring import build_section, not_run_section  # noqa: F401
from .section import run_experimental  # noqa: F401
