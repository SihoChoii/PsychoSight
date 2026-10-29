"""Bundled key fallback (lowest priority), build-time injection script, key masking everywhere."""

from __future__ import annotations

import importlib.util
import json
import logging
import stat
import sys
from pathlib import Path

import httpx
import pytest

from psychosight import config
from psychosight.cli import main
from psychosight.errors import LLMUnavailable
from psychosight.llm import DeepSeekProvider, get_provider, install_log_guard

REPO = Path(__file__).resolve().parents[1]
BUNDLED_KEY = "sk-bundled-FAKE-KEY-9z9z"
DOTENV_KEY = "sk-dotenv-FAKE-KEY-8y8y"
ENV_KEY = "sk-env-FAKE-KEY-7x7x"


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _bundle(tmp_path, monkeypatch, text=f"DEEPSEEK_API_KEY={BUNDLED_KEY}\n") -> Path:
    path = _write(tmp_path / "Bundle" / "psychosight.env", text)
    monkeypatch.setenv("PSYCHOSIGHT_BUNDLED_ENV", str(path))
    return path


def _client():
    from fastapi.testclient import TestClient

    from psychosight.app import create_app
    from psychosight.storage import Store

    return TestClient(create_app(store=Store(config.db_path()), use_default_static=False))


# ---- load order --------------------------------------------------------------------------------------------

def test_bundled_is_used_when_nothing_else_has_a_key(tmp_path, monkeypatch):
    _bundle(tmp_path, monkeypatch)
    s = config.llm_settings()
    assert s.api_key == BUNDLED_KEY and s.key_source == "bundled" and s.configured
    assert s.model == "deepseek-flash" and s.reasoning_effort == "max"  # defaults kept when the bundle omits them


def test_bundled_settings_are_read_too(tmp_path, monkeypatch):
    _bundle(tmp_path, monkeypatch, f"DEEPSEEK_API_KEY={BUNDLED_KEY}\nDEEPSEEK_MODEL=deepseek-v4-pro\n"
                                   "DEEPSEEK_REASONING_EFFORT=high\n")
    s = config.llm_settings()
    assert s.model == "deepseek-v4-pro" and s.reasoning_effort == "high"


def test_priority_env_then_dotenv_then_home_dotenv_then_bundled(tmp_path, monkeypatch):
    _bundle(tmp_path, monkeypatch, f"DEEPSEEK_API_KEY={BUNDLED_KEY}\nDEEPSEEK_MODEL=bundled-model\n")
    repo_env = tmp_path / "repo.env"
    home_env = tmp_path / "home.env"
    monkeypatch.setenv("PSYCHOSIGHT_DOTENV", f"{repo_env}{config.os.pathsep}{home_env}")
    assert config.llm_settings().key_source == "bundled"

    _write(home_env, "DEEPSEEK_API_KEY=sk-home-FAKE-KEY-6w6w\n")
    s = config.llm_settings()
    assert (s.api_key, s.key_source, s.model) == ("sk-home-FAKE-KEY-6w6w", "dotenv", "bundled-model")

    _write(repo_env, f"DEEPSEEK_API_KEY={DOTENV_KEY}\nDEEPSEEK_MODEL=dotenv-model\n")
    s = config.llm_settings()
    assert (s.api_key, s.key_source, s.model) == (DOTENV_KEY, "dotenv", "dotenv-model")

    monkeypatch.setenv("DEEPSEEK_API_KEY", ENV_KEY)
    s = config.llm_settings()
    assert (s.api_key, s.key_source) == (ENV_KEY, "env")


def test_placeholder_in_bundle_counts_as_no_key(tmp_path, monkeypatch):
    _bundle(tmp_path, monkeypatch, "DEEPSEEK_API_KEY=your-key-here\n")
    s = config.llm_settings()
    assert s.api_key is None and s.key_source is None


def test_explicit_bundled_path_is_the_only_candidate(tmp_path, monkeypatch):
    pkg = tmp_path / "pkg"
    _write(pkg / "_bundled" / "psychosight.env", f"DEEPSEEK_API_KEY={BUNDLED_KEY}\n")
    monkeypatch.setattr(config, "PACKAGE_DIR", pkg)
    monkeypatch.setenv("PSYCHOSIGHT_BUNDLED_ENV", str(tmp_path / "missing.env"))
    assert config.bundled_env_paths() == [tmp_path / "missing.env"]
    assert config.llm_settings().api_key is None


