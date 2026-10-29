"""Track D: run_experimental() orchestrator used by the pipeline. Contract stub."""

from __future__ import annotations

from typing import Tuple

from .contract import ExpLLMStats


def run_experimental(*, episodes, selection, provider, store, llm_ran: bool, speakers, week_order,
                     progress) -> Tuple[dict, ExpLLMStats]:
    """compute_deterministic -> score_llm (when llm_ran) -> build_section. Never raises: any failure gives
    a section with ``status: failed`` and strings.REASON_FAILED."""
    raise NotImplementedError("Track D implements run_experimental")
