"""Track A: deterministic language markers (word lists, VADER valence, WWBP sums). Contract stub."""

from __future__ import annotations

from typing import TYPE_CHECKING, List, Sequence

from .contract import DeterministicResult

if TYPE_CHECKING:  # pragma: no cover
    from ..models import Episode


def compute_deterministic(episodes: "List[Episode]", speakers: Sequence[str]) -> DeterministicResult:
    """One MarkerObservation per D marker x speaker x episode; every D marker in MARKERS is produced or
    listed in ``unavailable``."""
    raise NotImplementedError("Track A implements compute_deterministic")
