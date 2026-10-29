from __future__ import annotations

import json
import time

import pytest
from fastapi.testclient import TestClient

from psychosight import config
from psychosight.app import create_app
from psychosight.storage import Store
from tests.helpers import make_chat_db
from tests.test_pipeline_report import check


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(store=Store(tmp_path / "api.db"), use_default_static=False))


def wait_done(client, job_id, timeout=20):
    deadline = time.time() + timeout
    seen = set()
    while time.time() < deadline:
        st = client.get(f"/analyses/{job_id}").json()
        seen.add(st["stage"])
        if st["status"] in ("done", "error"):
            return st, seen
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def test_health_config_no_secrets(client, monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-SECRET-123")
    monkeypatch.setenv("DEEPSEEK_MODEL", "my-model")
    assert client.get("/health").json()["status"] == "ok"
    cfg = client.get("/config").json()
    assert cfg["opt_in_text"] == config.OPT_IN_TEXT and "BOTH sides" in cfg["opt_in_text"]
    assert "DeepSeek" in cfg["opt_in_text"] and "other person's messages" in cfg["opt_in_text"]
    assert cfg["model"] == "my-model" and cfg["llm_configured"] is True
    assert "sk-SECRET-123" not in json.dumps(cfg) and cfg["llm_key_source"] == "env"


def test_config_dotenv_key_available_without_secret(client, tmp_path, monkeypatch):
    cfg = client.get("/config").json()
    assert cfg["llm_available"] is False and cfg["llm_key_source"] is None and cfg["model"] == "deepseek-flash"
    env_file = tmp_path / ".env"
    env_file.write_text("DEEPSEEK_API_KEY=sk-dotenv-FAKE-SECRET-5555\n", encoding="utf-8")
    monkeypatch.setenv("PSYCHOSIGHT_DOTENV", str(env_file))
    cfg = client.get("/config").json()
    assert cfg["llm_available"] is True and cfg["llm_configured"] is True
    assert cfg["model"] == "deepseek-flash" and cfg["reasoning_effort"] == "max"
    assert cfg["llm_key_source"] == "dotenv"
    assert "FAKE-SECRET" not in json.dumps(cfg) and "5555" not in json.dumps(cfg)


def test_conversations_demo_first_and_fda_error(client):
    body = client.get("/conversations").json()
    assert body["conversations"][0]["id"] == "demo" and body["conversations"][0]["is_demo"]
    assert body["chat_db"]["available"] is False
    assert body["chat_db"]["error"]["code"] == "FULL_DISK_ACCESS_REQUIRED"


def test_full_demo_flow_and_delete(client):
    r = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": True})
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    st, seen = wait_done(client, job_id)
    assert st["status"] == "done" and st["mode"] == "full" and st["error"] is None
    rep = client.get(f"/analyses/{job_id}/report").json()
    check(rep)
    assert rep["report_id"] == job_id and rep["run_meta"]["llm_opt_in"] is True
    assert client.get("/analyses").json()["analyses"][0]["job_id"] == job_id
    assert client.delete(f"/analyses/{job_id}").json() == {"deleted": True, "job_id": job_id}
    gone = client.get(f"/analyses/{job_id}/report")
    assert gone.status_code == 404 and gone.json()["error"]["code"] == "NOT_FOUND"
    assert client.delete(f"/analyses/{job_id}").status_code == 404


def test_deterministic_only_without_opt_in(client):
    job_id = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": False}).json()["job_id"]
    st, _ = wait_done(client, job_id)
    rep = client.get(f"/analyses/{job_id}/report").json()
    check(rep)
    assert rep["mode"] == "deterministic_only" and rep["rubric"]["status"] == "not_run"
    assert rep["run_meta"]["llm_opt_in"] is False


def test_full_mode_without_opt_in_refused(client):
    r = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": False, "mode": "full"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "LLM_OPT_IN_REQUIRED"


def test_opt_in_must_be_boolean(client):
    r = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": "yes"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_REQUEST"
    r = client.post("/analyses", json={"conversation_id": "demo"})
    assert r.status_code == 422


def test_bad_date(client):
    r = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": False, "date_from": "10/01/2025"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_REQUEST"


def test_real_conversation_errors(client, tmp_path, monkeypatch):
    from datetime import datetime, timezone
    t = datetime(2025, 10, 1, tzinfo=timezone.utc)
    db = make_chat_db(tmp_path / "chat.db", [(["+1555"], [(t, False, "+1555", "hi")]),
                                             (["+1556", "+1557"], [(t, False, "+1556", "yo")])])
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(db))
    convs = client.get("/conversations").json()
    assert sorted(c["id"] for c in convs["conversations"]) == ["1", "2", "demo"] and convs["chat_db"]["available"]
    r = client.post("/analyses", json={"conversation_id": "2", "llm_opt_in": False})
    assert r.status_code == 400 and r.json()["error"]["code"] == "GROUP_CHAT_UNSUPPORTED"
    r = client.post("/analyses", json={"conversation_id": "77", "llm_opt_in": False})
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    r = client.post("/analyses", json={"conversation_id": "1", "llm_opt_in": True})
    assert r.status_code == 503 and r.json()["error"]["code"] == "LLM_UNAVAILABLE"
    job_id = client.post("/analyses", json={"conversation_id": "1", "llm_opt_in": False}).json()["job_id"]
    st, _ = wait_done(client, job_id)
    assert st["status"] == "done"
    check(client.get(f"/analyses/{job_id}/report").json())


