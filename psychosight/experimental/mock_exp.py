"""Track B: deterministic offline outputs for the experimental prompts. Contract stub.

``MockProvider.complete()`` routes system prompts starting with ``TASK: EXPERIMENTAL`` or ``TASK: HOLISTIC``
here and returns this function's ``LLMResult`` unchanged.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from ..llm import LLMResult


def complete(system: str, user: str, run_idx: int = 0) -> "LLMResult":
    raise NotImplementedError("Track B implements mock_exp.complete")
