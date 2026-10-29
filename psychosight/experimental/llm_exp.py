"""Track B: traits-exp-v1 episode prompt and exp-holistic-v1 prompt, validation, stability, cache. Contract stub."""

from __future__ import annotations

from typing import TYPE_CHECKING, Callable, List, Optional, Sequence

from .contract import ExpLLMResult

if TYPE_CHECKING:  # pragma: no cover
    from ..llm import Provider
    from ..models import Episode
    from ..rubric import CallBudget
    from ..storage import Store


def score_llm(provider: "Provider", selected: "List[Episode]", store: "Store", *, speakers: Sequence[str],
              budget: "CallBudget", progress: Optional[Callable[[int, int], None]] = None,
              holistic: bool = True) -> ExpLLMResult:
    raise NotImplementedError("Track B implements score_llm")