def test_package_dir_bundled_file(tmp_path, monkeypatch):
    pkg = tmp_path / "pkg"
    _write(pkg / "_bundled" / "psychosight.env", f"DEEPSEEK_API_KEY={BUNDLED_KEY}\n")
    monkeypatch.setattr(config, "PACKAGE_DIR", pkg)
    monkeypatch.delenv("PSYCHOSIGHT_BUNDLED_ENV")
    assert config.bundled_env_paths()[0] == pkg / "_bundled" / "psychosight.env"
    s = config.llm_settings()
    assert s.api_key == BUNDLED_KEY and s.key_source == "bundled"


@pytest.mark.parametrize("via", ["executable", "argv0"])
def test_app_resources_derived_from_executable_or_argv0(tmp_path, monkeypatch, via):
    app = tmp_path / "Applications" / "PsychoSight.app"
    exe = _write(app / "Contents" / "MacOS" / "PsychoSight", "")
    _write(app / "Contents" / "Resources" / "psychosight.env", f"DEEPSEEK_API_KEY={BUNDLED_KEY}\n")
    monkeypatch.setattr(config, "PACKAGE_DIR", tmp_path / "nopkg")
    monkeypatch.delenv("PSYCHOSIGHT_BUNDLED_ENV")
    if via == "executable":
        monkeypatch.setattr(sys, "executable", str(exe))
    else:
        nested = _write(app / "Contents" / "Resources" / "backend" / "bin" / "python3", "")
        monkeypatch.setattr(sys, "executable", str(tmp_path / "usr" / "bin" / "python3"))
        monkeypatch.setattr(sys, "argv", [str(nested)])
    expected = (app / "Contents" / "Resources" / "psychosight.env").resolve()
    assert expected in [p.resolve() for p in config.bundled_env_paths()]
    s = config.llm_settings()
    assert s.api_key == BUNDLED_KEY and s.key_source == "bundled"


def test_app_resources_needs_a_contents_dir(tmp_path):
    fake = _write(tmp_path / "Not.app" / "python", "")  # no Contents/
    assert config._app_resources_for(fake) is None
    assert config._app_resources_for(tmp_path / "x" / "y") is None


# ---- clear message when no key -------------------------------------------------------------------------------

def test_no_key_anywhere_lists_every_place_searched(tmp_path, monkeypatch):
    with pytest.raises(LLMUnavailable) as exc:
        get_provider(is_demo=False, llm_opt_in=True)
    msg = exc.value.message
    assert msg.startswith("No DeepSeek API key found")
    for needle in ("DEEPSEEK_API_KEY environment variable", "no-such.env", "bundled psychosight.env",
                   "no-such-bundled.env", "inject_bundled_key.py", "Copy .env.example to .env"):
        assert needle in msg, needle


def test_config_reports_bundled_source_and_never_the_key(tmp_path, monkeypatch):
    _bundle(tmp_path, monkeypatch)
    cfg = _client().get("/config").json()
    assert cfg["llm_available"] is True and cfg["llm_key_source"] == "bundled" and cfg["llm_key_note"] is None
    assert cfg["model"] == "deepseek-flash"
    assert BUNDLED_KEY not in json.dumps(cfg) and "9z9z" not in json.dumps(cfg)


def test_config_no_key_note_and_demo_mock_note(monkeypatch):
    monkeypatch.delenv("PSYCHOSIGHT_DEMO_PROVIDER")
    cfg = _client().get("/config").json()
    assert cfg["llm_available"] is False and cfg["llm_key_source"] is None
    assert "bundled psychosight.env" in cfg["llm_key_note"]
    assert cfg["demo_provider"] == "mock" and cfg["demo_provider_note"] == config.MOCK_NOTE_NO_KEY


