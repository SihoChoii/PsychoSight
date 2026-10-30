"""Track D: experimental orchestration, API consent, CLI flags, report section, delete."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from psychosight import config, pipeline, report, rubric
from psychosight.errors import ExperimentalConsentRequired
from psychosight.experimental import scoring
from psychosight.experimental import strings as T
from psychosight.experimental.contract import (
    DIMENSION_KEYS, EXP_MAX_LLM_CALLS, EXP_PROMPT_VERSION, EXP_SCORING_VERSION,
)
from psychosight.experimental.section import run_experimental, shell_section
from psychosight.mock_provider import MockProvider
from psychosight.storage import Store
from tests.exp_helpers import FakeTracks, make_episode
from tests.helpers import make_chat_db
from tests.test_api import wait_done
from tests.test_pipeline_report import check


def _stages(callback_stages):
    return [s for i, s in enumerate(callback_stages) if i == 0 or callback_stages[i - 1] != s]


def _tiny_db(tmp_path):
    t0 = datetime(2025, 10, 1, 15, 0, tzinfo=timezone.utc)
    me = " ".join(["word"] * 20)
    messages = [
        (t0, True, None, me),
        (t0 + timedelta(minutes=1), False, "+1555", "sure thing"),
        (t0 + timedelta(minutes=2), True, None, "thanks for writing back today"),
    ]
    return make_chat_db(tmp_path / "chat.db", [(["+1555"], messages)])


def test_shell_sections_validate():
    from psychosight.experimental.section import _section_is_valid
    assert _section_is_valid(shell_section("not_run", T.REASON_NOT_REQUESTED, ("me",)))
    assert _section_is_valid(shell_section("failed", T.REASON_FAILED, ("me", "other")))
    me_only = shell_section("not_run", T.REASON_DISABLED, ("me",))
    assert me_only["speakers_scored"] == ["me"]
    assert all(d["per_speaker"]["other"] is None for d in me_only["dimensions"])
    assert [d["key"] for d in me_only["dimensions"]] == list(DIMENSION_KEYS)


def test_resolve_experimental_defaults():
    assert pipeline.resolve_experimental(True, None, None) == (True, True)
    assert pipeline.resolve_experimental(False, None, None) == (False, False)
    assert pipeline.resolve_experimental(True, False, None) == (False, False)
    assert pipeline.resolve_experimental(False, True, None) == (True, False)
    assert pipeline.resolve_experimental(False, True, True) == (True, True)
    with pytest.raises(ExperimentalConsentRequired) as exc:
        pipeline.resolve_experimental(True, False, True)
    assert exc.value.code == "EXPERIMENTAL_CONSENT_REQUIRED"
    assert exc.value.http_status == 422
    assert str(exc.value) == T.CONSENT_ERROR_MESSAGE or exc.value.message == T.CONSENT_ERROR_MESSAGE


def test_run_experimental_wires_fakes_and_separate_budget(tmp_path, monkeypatch):
    fake = FakeTracks()
    fake.install(monkeypatch)
    monkeypatch.setenv("PSYCHOSIGHT_EXP_MAX_LLM_CALLS", "12")
    episodes = [make_episode("ep1"), make_episode("ep2")]
    provider, store = object(), Store(tmp_path / "s.db")
    seen = []
    section, stats = run_experimental(
        episodes=episodes, selection={"ep2": "random", "missing": "top_signal"}, provider=provider, store=store,
        llm_ran=True, speakers=("me", "other"), week_order=["2025-W40"],
        progress=lambda stage, cur, tot: seen.append((stage, cur, tot)))
    assert seen[0] == ("experimental", 0, 0)
    assert ("experimental", 1, 2) in seen
    assert [ep.id for ep in fake.llm_calls[0]["selected"]] == ["ep2"]
    assert fake.llm_calls[0]["store"] is store
    assert fake.llm_calls[0]["provider"] is provider
    assert fake.llm_calls[0]["speakers"] == ("me", "other")
    assert fake.llm_calls[0]["holistic"] is True
    assert fake.llm_calls[0]["budget"].limit == 12
    assert fake.llm_calls[0]["budget"].limit != config.MAX_LLM_CALLS
    assert fake.build_calls[0]["llm_ran"] is True
    assert fake.build_calls[0]["seed"] == 1017
    assert fake.build_calls[0]["week_order"] == ["2025-W40"]
    assert fake.build_calls[0]["det"] is not None
    assert section["dimensions"][0]["per_speaker"]["me"]["contributions"][0]["anchor_source"] == "wiring-ok"
    assert stats.llm_calls == 3 and stats.cache_hits == 4


def test_run_experimental_deterministic_only_skips_llm(tmp_path, monkeypatch):
    fake = FakeTracks()
    fake.install(monkeypatch)
    section, stats = run_experimental(
        episodes=[make_episode()], selection={}, provider=None, store=Store(tmp_path / "s.db"),
        llm_ran=False, speakers=("me",), week_order=[], progress=lambda *a: None)
    assert fake.det_calls and not fake.llm_calls
    assert fake.build_calls[0]["llm"] is None and fake.build_calls[0]["llm_ran"] is False
    assert section["speakers_scored"] == ["me"]
    assert stats.llm_calls == 0


def test_run_experimental_failure_never_raises(tmp_path, monkeypatch, caplog):
    caplog.set_level(logging.WARNING)
    fake = FakeTracks()
    fake.raise_on = "det"
    fake.error = NotImplementedError("Track A implements compute_deterministic SECRET-BODY")
    fake.install(monkeypatch)
    seen = []
    section, stats = run_experimental(
        episodes=[make_episode()], selection={}, provider=None, store=Store(tmp_path / "s.db"),
        llm_ran=True, speakers=("me",), week_order=[], progress=lambda *a: seen.append(a))
    assert section["status"] == "failed"
    assert section["reason"] == T.REASON_FAILED
    assert stats.llm_calls == 0
    assert seen and seen[0][0] == "experimental"
    assert "SECRET-BODY" not in caplog.text
    assert not fake.build_calls

    fake.raise_on = "build"
    fake.error = RuntimeError("build blew up SECRET-BODY")
    section, stats = run_experimental(
        episodes=[make_episode()], selection={"ep1": "top_signal"}, provider=object(),
        store=Store(tmp_path / "s.db"), llm_ran=True, speakers=("me", "other"), week_order=["2025-W40"],
        progress=None)
    assert section["status"] == "failed" and section["reason"] == T.REASON_FAILED
    assert stats.llm_calls == 3  # LLM finished; aggregation did not
    assert "SECRET-BODY" not in caplog.text

    fake.raise_on = None
    fake.invalid = True
    section, _stats = run_experimental(
        episodes=[make_episode()], selection={}, provider=None, store=Store(tmp_path / "s.db"),
        llm_ran=False, speakers=("me",), week_order=[], progress=None)
    assert section["status"] == "failed"


def test_budget_invalid_override_uses_default(monkeypatch):
    from psychosight.experimental.section import experimental_budget
    monkeypatch.setenv("PSYCHOSIGHT_EXP_MAX_LLM_CALLS", "nope")
    assert experimental_budget().limit == EXP_MAX_LLM_CALLS
    monkeypatch.setenv("PSYCHOSIGHT_EXP_MAX_LLM_CALLS", "0")
    assert experimental_budget().limit == 0


def test_not_requested_does_no_work_and_prefers_track_c(tmp_path, monkeypatch):
    fake = FakeTracks()
    fake.install(monkeypatch)
    called = {}

    def track_c(reason, speakers=("me",)):
        called["reason"] = reason
        called["speakers"] = tuple(speakers)
        return shell_section("not_run", reason, speakers)

    monkeypatch.setattr(scoring, "not_run_section", track_c)
    db = _tiny_db(tmp_path)
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(db))
    stages = []
    rep = pipeline.run_analysis("1", llm_opt_in=False, store=Store(tmp_path / "p.db"),
                                progress=lambda s, c, t: stages.append(s))
    check(rep)
    assert rep["schema_version"] == "1.1.0"
    assert rep["experimental_scores"]["status"] == "not_run"
    assert rep["experimental_scores"]["reason"] == T.REASON_NOT_REQUESTED
    assert rep["run_meta"]["experimental_opt_in"] is False
    assert rep["run_meta"]["score_other_opt_in"] is False
    assert rep["run_meta"]["experimental_scoring_version"] is None
    assert rep["run_meta"]["experimental_prompt_versions"] is None
    assert rep["run_meta"]["experimental_llm_calls"] == 0
    assert called["reason"] == T.REASON_NOT_REQUESTED
    assert not fake.det_calls
    assert _stages(stages) == ["loading", "sessionizing", "features", "experimental", "done"]
    bare = dict(rep)
    bare.pop("experimental_scores")
    report.validate(bare)


def test_disabled_skips_work(tmp_path, monkeypatch):
    fake = FakeTracks()
    fake.install(monkeypatch)
    monkeypatch.setenv("PSYCHOSIGHT_EXPERIMENTAL", "0")
    assert pipeline.experimental_enabled() is False
    db = _tiny_db(tmp_path)
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(db))
    rep = pipeline.run_analysis("1", llm_opt_in=False, experimental_scores=True, score_other=True,
                                store=Store(tmp_path / "p.db"))
    check(rep)
    assert rep["experimental_scores"]["status"] == "not_run"
    assert rep["experimental_scores"]["reason"] == T.REASON_DISABLED
    assert rep["run_meta"]["experimental_opt_in"] is True
    assert rep["run_meta"]["score_other_opt_in"] is True
    assert rep["run_meta"]["experimental_scoring_version"] is None
    assert not fake.det_calls


def test_pipeline_hook_after_synthesis_uses_same_selection_and_new_budget(tmp_path, monkeypatch):
    fake = FakeTracks()
    fake.quote_text = "a short wiring quote"
    fake.install(monkeypatch)
    budgets = []
    real = rubric.CallBudget

    class Recording(real):
        def __init__(self, limit):
            super().__init__(limit)
            budgets.append(self)

    monkeypatch.setattr(rubric, "CallBudget", Recording)
    seen_sel = {}
    real_select = rubric.select_episodes

    def wrapped(episodes, cap=config.MAX_EPISODES_SCORED, seed=config.SELECTION_SEED):
        out = real_select(episodes, cap=cap, seed=seed)
        seen_sel["ids"] = set(out)
        return out

    monkeypatch.setattr(rubric, "select_episodes", wrapped)
    db = _tiny_db(tmp_path)
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(db))
    store = Store(tmp_path / "p.db")
    provider = MockProvider()
    stages = []
    rep = pipeline.run_analysis(
        "1", llm_opt_in=True, experimental_scores=True, score_other=False, provider=provider, store=store,
        progress=lambda s, c, t: stages.append(s))
    check(rep)
    order = _stages(stages)
    assert order.index("synthesis") < order.index("experimental") < order.index("done")
    assert fake.llm_calls and fake.build_calls[0]["llm_ran"] is True
    assert {ep.id for ep in fake.llm_calls[0]["selected"]} == seen_sel["ids"]
    assert fake.llm_calls[0]["store"] is store
    assert fake.llm_calls[0]["provider"] is provider
    assert fake.llm_calls[0]["budget"].limit == EXP_MAX_LLM_CALLS
    assert [b.limit for b in budgets] == [config.MAX_LLM_CALLS, EXP_MAX_LLM_CALLS]
    assert budgets[0] is not budgets[1]
    assert rep["experimental_scores"]["speakers_scored"] == ["me"]
    assert rep["run_meta"]["experimental_scoring_version"] == EXP_SCORING_VERSION
    assert rep["run_meta"]["experimental_prompt_versions"]["episode"] == EXP_PROMPT_VERSION
    assert rep["run_meta"]["experimental_llm_calls"] == 3
    assert rep["run_meta"]["experimental_cache_hits"] == 4
    assert rep["experimental_scores"]["quotes"][0]["text"] == "a short wiring quote"
    assert all(q.get("id") != "xq_001" for q in rep["quotes"])
    assert "xq_001" not in json.dumps(rep["quotes"])


def test_demo_default_runs_with_real_tracks(tmp_path):
    rep = pipeline.run_analysis("demo", llm_opt_in=False, store=Store(tmp_path / "p.db"))
    check(rep)
    assert rep["schema_version"] == "1.1.0"
    assert rep["experimental_scores"]["status"] == "ok"
    assert rep["experimental_scores"]["speakers_scored"] == ["me", "other"]
    assert len(rep["experimental_scores"]["dimensions"]) == 12


def test_demo_default_runs_and_stage_failure_keeps_the_report(tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("scoring blew up")

    monkeypatch.setattr(scoring, "build_section", boom)
    stages = []
    rep = pipeline.run_analysis("demo", llm_opt_in=False, store=Store(tmp_path / "p.db"),
                                progress=lambda s, c, t: stages.append(s))
    check(rep)
    assert rep["schema_version"] == "1.1.0"
    assert rep["experimental_scores"]["status"] == "failed"
    assert rep["experimental_scores"]["reason"] == T.REASON_FAILED
    assert rep["rubric"]["status"] == "not_run"
    assert rep["run_meta"]["experimental_opt_in"] is True
    assert rep["run_meta"]["score_other_opt_in"] is True
    assert rep["run_meta"]["experimental_scoring_version"] == EXP_SCORING_VERSION
    assert _stages(stages) == ["loading", "sessionizing", "features", "experimental", "done"]


def test_demo_with_fakes_scores_both(tmp_path, monkeypatch):
    fake = FakeTracks()
    fake.install(monkeypatch)
    rep = pipeline.run_analysis("demo", llm_opt_in=False, store=Store(tmp_path / "p.db"))
    check(rep)
    assert fake.det_calls and not fake.llm_calls
    assert fake.build_calls[0]["llm_ran"] is False
    assert fake.build_calls[0]["speakers"] == ("me", "other")
    assert rep["experimental_scores"]["status"] == "not_run"
    assert rep["experimental_scores"]["reason"] == "wiring"
    assert rep["run_meta"]["score_other_opt_in"] is True


def test_stored_v1_report_still_loads(tmp_path):
    raw = json.loads((config.REPO_ROOT / "docs" / "sample_report.json").read_text())
    assert raw["schema_version"] == "1.0.0" and "experimental_scores" not in raw
    store = Store(tmp_path / "s.db")
    store.save_report(raw)
    loaded = store.get_report(raw["report_id"])
    assert loaded["schema_version"] == "1.0.0"
    assert "experimental_scores" not in loaded
    report.validate(loaded)


def test_config_fields_and_enabled_flag(tmp_path, monkeypatch):
    client = TestClient(create_client_app(tmp_path))
    cfg = client.get("/config").json()
    assert cfg["experimental_opt_in_text"] == T.EXPERIMENTAL_CONSENT
    assert cfg["score_other_opt_in_text"] == T.SCORE_OTHER_CONSENT
    assert cfg["experimental_banner"] == T.BANNER
    assert cfg["experimental_footer_support"] == T.FOOTER_SUPPORT
    assert cfg["experimental_scale_note"] == T.SCALE_NOTE
    assert cfg["experimental_trend_note"] == T.TREND_NOTE
    assert "lower" not in T.TREND_NOTE and "higher" not in T.TREND_NOTE
    assert cfg["experimental_how_it_works"] == T.HOW_IT_WORKS
    assert cfg["experimental_enabled"] is True
    assert [d["key"] for d in cfg["experimental_dimensions"]] == list(DIMENSION_KEYS)
    assert set(cfg["experimental_dimensions"][0]) == {"key", "label", "family", "evidence_strength"}
    monkeypatch.setenv("PSYCHOSIGHT_EXPERIMENTAL", "0")
    assert client.get("/config").json()["experimental_enabled"] is False


def create_client_app(tmp_path):
    from psychosight.app import create_app
    return create_app(store=Store(tmp_path / "api.db"), use_default_static=False)


def test_api_consent_rules(tmp_path, monkeypatch):
    db = _tiny_db(tmp_path)
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(db))
    fake = FakeTracks()
    fake.install(monkeypatch)
    client = TestClient(create_client_app(tmp_path))

    r = client.post("/analyses", json={"conversation_id": "1", "llm_opt_in": False, "score_other": True})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "EXPERIMENTAL_CONSENT_REQUIRED"
    assert r.json()["error"]["message"] == T.CONSENT_ERROR_MESSAGE

    r = client.post("/analyses", json={
        "conversation_id": "1", "llm_opt_in": False, "experimental_scores": True, "score_other": True,
        "experimental_opt_in_text": "nope", "score_other_opt_in_text": T.SCORE_OTHER_CONSENT,
    })
    assert r.status_code == 422 and r.json()["error"]["message"] == T.CONSENT_MISMATCH_MESSAGE

    r = client.post("/analyses", json={
        "conversation_id": "1", "llm_opt_in": False, "experimental_scores": True, "score_other": True,
        "experimental_opt_in_text": T.EXPERIMENTAL_CONSENT, "score_other_opt_in_text": "nope",
    })
    assert r.status_code == 422 and r.json()["error"]["message"] == T.CONSENT_MISMATCH_MESSAGE

    r = client.post("/analyses", json={
        "conversation_id": "1", "llm_opt_in": False, "experimental_scores": True,
        "experimental_opt_in_text": T.EXPERIMENTAL_CONSENT, "score_other_opt_in_text": "ignored",
    })
    assert r.status_code == 202
    job = r.json()["job_id"]
    st, _seen = wait_done(client, job)
    assert st["status"] == "done"
    rep = client.get(f"/analyses/{job}/report").json()
    check(rep)
    assert rep["experimental_scores"]["speakers_scored"] == ["me"]
    assert rep["run_meta"]["experimental_opt_in"] is True
    assert rep["run_meta"]["score_other_opt_in"] is False
    assert fake.det_calls and not fake.llm_calls

    # Demo does not require the echo, and both flags default on.
    fake.det_calls.clear()
    r = client.post("/analyses", json={
        "conversation_id": "demo", "llm_opt_in": False, "experimental_opt_in_text": "nope",
    })
    assert r.status_code == 202
    job = r.json()["job_id"]
    st, _seen = wait_done(client, job)
    assert st["status"] == "done"
    rep = client.get(f"/analyses/{job}/report").json()
    check(rep)
    assert rep["run_meta"]["experimental_opt_in"] is True
    assert rep["run_meta"]["score_other_opt_in"] is True
    assert rep["experimental_scores"]["speakers_scored"] == ["me", "other"]

    r = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": False,
                                       "experimental_scores": "yes"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_REQUEST"


def test_delete_removes_experimental_section(tmp_path, monkeypatch):
    db = _tiny_db(tmp_path)
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(db))
    fake = FakeTracks()
    fake.sentinel = "exp-delete-marker-9f3c"
    fake.install(monkeypatch)
    path = tmp_path / "api.db"
    from psychosight.app import create_app
    client = TestClient(create_app(store=Store(path), use_default_static=False))
    r = client.post("/analyses", json={
        "conversation_id": "1", "llm_opt_in": False, "experimental_scores": True,
        "experimental_opt_in_text": T.EXPERIMENTAL_CONSENT,
    })
    job = r.json()["job_id"]
    wait_done(client, job)
    rep = client.get(f"/analyses/{job}/report").json()
    assert fake.sentinel in json.dumps(rep["experimental_scores"])
    assert client.delete(f"/analyses/{job}").json()["deleted"] is True
    gone = client.get(f"/analyses/{job}/report")
    assert gone.status_code == 404
    assert fake.sentinel.encode() not in path.read_bytes()
    assert all(row["job_id"] != job for row in client.get("/analyses").json()["analyses"])


def test_cli_flags(tmp_path, monkeypatch, capsys):
    from psychosight.cli import main, resolve_cli_experimental
    assert resolve_cli_experimental(True, False, False, False) == (True, True)
    assert resolve_cli_experimental(True, False, False, True) == (False, False)
    assert resolve_cli_experimental(False, True, False, False) == (True, False)
    assert resolve_cli_experimental(False, True, True, False) == (True, True)
    with pytest.raises(ExperimentalConsentRequired):
        resolve_cli_experimental(False, False, True, False)

    err = capsys.readouterr()
    assert main(["analyze", "--conversation", "1", "--score-other"]) == 2
    err = capsys.readouterr().err
    assert "EXPERIMENTAL_CONSENT_REQUIRED" in err and T.CONSENT_ERROR_MESSAGE in err

    fake = FakeTracks()
    fake.install(monkeypatch)
    db = _tiny_db(tmp_path)
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(db))
    monkeypatch.setenv("PSYCHOSIGHT_DATA_DIR", str(tmp_path / "data"))
    assert main(["analyze", "--conversation", "1", "--experimental-scores", "--no-save"]) == 0
    out = json.loads(capsys.readouterr().out)
    check(out)
    assert out["experimental_scores"]["speakers_scored"] == ["me"]
    assert fake.det_calls and not fake.llm_calls

    fake.det_calls.clear()
    assert main(["analyze", "--conversation", "1", "--experimental-scores", "--score-other", "--no-save"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["experimental_scores"]["speakers_scored"] == ["me", "other"]

    fake.det_calls.clear()
    assert main(["analyze", "--demo", "--no-experimental-scores", "--no-save"]) == 0
    out = json.loads(capsys.readouterr().out)
    check(out)
    assert out["experimental_scores"]["status"] == "not_run"
    assert out["experimental_scores"]["reason"] == T.REASON_NOT_REQUESTED
    assert not fake.det_calls

    # Top-level `--demo` uses the same flags (no subcommand). Off stays off.
    fake.det_calls.clear()
    assert main(["--demo", "--no-experimental-scores"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["experimental_scores"]["reason"] == T.REASON_NOT_REQUESTED
    assert not fake.det_calls
