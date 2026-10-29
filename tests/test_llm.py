from __future__ import annotations

import json
import logging

import httpx
import pytest

from psychosight import config, loader, rubric, sessionize
from psychosight.errors import LLMOptInRequired, LLMUnavailable
from psychosight.llm import DeepSeekProvider, get_provider, parse_json_object, require_opt_in
from psychosight.mock_provider import MockProvider
from psychosight.storage import Store


def settings(**kw):
    base = dict(api_key="sk-test-SECRET-KEY", model="model-under-test", base_url="https://api.deepseek.test",
                reasoning_effort="max", thinking="enabled", json_mode=True, send_temperature=True,
                timeout_s=5.0, max_tokens=None)
    base.update(kw)
    return config.LLMSettings(**base)


def ok_response(content, reasoning="secret reasoning"):
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": content,
                                                              "reasoning_content": reasoning}}],
                                     "usage": {"prompt_tokens": 10, "completion_tokens": 5}})


def test_opt_in_guard():
    with pytest.raises(LLMOptInRequired):
        require_opt_in(False)
    with pytest.raises(LLMOptInRequired):
        get_provider(is_demo=True, llm_opt_in=False)
    assert isinstance(get_provider(is_demo=True, llm_opt_in=True), MockProvider)


def test_real_provider_requires_key_and_model():
    with pytest.raises(LLMUnavailable, match="DEEPSEEK_API_KEY"):
        get_provider(is_demo=False, llm_opt_in=True)
    with pytest.raises(LLMUnavailable, match="DEEPSEEK_MODEL"):
        DeepSeekProvider(settings(model=None))


def test_defaults_dotenv_and_env_override(tmp_path, monkeypatch):
    s = config.llm_settings()
    assert s.api_key is None and s.key_source is None and not s.configured
    assert s.model == "deepseek-flash" and s.reasoning_effort == "max" and s.thinking == "enabled"
    assert s.base_url == "https://api.deepseek.com"
    env_file = tmp_path / ".env"
    env_file.write_text("# comment\nexport DEEPSEEK_API_KEY='sk-dotenv-FAKE-KEY-7q7q'\n"
                        "DEEPSEEK_MODEL=deepseek-v4-pro  # inline comment\nBROKEN LINE\n", encoding="utf-8")
    monkeypatch.setenv("PSYCHOSIGHT_DOTENV", str(env_file))
    s = config.llm_settings()
    assert s.api_key == "sk-dotenv-FAKE-KEY-7q7q" and s.key_source == "dotenv" and s.configured
    assert s.model == "deepseek-v4-pro"
    assert "FAKE-KEY" not in repr(s) and "7q7q" in repr(s)  # masked: prefix + last 4 only
    assert isinstance(get_provider(is_demo=False, llm_opt_in=True), DeepSeekProvider)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-env-OVERRIDE-1234")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-flash")
    s = config.llm_settings()
    assert s.api_key == "sk-env-OVERRIDE-1234" and s.key_source == "env" and s.model == "deepseek-flash"


def test_dotenv_first_file_wins_and_missing_files_ignored(tmp_path, monkeypatch):
    import os
    a, b = tmp_path / "a.env", tmp_path / "b.env"
    a.write_text("DEEPSEEK_API_KEY=sk-from-a-FAKE-0001\n", encoding="utf-8")
    b.write_text('DEEPSEEK_API_KEY="sk-from-b-FAKE-0002"\nDEEPSEEK_MODEL=deepseek-v4-pro\n', encoding="utf-8")
    monkeypatch.setenv("PSYCHOSIGHT_DOTENV", os.pathsep.join([str(tmp_path / "missing.env"), str(a), str(b)]))
    s = config.llm_settings()
    assert s.api_key == "sk-from-a-FAKE-0001" and s.model == "deepseek-v4-pro"