def test_fda_error_on_analysis(client):
    r = client.post("/analyses", json={"conversation_id": "5", "llm_opt_in": False})
    assert r.status_code == 403 and r.json()["error"]["code"] == "FULL_DISK_ACCESS_REQUIRED"


def test_unknown_job(client):
    r = client.get("/analyses/nope")
    assert r.status_code == 404 and r.json() == {"error": {"code": "NOT_FOUND", "message": "No analysis with id 'nope'."}}


def test_injection_end_to_end_through_api(client):
    job_id = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": True}).json()["job_id"]
    wait_done(client, job_id)
    rep = client.get(f"/analyses/{job_id}/report").json()
    check(rep)
    from psychosight.synthetic import INJECTION_TEXT
    assert INJECTION_TEXT not in json.dumps(rep)


def test_root_note_without_static(client):
    r = client.get("/")
    assert r.status_code == 200 and "PsychoSight Lite backend" in r.text


def test_static_mounted_after_api(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<h1>frontend</h1>")
    c = TestClient(create_app(static_dir=web, store=Store(tmp_path / "s.db")))
    assert "frontend" in c.get("/").text
    assert c.get("/health").json()["status"] == "ok"


def test_cors_local_origins_only(client):
    ok = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    ok2 = client.get("/health", headers={"Origin": "http://127.0.0.1:3000"})
    assert ok2.headers.get("access-control-allow-origin") == "http://127.0.0.1:3000"
    bad = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers


def test_cli_commands(tmp_path, capsys):
    from psychosight.cli import main
    out = tmp_path / "r.json"
    assert main(["analyze", "--demo", "--opt-in-llm", "--out", str(out)]) == 0
    rep = json.loads(out.read_text())
    check(rep)
    assert main(["--demo"]) == 0
    det = json.loads(capsys.readouterr().out)
    check(det)
    assert det["mode"] == "deterministic_only"
    assert main(["delete-report", rep["report_id"]]) == 0
    assert main(["delete-report", rep["report_id"]]) == 1
    assert main(["list-conversations"]) == 0
    assert main(["check-llm"]) == 2  # no key in tests -> LLM_UNAVAILABLE
    assert "LLM_UNAVAILABLE" in capsys.readouterr().err


def test_static_dir_skips_unbuilt_vite_source(tmp_path, monkeypatch):
    monkeypatch.delenv("PSYCHOSIGHT_STATIC_DIR", raising=False)
    monkeypatch.setattr(config, "REPO_ROOT", tmp_path)
    assert config.static_dir() is None and config.unbuilt_ui_hint() is None
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<html></html>", encoding="utf-8")
    assert config.static_dir() == web  # plain static files are served as-is
    (web / "package.json").write_text("{}", encoding="utf-8")
    assert config.static_dir() is None and "npm run build" in config.unbuilt_ui_hint()
    (web / "dist").mkdir()
    assert config.static_dir() == web / "dist" and config.unbuilt_ui_hint() is None
