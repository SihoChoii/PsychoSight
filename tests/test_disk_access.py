"""Full Disk Access probe: a few bytes, no message text in logs or API responses."""

from __future__ import annotations

import argparse
import importlib.util
import json
import logging
from pathlib import Path

from fastapi.testclient import TestClient

from psychosight import cli, disk_access
from psychosight.app import create_app
from psychosight.storage import Store


SECRET = b"MSGSECRET-do-not-log-body"


def test_probe_reads_only_a_few_bytes_and_discards_them(tmp_path, monkeypatch, caplog):
    path = tmp_path / "chat.db"
    path.write_bytes(b"x" * 1000)
    sizes = []
    real_read = disk_access.os.read

    def wrapped(fd, count):
        sizes.append(count)
        return real_read(fd, count)

    monkeypatch.setattr(disk_access.os, "read", wrapped)
    with caplog.at_level(logging.INFO, logger="psychosight.disk_access"):
        result = disk_access.probe_chat_db(path)
        disk_access.log_probe(result)
    assert result == {"granted": True, "reason": "ok", "error_type": None}
    assert sizes == [disk_access.PROBE_BYTES]
    assert "xxxx" not in caplog.text


def test_probe_missing_and_denied_do_not_log_bytes(tmp_path, caplog):
    missing = disk_access.probe_chat_db(tmp_path / "absent.db")
    assert missing["granted"] is False and missing["reason"] == "missing"

    blocked = tmp_path / "chat.db"
    blocked.write_bytes(SECRET)
    blocked.chmod(0)
    try:
        with caplog.at_level(logging.INFO, logger="psychosight.disk_access"):
            denied = disk_access.probe_chat_db(blocked)
            disk_access.log_probe(denied)
    finally:
        blocked.chmod(0o644)
    assert denied["granted"] is False and denied["reason"] == "denied"
    assert "MSGSECRET" not in caplog.text
    line = disk_access.probe_log_line({"granted": False, "reason": "denied", "error_type": "MSGSECRET leaked"})
    assert "MSGSECRET" not in line and "error_type=none" in line


def test_recheck_when_granted_does_not_spawn(monkeypatch, tmp_path):
    path = tmp_path / "chat.db"
    path.write_bytes(SECRET)
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(path))

    def boom(timeout=20):
        raise AssertionError("fresh process should not start")

    monkeypatch.setattr(disk_access, "probe_fresh_process", boom)
    body = disk_access.recheck()
    assert body["granted"] is True and body["relaunch_required"] is False
    assert body["settings_url"] == disk_access.SETTINGS_URL
    assert "MSGSECRET" not in json.dumps(body)


def test_recheck_tells_user_to_relaunch_when_only_a_new_process_can_read(monkeypatch):
    monkeypatch.setattr(
        disk_access, "probe_chat_db",
        lambda path=None: {"granted": False, "reason": "denied", "error_type": "PermissionError"},
    )
    monkeypatch.setattr(
        disk_access, "probe_fresh_process",
        lambda timeout=20.0: {"granted": True, "reason": "ok", "error_type": None},
    )
    body = disk_access.recheck()
    assert body["granted"] is False and body["relaunch_required"] is True
    assert body["reason"] == "relaunch_required"
    assert "Quit PsychoSight" in body["message"]
    assert body["settings_url"] == disk_access.SETTINGS_URL


def test_fresh_process_probe_roundtrip(monkeypatch, tmp_path):
    path = tmp_path / "chat.db"
    path.write_bytes(SECRET)
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(path))
    result = disk_access.probe_fresh_process()
    assert result["granted"] is True and result["reason"] == "ok"
    assert "MSGSECRET" not in json.dumps(result)


def test_serve_probes_before_listen_and_refuses_other_hosts(monkeypatch, capsys):
    order = []

    def fake_probe():
        order.append("probe")
        return {"granted": False, "reason": "denied", "error_type": "PermissionError"}

    def fake_run(app, host, port, log_level):
        order.append("listen")
        assert host == "127.0.0.1"

    monkeypatch.setattr(disk_access, "probe_and_report", fake_probe)
    import uvicorn
    monkeypatch.setattr(uvicorn, "run", fake_run)
    assert cli.cmd_serve(argparse.Namespace(host="127.0.0.1", port=8765, static_dir=None)) == 0
    assert order == ["probe", "listen"]
    err = capsys.readouterr().err
    assert "disk access probe granted=false reason=denied error_type=PermissionError" in err
    assert "MSGSECRET" not in err

    def boom():
        raise AssertionError("probed")

    monkeypatch.setattr(disk_access, "probe_and_report", boom)
    assert cli.cmd_serve(argparse.Namespace(host="0.0.0.0", port=1, static_dir=None)) == 2