def test_missing_key_message_is_actionable(tmp_path, monkeypatch):
    example = (config.REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    env_file = tmp_path / ".env"
    env_file.write_text(example, encoding="utf-8")  # copied but not filled in
    monkeypatch.setenv("PSYCHOSIGHT_DOTENV", str(env_file))
    assert config.llm_settings().api_key is None and config.llm_settings().model == "deepseek-flash"
    with pytest.raises(LLMUnavailable) as exc:
        get_provider(is_demo=False, llm_opt_in=True)
    assert "Copy .env.example to .env" in exc.value.message and "DEEPSEEK_API_KEY" in exc.value.message


def test_mask_key():
    assert config.mask_key(None) == "unset"
    assert config.mask_key("sk-abcdefghijklmnop1234") == "sk-…1234"
    assert config.mask_key("short") == "…"


def test_rejected_key_message_names_source():
    p = DeepSeekProvider(settings(key_source="dotenv"),
                         transport=httpx.MockTransport(lambda r: httpx.Response(401, json={})))
    with pytest.raises(LLMUnavailable, match=r"\.env file"):
        p.complete("s", "u")


def test_request_body_and_reasoning_discarded():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        seen["auth"] = request.headers["authorization"]
        return ok_response('{"ok": true}')

    p = DeepSeekProvider(settings(), transport=httpx.MockTransport(handler))
    res = p.complete("sys", "user")
    assert res.content == '{"ok": true}'
    assert "secret reasoning" not in repr(res.__dict__)
    body = seen["body"]
    assert body["model"] == "model-under-test" and body["temperature"] == 0
    assert body["reasoning_effort"] == "max" and body["thinking"] == {"type": "enabled"}
    assert body["response_format"] == {"type": "json_object"}
    assert seen["auth"] == "Bearer sk-test-SECRET-KEY"
    assert "SECRET" not in repr(p.settings)


def test_model_rejected_lists_models():
    def handler(request):
        if request.url.path == "/models":
            return httpx.Response(200, json={"data": [{"id": "deepseek-v4-flash"}, {"id": "deepseek-v4-pro"}]})
        return httpx.Response(400, json={"error": {"message": "Model Not Exist: model-under-test"}})

    p = DeepSeekProvider(settings(), transport=httpx.MockTransport(handler))
    with pytest.raises(LLMUnavailable) as exc:
        p.complete("s", "u")
    msg = exc.value.message
    assert "model-under-test" in msg and "deepseek-v4-flash, deepseek-v4-pro" in msg and "DEEPSEEK_MODEL" in msg


def test_retry_on_429_then_success_and_auth_error():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(429) if calls["n"] < 3 else ok_response("{}")

    p = DeepSeekProvider(settings(), transport=httpx.MockTransport(handler), sleep=lambda s: None)
    assert p.complete("s", "u").content == "{}" and calls["n"] == 3

    p2 = DeepSeekProvider(settings(), transport=httpx.MockTransport(lambda r: httpx.Response(401)),
                          sleep=lambda s: None)
    with pytest.raises(LLMUnavailable, match="API key"):
        p2.complete("s", "u")


def test_key_never_logged(caplog):
    caplog.set_level(logging.DEBUG)
    p = DeepSeekProvider(settings(), transport=httpx.MockTransport(lambda r: httpx.Response(503)),
                         sleep=lambda s: None)
    with pytest.raises(LLMUnavailable):
        p.complete("s", "u")
    assert "sk-test-SECRET-KEY" not in caplog.text


def test_parse_json_object():
    assert parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_object('noise {"a": 2} trailing') == {"a": 2}
    assert parse_json_object("[1, 2]") is None and parse_json_object("nope") is None


def _episodes():
    eps = sessionize.sessionize(loader.load_demo().msgs)
    sel = rubric.select_episodes(eps)
    return [e for e in eps if e.id in sel]


def test_cache_hit_avoids_provider_call(tmp_path):
    store = Store(tmp_path / "c.db")
    eps = _episodes()[:3]
    p = MockProvider()
    rubric.score_episodes(p, eps, store, True)
    assert p.calls == 6
    again = MockProvider()
    res = rubric.score_episodes(again, eps, store, True)
    assert again.calls == 0 and res.stats.cache_hits == 6


def test_cache_has_no_message_bodies(tmp_path):
    store = Store(tmp_path / "c.db")
    eps = _episodes()[:5]
    rubric.score_episodes(MockProvider(), eps, store, True)
    rows = store._conn.execute("SELECT json FROM llm_scores").fetchall()
    dump = " ".join(r[0] for r in rows)
    for ep in eps:
        for m in ep.msgs:
            if len(m.text) > 12:
                assert m.text not in dump
    assert "quote_ref" in dump


def test_selection_cap_mix_and_determinism():
    eps = sessionize.sessionize(loader.load_demo().msgs)
    a, b = rubric.select_episodes(eps), rubric.select_episodes(eps)
    assert a == b and len(a) == config.MAX_EPISODES_SCORED
    assert set(a.values()) == {"top_signal", "random"}
    assert sum(1 for v in a.values() if v == "top_signal") == 24
