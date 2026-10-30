"""Per-analysis reasoning level: levels, default, env override, request mapping, API/CLI validation,
run_meta, and level-tagged cache keys."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from psychosight import config, loader, pipeline, reasoning, rubric, sessionize
from psychosight.app import create_app
from psychosight.errors import InvalidReasoningLevel
from psychosight.experimental.llm_exp import score_llm
from psychosight.llm import DeepSeekProvider, get_provider
from psychosight.mock_provider import MockProvider
from psychosight.storage import Store
from tests.test_api import wait_done
from tests.test_exp_llm import make_ep
from tests.test_llm import ok_response, settings
from tests.test_pipeline_report import check


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(store=Store(tmp_path / "api.db"), use_default_static=False))


# ---- levels and default -------------------------------------------------------------------------

def test_levels_are_the_distinct_provider_levels_and_default_is_low():
    assert reasoning.REASONING_IDS == ("none", "low", "high", "max")
    assert reasoning.DEFAULT_REASONING == "low" and config.default_reasoning_level() == "low"
    for level in reasoning.levels_for_config():
        assert set(level) == {"id", "label", "description"} and level["label"] and level["description"]
    assert config.llm_settings().reasoning_effort == "low" and config.llm_settings().thinking == "enabled"


@pytest.mark.parametrize("value", ["medium", "xhigh", "ultra", "minimal", "turbo", "", 3, None])
def test_validate_rejects_non_distinct_or_unknown(value):
    with pytest.raises(InvalidReasoningLevel) as exc:
        reasoning.validate(value)
    assert exc.value.code == "INVALID_REASONING_LEVEL"
    assert "none, low, high, max" in exc.value.message


def test_validate_is_case_insensitive():
    assert reasoning.validate(" MAX ") == "max"


@pytest.mark.parametrize("env,expected", [("max", "max"), ("none", "none"), ("HIGH", "high"),
                                          ("medium", "low"), ("bogus", "low")])
def test_env_override_sets_default(monkeypatch, env, expected):
    monkeypatch.setenv("DEEPSEEK_REASONING_EFFORT", env)
    assert config.default_reasoning_level() == expected
    s = config.llm_settings()
    assert s.reasoning_effort == expected and s.thinking == ("disabled" if expected == "none" else "enabled")


def test_legacy_thinking_disabled_env_means_none(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_THINKING", "disabled")
    assert config.default_reasoning_level() == "none"


# ---- request payload mapping ------------------------------------------------------------------------

def _body_for(level=None, **settings_kw):
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return ok_response('{"ok": true}')

    p = DeepSeekProvider(settings(**settings_kw), transport=httpx.MockTransport(handler), reasoning_level=level)
    p.complete("sys", "user")
    return p, seen["body"]


@pytest.mark.parametrize("level", ["low", "high", "max"])
def test_payload_thinking_levels(level):
    p, body = _body_for(level)
    assert body["thinking"] == {"type": "enabled"} and body["reasoning_effort"] == level
    assert body["response_format"] == {"type": "json_object"}
    assert p.reasoning_level == level and p.reasoning_effort == level


def test_payload_none_disables_thinking_and_sends_no_effort():
    p, body = _body_for("none")
    assert body["thinking"] == {"type": "disabled"} and "reasoning_effort" not in body
    assert body["response_format"] == {"type": "json_object"} and body["temperature"] == 0
    assert p.reasoning_level == "none" and p.reasoning_effort is None


def test_payload_level_overrides_settings_and_legacy_disabled():
    _p, body = _body_for("high", reasoning_effort="max")
    assert body["reasoning_effort"] == "high"
    p, body = _body_for(None, thinking="disabled", reasoning_effort="max")
    assert p.reasoning_level == "none" and body["thinking"] == {"type": "disabled"} and "reasoning_effort" not in body


def test_invalid_level_on_provider_raises():
    with pytest.raises(InvalidReasoningLevel):
        DeepSeekProvider(settings(), reasoning_level="medium")


def test_get_provider_passes_level_and_mock_records_it():
    mock = get_provider(is_demo=True, llm_opt_in=True, reasoning_level="max")
    assert isinstance(mock, MockProvider) and mock.reasoning_level == "max" and mock.reasoning_effort is None
    assert get_provider(is_demo=True, llm_opt_in=True).reasoning_level == "low"


# ---- GET /config and POST /analyses ---------------------------------------------------------------

def test_config_lists_levels_and_default(client, monkeypatch):
    cfg = client.get("/config").json()
    assert [lvl["id"] for lvl in cfg["reasoning_levels"]] == ["none", "low", "high", "max"]
    assert cfg["default_reasoning"] == "low" and cfg["reasoning_effort"] == "low"
    monkeypatch.setenv("DEEPSEEK_REASONING_EFFORT", "max")
    assert client.get("/config").json()["default_reasoning"] == "max"


@pytest.mark.parametrize("bad", ["medium", "MAXX", ""])
def test_post_invalid_level_is_422(client, bad):
    r = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": True, "reasoning_level": bad})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "INVALID_REASONING_LEVEL" and "none, low, high, max" in err["message"]


def test_post_wrong_type_level_is_invalid_request(client):
    r = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": True, "reasoning_level": 2})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_REQUEST"


def _run(client, **extra):
    job_id = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": True, **extra}).json()["job_id"]
    st, _ = wait_done(client, job_id, timeout=60)
    assert st["status"] == "done", st
    rep = client.get(f"/analyses/{job_id}/report").json()
    check(rep)
    return rep


def test_post_level_recorded_in_run_meta_and_default_low(client):
    rep = _run(client, reasoning_level="none", experimental_scores=False)
    assert rep["run_meta"]["reasoning_level"] == "none" and rep["run_meta"]["provider"] == "mock"
    rep = _run(client, experimental_scores=False)
    assert rep["run_meta"]["reasoning_level"] == "low"


def test_deterministic_only_records_no_level(client):
    job_id = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": False,
                                            "reasoning_level": "max"}).json()["job_id"]
    wait_done(client, job_id)
    rep = client.get(f"/analyses/{job_id}/report").json()
    check(rep)
    assert rep["run_meta"]["reasoning_level"] is None


def test_mock_provider_ignores_level(tmp_path):
    a = pipeline.run_analysis("demo", llm_opt_in=True, save=False, store=Store(tmp_path / "a.db"),
                              reasoning_level="none")
    b = pipeline.run_analysis("demo", llm_opt_in=True, save=False, store=Store(tmp_path / "b.db"),
                              reasoning_level="max")
    assert a["run_meta"]["reasoning_level"] == "none" and b["run_meta"]["reasoning_level"] == "max"
    for section in ("rubric", "observations", "experimental_scores"):
        assert json.dumps(a[section], sort_keys=True) == json.dumps(b[section], sort_keys=True)


def test_pipeline_rejects_invalid_level_before_work(tmp_path):
    with pytest.raises(InvalidReasoningLevel):
        pipeline.run_analysis("demo", llm_opt_in=True, save=False, store=Store(tmp_path / "x.db"),
                              reasoning_level="xhigh")


# ---- cache keys -----------------------------------------------------------------------------------

def test_cache_tag_differs_by_level():
    tags = {reasoning.cache_tag("deepseek-flash", lvl) for lvl in reasoning.REASONING_IDS}
    assert len(tags) == 4 and "deepseek-flash" not in tags  # old untagged rows are never reused
    assert MockProvider(reasoning_level="low").cache_model == reasoning.cache_tag("mock-rubric-1", "low")


def _demo_episode():
    eps = sessionize.sessionize(loader.load_demo().msgs)
    sel = rubric.select_episodes(eps)
    return next(e for e in eps if e.id in sel)


def test_rubric_cache_hits_same_level_and_misses_other_level(tmp_path):
    ep = _demo_episode()
    store = Store(tmp_path / "c.db")
    low = MockProvider(reasoning_level="low")
    assert rubric.score_one(low, ep, 0, store, rubric.ScoringStats(), rubric.CallBudget(4)) is not None
    assert low.calls >= 1
    low.calls = 0
    rubric.score_one(low, ep, 0, store, rubric.ScoringStats(), rubric.CallBudget(4))
    assert low.calls == 0  # same level: cache hit
    high = MockProvider(reasoning_level="high")
    rubric.score_one(high, ep, 0, store, rubric.ScoringStats(), rubric.CallBudget(4))
    assert high.calls >= 1  # other level: miss
    keys = {row[0] for row in store._conn.execute(
        "SELECT model FROM llm_scores WHERE prompt_version=?", (config.PROMPT_VERSION,))}
    assert keys == {reasoning.cache_tag("mock-rubric-1", "low"), reasoning.cache_tag("mock-rubric-1", "high")}


def test_old_untagged_rubric_rows_are_not_reused(tmp_path):
    ep = _demo_episode()
    store = Store(tmp_path / "old.db")
    seed = MockProvider(reasoning_level="low")
    rubric.score_one(seed, ep, 0, store, rubric.ScoringStats(), rubric.CallBudget(4))
    row = store.get_score(ep.hash, config.PROMPT_VERSION, seed.cache_model, 0)
    other = Store(tmp_path / "legacy.db")
    other.put_score(ep.hash, config.PROMPT_VERSION, "mock-rubric-1", 0, row)  # pre-reasoning-level key
    fresh = MockProvider(reasoning_level="low")
    rubric.score_one(fresh, ep, 0, other, rubric.ScoringStats(), rubric.CallBudget(4))
    assert fresh.calls >= 1


def test_experimental_episode_and_holistic_cache_split_by_level(tmp_path):
    episode = make_ep([("me", "I hear you, today was a lot and I am sorry"), ("other", "rough day honestly"),
                       ("me", "want to talk about it tonight?"), ("other", "yes, after dinner")])
    store = Store(tmp_path / "e.db")
    first = score_llm(MockProvider(reasoning_level="low"), [episode], store, speakers=("me", "other"),
                      budget=rubric.CallBudget(50), holistic=True)
    assert first.stats.llm_calls > 0
    same = score_llm(MockProvider(reasoning_level="low"), [episode], store, speakers=("me", "other"),
                     budget=rubric.CallBudget(50), holistic=True)
    assert same.stats.llm_calls == 0 and same.stats.cache_hits > 0
    other = score_llm(MockProvider(reasoning_level="max"), [episode], store, speakers=("me", "other"),
                      budget=rubric.CallBudget(50), holistic=True)
    assert other.stats.llm_calls == first.stats.llm_calls
    models = {row[0] for row in store._conn.execute("SELECT DISTINCT model FROM llm_scores")}
    assert models == {reasoning.cache_tag("mock-rubric-1", "low"), reasoning.cache_tag("mock-rubric-1", "max")}


# ---- CLI ----------------------------------------------------------------------------------------

def test_cli_invalid_level_exits_2(capsys):
    from psychosight.cli import main
    assert main(["analyze", "--demo", "--opt-in-llm", "--no-save", "--reasoning-level", "medium"]) == 2
    err = capsys.readouterr().err
    assert "INVALID_REASONING_LEVEL" in err and "none, low, high, max" in err
    assert main(["--demo", "--reasoning-level", "bogus"]) == 2


def test_cli_level_and_env_default(tmp_path, monkeypatch):
    from psychosight.cli import main
    out = tmp_path / "r.json"
    assert main(["analyze", "--demo", "--opt-in-llm", "--no-save", "--no-experimental-scores",
                 "--reasoning-level", "none", "-o", str(out)]) == 0
    assert json.loads(out.read_text())["run_meta"]["reasoning_level"] == "none"
    monkeypatch.setenv("DEEPSEEK_REASONING_EFFORT", "high")
    assert main(["analyze", "--demo", "--opt-in-llm", "--no-save", "--no-experimental-scores", "-o", str(out)]) == 0
    assert json.loads(out.read_text())["run_meta"]["reasoning_level"] == "high"
