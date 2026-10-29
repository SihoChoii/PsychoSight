from __future__ import annotations

import socket

import pytest


@pytest.fixture(autouse=True)
def _isolated_env(tmp_path, monkeypatch):
    """Every test: temp data dir, no real LLM credentials (no env key, no .env file), no network."""
    monkeypatch.setenv("PSYCHOSIGHT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(tmp_path / "no-chat.db"))
    for name in ("DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "DEEPSEEK_BASE_URL", "PSYCHOSIGHT_DEMO_PROVIDER"):
        monkeypatch.delenv(name, raising=False)
    # A developer's real .env (repo root or ~/.psychosight/.env) must never reach tests.
    monkeypatch.setenv("PSYCHOSIGHT_DOTENV", str(tmp_path / "no-such.env"))
    # The demo would use the real model whenever a key is configured; tests pin the offline mock.
    # Tests of the automatic choice delete this explicitly.
    monkeypatch.setenv("PSYCHOSIGHT_DEMO_PROVIDER", "mock")

    real_connect = socket.socket.connect

    def guarded(self, address):
        host = address[0] if isinstance(address, tuple) else address
        if host not in ("127.0.0.1", "localhost", "::1") and not str(host).startswith("/"):
            raise RuntimeError(f"network disabled in tests: {host}")
        return real_connect(self, address)

    monkeypatch.setattr(socket.socket, "connect", guarded)
    yield
