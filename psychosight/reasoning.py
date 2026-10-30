"""Reasoning (thinking) levels for DeepSeek: the single source of truth.

Evidence (checked 2026-10-29):
- api-docs.deepseek.com/guides/thinking_mode: thinking is toggled with ``thinking: {type: enabled|disabled}``;
  effort is ``reasoning_effort: low|high|max``. Requested efforts map as minimal->low, low->low, medium->high,
  high->high, xhigh->high, max->max, ultra->max. Provider default: thinking on at ``high``.
- GET /models for ``deepseek-flash``: ``effort.supported_levels = [low, high, max]``, ``default_level = high``.
- Live: ``reasoning_effort: none`` with thinking enabled still returned reasoning tokens, so "off" must be sent
  as ``thinking: {type: disabled}``. ``response_format: json_object`` works with thinking disabled.

So the distinct levels are none (thinking off), low, high and max. ``medium`` / ``xhigh`` are not exposed
because the provider runs them as ``high``.
"""

from __future__ import annotations

from typing import Dict, List, Optional

REASONING_LEVELS: tuple = (
    {"id": "none", "label": "Off (fastest)",
     "description": "Thinking turned off: quickest and cheapest, but the least careful scoring."},
    {"id": "low", "label": "Low (default)",
     "description": "A short thinking pass (DeepSeek effort 'low'): a good balance of speed and care."},
    {"id": "high", "label": "High",
     "description": "DeepSeek's standard thinking depth (its own default; 'medium' and 'xhigh' also run as high)."},
    {"id": "max", "label": "Max (slowest)",
     "description": "Deepest thinking (DeepSeek effort 'max'): slowest and most tokens; the demo took ~8 minutes."},
)
REASONING_IDS: tuple = tuple(level["id"] for level in REASONING_LEVELS)
DEFAULT_REASONING = "low"


from .errors import InvalidReasoningLevel as InvalidReasoningLevelValue  # noqa: E402  (code INVALID_REASONING_LEVEL)


def invalid_message(value) -> str:
    return (f"reasoning_level {value!r} is not supported. Valid values: {', '.join(REASONING_IDS)} "
            f"(default {DEFAULT_REASONING}).")


def validate(value) -> str:
    """Return the canonical id (case/whitespace-insensitive) or raise InvalidReasoningLevelValue."""
    if isinstance(value, str):
        v = value.strip().lower()
        if v in REASONING_IDS:
            return v
    raise InvalidReasoningLevelValue(invalid_message(value))


def levels_for_config() -> List[Dict[str, str]]:
    return [dict(level) for level in REASONING_LEVELS]


def request_params(level: Optional[str]) -> dict:
    """DeepSeek Chat Completions fields for a level. ``none`` disables thinking and sends no effort."""
    if level is None:
        return {}
    level = validate(level)
    if level == "none":
        return {"thinking": {"type": "disabled"}}
    return {"thinking": {"type": "enabled"}, "reasoning_effort": level}


def cache_tag(model: str, level: Optional[str]) -> str:
    """Model id used in LLM cache keys: results at different reasoning levels never mix.

    Rows written before reasoning levels existed were keyed by the bare model id and are not reused."""
    return f"{model}|reasoning={level or 'unset'}"


def cache_model_for(provider) -> str:
    """Cache-key model id for any provider object (works for duck-typed test providers too)."""
    return cache_tag(str(getattr(provider, "model", "") or ""), getattr(provider, "reasoning_level", None))
