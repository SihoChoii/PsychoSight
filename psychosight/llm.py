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
import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional

import httpx

from . import config
from .errors import LLMOptInRequired, LLMUnavailable

log = logging.getLogger("psychosight.llm")


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

    def list_models(self) -> List[str]:
        try:
            resp = self._client.get("/models")
            resp.raise_for_status()
            return sorted(m.get("id", "") for m in resp.json().get("data", []) if m.get("id"))
        except Exception as exc:  # noqa: BLE001
            log.warning("could not list provider models: %s", type(exc).__name__)
            return []

    def _is_model_error(self, resp: httpx.Response) -> bool:
        text = resp.text.lower()
        return (self.model.lower() in text or "model name" in text or "model not" in text
                or "unknown model" in text or "invalid model" in text or "supported api model" in text)

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
                data = resp.json()
                message = (data.get("choices") or [{}])[0].get("message") or {}
                message.pop("reasoning_content", None)  # discard reasoning trace immediately
                content = message.get("content") or ""
                usage = {k: v for k, v in (data.get("usage") or {}).items() if isinstance(v, (int, float))}
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


def _provider_error(resp: httpx.Response) -> str:
    """Short provider error message (never logged; returned to the caller only)."""
    try:
        err = resp.json().get("error") or {}
        msg = err.get("message") if isinstance(err, dict) else str(err)
    except ValueError:
        msg = ""
    return (msg or "no details")[:300]


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