def test_open_settings_uses_the_full_disk_url_only(monkeypatch):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))

        class Result:
            returncode = 0 if len(calls) == 1 else 1

        return Result()

    monkeypatch.setattr(disk_access.sys, "platform", "darwin")
    monkeypatch.setattr(disk_access.subprocess, "run", fake_run)
    opened = disk_access.open_settings()
    assert opened["opened"] is True
    assert calls == [["/usr/bin/open", disk_access.SETTINGS_URL]]

    calls.clear()

    def fail_then_fallback(cmd, **kwargs):
        calls.append(list(cmd))

        class Result:
            returncode = 0 if len(calls) == 2 else 1

        return Result()

    monkeypatch.setattr(disk_access.subprocess, "run", fail_then_fallback)
    fallback = disk_access.open_settings()
    assert fallback["opened"] is True and fallback["url"] == disk_access.SETTINGS_URL_FALLBACK
    assert calls[0] == ["/usr/bin/open", disk_access.SETTINGS_URL]

    monkeypatch.setattr(disk_access.sys, "platform", "linux")
    calls.clear()
    assert disk_access.open_settings()["opened"] is False
    assert calls == []


def test_reveal_uses_the_app_bundle_only(tmp_path, monkeypatch):
    bundle = tmp_path / "PsychoSight.app"
    (bundle / "Contents" / "MacOS").mkdir(parents=True)
    exe = bundle / "Contents" / "MacOS" / "PsychoSight"
    exe.write_text("bin", encoding="utf-8")
    assert disk_access.bundle_from_executable(str(exe)) == bundle
    assert disk_access.bundle_from_executable(str(tmp_path / "other")) is None

    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))

        class Result:
            returncode = 0

        return Result()

    monkeypatch.setattr(disk_access.sys, "platform", "darwin")
    monkeypatch.setattr(disk_access.sys, "frozen", True, raising=False)
    monkeypatch.setattr(disk_access.sys, "executable", str(exe))
    monkeypatch.setattr(disk_access.subprocess, "run", fake_run)
    revealed = disk_access.reveal_app()
    assert revealed["revealed"] is True
    assert calls == [["/usr/bin/open", "-R", str(bundle.resolve())]]


def test_disk_access_routes_ignore_client_paths(tmp_path, monkeypatch):
    bundle = tmp_path / "PsychoSight.app"
    bundle.mkdir()
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))

        class Result:
            returncode = 0

        return Result()

    monkeypatch.setattr(disk_access.sys, "platform", "darwin")
    monkeypatch.setattr(disk_access.sys, "frozen", False, raising=False)
    monkeypatch.setattr(disk_access, "installed_app_candidates", lambda: [bundle])
    monkeypatch.setattr(disk_access.subprocess, "run", fake_run)
    monkeypatch.setattr(
        disk_access, "probe_chat_db",
        lambda path=None: {"granted": False, "reason": "missing", "error_type": "FileNotFoundError"},
    )
    monkeypatch.setattr(
        disk_access, "probe_fresh_process",
        lambda timeout=20.0: {"granted": False, "reason": "missing", "error_type": "FileNotFoundError"},
    )
    client = TestClient(create_app(store=Store(tmp_path / "api.db"), use_default_static=False))
    recheck = client.post("/disk-access/recheck", json={"path": "/etc/passwd"}).json()
    assert recheck["reason"] == "missing" and recheck["relaunch_required"] is False
    assert recheck["settings_url"] == disk_access.SETTINGS_URL
    opened = client.post("/disk-access/open-settings", json={"url": "https://evil.example"}).json()
    assert opened["opened"] is True and opened["url"] == disk_access.SETTINGS_URL
    revealed = client.post("/disk-access/reveal", json={"path": "/etc/passwd"}).json()
    assert revealed["revealed"] is True
    assert ["/usr/bin/open", disk_access.SETTINGS_URL] in calls
    assert ["/usr/bin/open", "-R", str(bundle)] in calls
    assert all("evil.example" not in " ".join(cmd) and "passwd" not in " ".join(cmd) for cmd in calls)


def test_launcher_probe_flag_prints_status_only(monkeypatch, tmp_path, capsys):
    path = tmp_path / "chat.db"
    path.write_bytes(SECRET)
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(path))
    spec = importlib.util.spec_from_file_location(
        "ps_launcher_probe",
        Path(__file__).resolve().parents[1] / "packaging" / "macos" / "launcher.py",
    )
    assert spec is not None and spec.loader is not None
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)
    assert launcher.main(["--ps-probe-disk"]) == 0
    out = capsys.readouterr().out.strip()
    assert "MSGSECRET" not in out
    assert json.loads(out)["granted"] is True