def test_bundled_key_switches_demo_to_real_model(tmp_path, monkeypatch):
    monkeypatch.delenv("PSYCHOSIGHT_DEMO_PROVIDER")
    _bundle(tmp_path, monkeypatch)
    assert config.demo_provider_name() == "deepseek" and config.demo_provider_note() is None


def test_cli_check_llm_no_key_message(capsys):
    assert main(["check-llm"]) == 2
    err = capsys.readouterr().err
    assert "LLM_UNAVAILABLE" in err and "bundled psychosight.env" in err


# ---- masking -------------------------------------------------------------------------------------------------

def _settings(**kw):
    base = dict(api_key=BUNDLED_KEY, model="m", base_url="https://api.deepseek.test", reasoning_effort=None,
                thinking=None, json_mode=True, send_temperature=True, timeout_s=5, max_tokens=None,
                key_source="bundled")
    base.update(kw)
    return config.LLMSettings(**base)


def test_mask_and_redact_helpers():
    config.remember_secret(BUNDLED_KEY)
    assert config.mask_key(BUNDLED_KEY) == "sk-…9z9z"
    assert config.redact(f"bearer {BUNDLED_KEY} end") == "bearer sk-…9z9z end"
    shaped = "sk-" + "AbCd" * 5 + "UV12"  # built at runtime so no key-shaped literal is tracked
    assert config.redact(f"token {shaped} x") == "token sk-…UV12 x"
    assert config.redact("x", replacement="[redacted]") == "x"
    assert BUNDLED_KEY not in repr(_settings())


def test_rejected_bundled_key_message_names_source_masked(caplog):
    caplog.set_level(logging.DEBUG)
    install_log_guard()
    p = DeepSeekProvider(_settings(), transport=httpx.MockTransport(lambda r: httpx.Response(401, json={})),
                         sleep=lambda s: None)
    with pytest.raises(LLMUnavailable) as exc:
        p.complete("s", "u")
    assert "bundled in the app" in exc.value.message and "sk-…9z9z" in exc.value.message
    assert BUNDLED_KEY not in exc.value.message and BUNDLED_KEY not in str(exc.value)
    assert BUNDLED_KEY not in caplog.text


def test_provider_error_echoing_the_key_is_scrubbed(caplog):
    caplog.set_level(logging.DEBUG)
    install_log_guard()
    body = {"error": {"message": f"bad request for key {BUNDLED_KEY}"}}
    p = DeepSeekProvider(_settings(), transport=httpx.MockTransport(lambda r: httpx.Response(418, json=body)),
                         sleep=lambda s: None)
    with pytest.raises(LLMUnavailable) as exc:
        p.complete("s", "u")
    assert BUNDLED_KEY not in exc.value.message and BUNDLED_KEY not in json.dumps(exc.value.to_dict())
    assert BUNDLED_KEY not in caplog.text


def test_log_lines_with_a_non_env_key_are_redacted(tmp_path, monkeypatch, caplog):
    _bundle(tmp_path, monkeypatch)
    config.llm_settings()  # loads (and remembers) the bundled key
    caplog.set_level(logging.INFO)
    install_log_guard()
    logging.getLogger("psychosight.llm").info("authorization %s", BUNDLED_KEY)
    assert BUNDLED_KEY not in caplog.text and "[redacted]" in caplog.text


def test_api_job_error_with_bundled_key_has_no_key(tmp_path, monkeypatch):
    """A real-conversation run whose provider rejects the bundled key: job error body has no key."""
    _bundle(tmp_path, monkeypatch)
    from psychosight import llm

    real = llm.DeepSeekProvider

    def fake(settings=None, **kw):
        return real(settings, transport=httpx.MockTransport(lambda r: httpx.Response(401, json={})),
                    sleep=lambda s: None)

    monkeypatch.setattr(llm, "DeepSeekProvider", fake)
    monkeypatch.setenv("PSYCHOSIGHT_DEMO_PROVIDER", "deepseek")
    client = _client()
    res = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": True,
                                        "experimental_scores": False})
    assert res.status_code in (200, 202), res.text
    job_id = res.json()["job_id"]
    import time

    for _ in range(200):
        job = client.get(f"/analyses/{job_id}").json()
        if job["status"] in ("done", "error"):
            break
        time.sleep(0.05)
    text = json.dumps(job)
    assert BUNDLED_KEY not in text
    assert job["status"] == "error" and job["error"]["code"] == "LLM_UNAVAILABLE"
    assert "bundled in the app" in job["error"]["message"]


