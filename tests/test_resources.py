"""Bundle paths stay independent of the process working directory."""

from __future__ import annotations

import socket
from pathlib import Path

from psychosight import config
from psychosight.experimental import lexicons
from psychosight.resources import package_dir, pick_loopback_port


def test_package_data_is_next_to_the_package():
    root = package_dir()
    assert (root / "data" / "demo_conversation.jsonl").is_file()
    assert (root / "experimental" / "wwbp" / "bigfive_lexicon.json").is_file()
    assert (root / "experimental" / "data" / "exp_anchors_v1.json").is_file()
    assert lexicons.WWBP_DIR == root / "experimental" / "wwbp"
    assert config.SCHEMA_PATH.is_file()


def test_static_dir_ignores_cwd(tmp_path, monkeypatch):
    monkeypatch.delenv("PSYCHOSIGHT_STATIC_DIR", raising=False)
    root = tmp_path / "repo"
    dist = root / "web" / "dist"
    dist.mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>PsychoSight</title>", encoding="utf-8")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.setattr(config, "REPO_ROOT", root)
    assert config.resource_root() == root
    assert config.static_dir() == dist


def test_frozen_bundle_serves_its_own_dist_and_skips_bundled_dotenv(tmp_path, monkeypatch):
    monkeypatch.delenv("PSYCHOSIGHT_STATIC_DIR", raising=False)
    monkeypatch.delenv("PSYCHOSIGHT_DOTENV", raising=False)
    bundle = tmp_path / "bundle"
    dist = bundle / "web" / "dist"
    dist.mkdir(parents=True)
    (dist / "index.html").write_text("ok", encoding="utf-8")
    (bundle / ".env").write_text("DEEPSEEK_API_KEY=sk-should-not-be-read\n", encoding="utf-8")
    elsewhere = tmp_path / "cwd"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.setattr(config.sys, "frozen", True, raising=False)
    monkeypatch.setattr(config.sys, "_MEIPASS", str(bundle), raising=False)
    assert config.resource_root() == bundle
    assert config.static_dir() == dist
    assert config.dotenv_paths() == [Path.home() / ".psychosight" / ".env"]
    assert config.unbuilt_ui_hint() is None


def test_pick_loopback_port_skips_a_listener():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as held:
        held.bind(("127.0.0.1", 0))
        held.listen(1)
        busy = int(held.getsockname()[1])
        assert pick_loopback_port(busy) != busy
