"""Track C: anchors, weights, caps, index, bootstrap band, gating, confidence, trend, contributions. Contract stub."""

from __future__ import annotations

from typing import TYPE_CHECKING, List, Optional, Sequence

from .contract import EXP_SEED, DeterministicResult, ExpLLMResult

if TYPE_CHECKING:  # pragma: no cover
    from ..models import Episode


def build_section(det: DeterministicResult, llm: Optional[ExpLLMResult], episodes: "List[Episode]",
                  week_order: List[str], *, speakers: Sequence[str], llm_ran: bool, seed: int = EXP_SEED) -> dict:
    """Return a schema-valid ``experimental_scores`` dict."""
    raise NotImplementedError("Track C implements build_section")


def not_run_section(reason: str, speakers: Sequence[str] = ("me",)) -> dict:
    """Same shape as build_section with every scored speaker ``not_run`` and the given reason."""
    raise NotImplementedError("Track C implements not_run_section")