# ---- injection script ----------------------------------------------------------------------------------------

def _inject_module():
    spec = importlib.util.spec_from_file_location("inject_bundled_key", REPO / "scripts" / "inject_bundled_key.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_inject_from_env_file_writes_600_and_never_prints_key(tmp_path, capsys, monkeypatch):
    mod = _inject_module()
    env_file = _write(tmp_path / "src.env", f"DEEPSEEK_API_KEY={DOTENV_KEY}\nDEEPSEEK_MODEL=deepseek-flash\n"
                                            "DEEPSEEK_REASONING_EFFORT=max\nPSYCHOSIGHT_PORT=1\n")
    dest = tmp_path / "PsychoSight.app" / "Contents" / "Resources" / "psychosight.env"
    assert mod.main([str(dest), "--env-file", str(env_file)]) == 0
    out = capsys.readouterr()
    assert DOTENV_KEY not in out.out + out.err and "sk-…8y8y" in out.out and str(dest) in out.out
    assert stat.S_IMODE(dest.stat().st_mode) == 0o600
    values = config.parse_dotenv(dest.read_text(encoding="utf-8"))
    assert values == {"DEEPSEEK_API_KEY": DOTENV_KEY, "DEEPSEEK_MODEL": "deepseek-flash",
                      "DEEPSEEK_REASONING_EFFORT": "max"}
    # ...and the backend reads it back as the bundled source.
    monkeypatch.setenv("PSYCHOSIGHT_BUNDLED_ENV", str(dest))
    s = config.llm_settings()
    assert s.api_key == DOTENV_KEY and s.key_source == "bundled"


def test_inject_env_var_wins_over_file(tmp_path, capsys, monkeypatch):
    mod = _inject_module()
    env_file = _write(tmp_path / "src.env", f"DEEPSEEK_API_KEY={DOTENV_KEY}\n")
    monkeypatch.setenv("DEEPSEEK_API_KEY", ENV_KEY)
    dest = tmp_path / "out" / "psychosight.env"
    assert mod.main([str(dest), "--env-file", str(env_file)]) == 0
    assert config.parse_dotenv(dest.read_text(encoding="utf-8"))["DEEPSEEK_API_KEY"] == ENV_KEY
    assert ENV_KEY not in capsys.readouterr().out


@pytest.mark.parametrize("content", [None, "DEEPSEEK_API_KEY=your-key-here\n", "DEEPSEEK_MODEL=x\n"])
def test_inject_without_key_fails_clearly(tmp_path, capsys, content):
    mod = _inject_module()
    env_file = tmp_path / "src.env"
    if content is not None:
        _write(env_file, content)
    dest = tmp_path / "out" / "psychosight.env"
    assert mod.main([str(dest), "--env-file", str(env_file)]) == 1
    assert "no DeepSeek API key found" in capsys.readouterr().err and not dest.exists()


def test_inject_refuses_a_tracked_path_inside_the_repo(tmp_path, capsys, monkeypatch):
    mod = _inject_module()
    env_file = _write(tmp_path / "src.env", f"DEEPSEEK_API_KEY={DOTENV_KEY}\n")
    dest = REPO / "docs" / "not-ignored-key.txt"
    rc = mod.main([str(dest), "--env-file", str(env_file)])
    if (REPO / ".git").exists():
        assert rc == 2 and not dest.exists() and "refusing" in capsys.readouterr().err
    elif dest.exists():  # pragma: no cover - not a git checkout
        dest.unlink()


def test_inject_allows_gitignored_package_bundle_dir(tmp_path, capsys):
    mod = _inject_module()
    if not (REPO / ".git").exists():
        pytest.skip("not a git checkout")
    dest = REPO / "psychosight" / "_bundled" / "psychosight.env"
    existed = dest.exists()
    assert mod._inside_repo_and_tracked(dest) is False  # git-ignored, so the script would allow it
    assert existed == dest.exists()
