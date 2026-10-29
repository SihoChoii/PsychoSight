"""Thin LLM provider layer: DeepSeek (OpenAI-compatible) and an offline MockProvider.

Privacy rules enforced here:
- The API key is read from the environment only and never logged or written.
- Reasoning traces (`reasoning_content`) can quote messages: they are discarded on receipt and never
  logged, returned or persisted.
- Request and response bodies are never logged; only status codes, counts and timings.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional

import httpx

from . import config
from .errors import LLMOptInRequired, LLMUnavailable

log = logging.getLogger("psychosight.llm")

_MODEL_ERROR_PHRASES = (
    "model not", "unknown model", "invalid model", "model name", "supported api model",
    "does not exist", "model_not_found", "no such model",
)
_LOG_GUARD = False


class _RedactSecrets(logging.Filter):
    """Drop the API key from any psychosight log line that managed to include it."""

    def filter(self, record: logging.LogRecord) -> bool:
        key = os.environ.get("DEEPSEEK_API_KEY") or ""
        if not key:
            return True
        try:
            msg = record.getMessage()
        except Exception:  # noqa: BLE001
            return True
        if key in msg:
            record.msg = msg.replace(key, "[redacted]")
            record.args = ()
        return True


def install_log_guard() -> None:
    """Keep request libraries quiet and strip the API key from log handlers.

    Filters on a logger are not applied to records that propagate from a child,
    so the redaction filter is attached to handlers, which do see those records.
    """
    global _LOG_GUARD
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    redact = _RedactSecrets()
    root = logging.getLogger()
    for handler in list(root.handlers) + list(logging.getLogger("psychosight").handlers):
        if not any(isinstance(f, _RedactSecrets) for f in handler.filters):
            handler.addFilter(redact)
    if not _LOG_GUARD:
        # Also filter records emitted directly on the package logger.
        logging.getLogger("psychosight").addFilter(_RedactSecrets())
        _LOG_GUARD = True


install_log_guard()


def require_opt_in(flag: bool) -> None:
    """Guard called by every LLM entry point."""
    if flag is not True:
        raise LLMOptInRequired("LLM analysis needs explicit opt-in (llm_opt_in=true).")


@dataclass
class LLMResult:
    content: str
    usage: dict = field(default_factory=dict)


class Provider:
    name = "base"
    model: str = ""
    reasoning_effort: Optional[str] = None

    def complete(self, system: str, user: str, *, run_idx: int = 0) -> LLMResult:  # pragma: no cover
        raise NotImplementedError

    def check(self) -> None:
        """Optional preflight."""


RETRY_STATUS = {429, 500, 502, 503, 504}


class DeepSeekProvider(Provider):
    name = "deepseek"

    def __init__(self, settings: Optional[config.LLMSettings] = None,
                 transport: Optional[httpx.BaseTransport] = None,
                 sleep: Callable[[float], None] = time.sleep, max_attempts: int = 4):
        self.settings = settings or config.llm_settings()
        if not self.settings.api_key:
            raise LLMUnavailable("DEEPSEEK_API_KEY is not set. Export it in the shell that runs the backend.")
        if not self.settings.model:
            raise LLMUnavailable("DEEPSEEK_MODEL is not set. Export the exact DeepSeek model id "
                                 "(see GET https://api.deepseek.com/models).")
        self.model = self.settings.model
        self.reasoning_effort = self.settings.reasoning_effort
        self._sleep = sleep
        self._max_attempts = max_attempts
        self._client = httpx.Client(
            base_url=self.settings.base_url, transport=transport, timeout=self.settings.timeout_s,
            headers={"Authorization": f"Bearer {self.settings.api_key}", "Content-Type": "application/json"},
        )

    def close(self) -> None:
        self._client.close()

    def list_models(self) -> List[str]:
        try:
            resp = self._client.get("/models")
            resp.raise_for_status()
            return sorted(m.get("id", "") for m in resp.json().get("data", []) if m.get("id"))
        except Exception as exc:  # noqa: BLE001
            log.warning("could not list provider models: %s", type(exc).__name__)
            return []

    def _is_model_error(self, resp: httpx.Response) -> bool:
        """True only when the provider message is about the model id.

        Matching the model string alone is not enough: a 400 about temperature can echo the
        model field, and the body can also echo the prompt.
        """
        low = _error_message(resp).lower()
        return any(phrase in low for phrase in _MODEL_ERROR_PHRASES)

    def _model_rejected(self, status: int) -> LLMUnavailable:
        models = self.list_models()
        listed = ", ".join(models) if models else "(could not fetch the model list)"
        return LLMUnavailable(
            f"DeepSeek rejected the model '{self.model}' (HTTP {status}). Models available to this key: {listed}. "
            "Set DEEPSEEK_MODEL to one of them.")

    def _body(self, system: str, user: str) -> dict:
        s = self.settings
        body: dict = {"model": self.model, "messages": [{"role": "system", "content": system},
                                                       {"role": "user", "content": user}], "stream": False}
        if s.send_temperature:
            body["temperature"] = 0
        if s.json_mode:
            body["response_format"] = {"type": "json_object"}
        if s.thinking:
            body["thinking"] = {"type": s.thinking}
        if s.reasoning_effort:
            body["reasoning_effort"] = s.reasoning_effort
        if s.max_tokens:
            body["max_tokens"] = s.max_tokens
        return body

    def complete(self, system: str, user: str, *, run_idx: int = 0) -> LLMResult:
        body = self._body(system, user)
        last = "no attempt"
        for attempt in range(self._max_attempts):
            try:
                resp = self._client.post("/chat/completions", json=body)
            except httpx.HTTPError as exc:
                last = type(exc).__name__
                log.warning("deepseek request failed attempt=%d error=%s", attempt + 1, last)
                self._sleep(min(2 ** attempt, 20))
                continue
            status = resp.status_code
            if status == 200:
                try:
                    data = resp.json()
                except ValueError:
                    last = "invalid JSON"
                    log.warning("deepseek invalid json attempt=%d", attempt + 1)
                    self._sleep(min(2 ** attempt, 20))
                    continue
                message = (data.get("choices") or [{}])[0].get("message") or {}
                if not isinstance(message, dict):
                    message = {}
                content = _message_text(message)
                usage = {k: v for k, v in (data.get("usage") or {}).items()
                         if isinstance(v, (int, float)) and not isinstance(v, bool)}
                log.info("deepseek ok attempt=%d chars=%d", attempt + 1, len(content))
                return LLMResult(content=content, usage=usage)
            if status in (400, 404, 422) and self._is_model_error(resp):
                raise self._model_rejected(status)
            if status in (401, 403):
                raise LLMUnavailable(f"DeepSeek rejected the API key (HTTP {status}). Check DEEPSEEK_API_KEY.")
            if status == 402:
                raise LLMUnavailable("DeepSeek reports insufficient balance (HTTP 402).")
            if status in RETRY_STATUS:
                last = f"HTTP {status}"
                log.warning("deepseek retryable status=%d attempt=%d", status, attempt + 1)
                self._sleep(min(2 ** attempt, 20))
                continue
            raise LLMUnavailable(f"DeepSeek request failed (HTTP {status}): {_provider_error(resp)}. "
                                 "Request options can be changed with DEEPSEEK_JSON_MODE, "
                                 "DEEPSEEK_SEND_TEMPERATURE, DEEPSEEK_THINKING and DEEPSEEK_REASONING_EFFORT.")
        raise LLMUnavailable(f"DeepSeek unavailable after {self._max_attempts} attempts ({last}).")


def _error_message(resp: httpx.Response) -> str:
    """Provider error string used only for local classification. Never log or return it."""
    try:
        err = resp.json().get("error") or {}
        msg = err.get("message") if isinstance(err, dict) else ""
    except ValueError:
        return ""
    return msg if isinstance(msg, str) else ""


def _provider_error(resp: httpx.Response) -> str:
    """Safe hint. The raw provider body is not returned: it can echo the prompt."""
    low = _error_message(resp).lower()
    hints = []
    if "response_format" in low:
        hints.append("response_format")
    if "temperature" in low:
        hints.append("temperature")
    if hints:
        return "provider rejected request options (" + ", ".join(hints) + ")"
    return "no details"


def _message_text(message: dict) -> str:
    """Assistant text only. Reasoning traces are discarded and never returned."""
    message.pop("reasoning_content", None)
    message.pop("reasoning", None)
    return _coerce_content(message.get("content"))


def _coerce_content(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and part.get("type") not in ("reasoning", "thinking"):
                text = part.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return ""


def get_provider(is_demo: bool, llm_opt_in: bool) -> Provider:
    require_opt_in(llm_opt_in)
    if is_demo and config.demo_provider_name() != "deepseek":
        from .mock_provider import MockProvider
        return MockProvider()
    return DeepSeekProvider()


def parse_json_object(text: str) -> Optional[dict]:
    """Parse a JSON object, tolerating a ```json fence. Returns None when invalid."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.lower().startswith("json"):
            t = t[4:]
    try:
        value = json.loads(t)
    except (ValueError, TypeError):
        start, end = t.find("{"), t.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            value = json.loads(t[start:end + 1])
        except ValueError:
            return None
    return value if isinstance(value, dict) else None
