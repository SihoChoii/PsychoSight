"""Full Disk Access probe for the Messages database.

macOS has no public API that presents a Full Disk Access prompt. Opening
``~/Library/Messages/chat.db`` read-only from the signed app is what adds
PsychoSight under Privacy & Security > Full Disk Access. A few bytes are read
so the open is a real one, then discarded. Those bytes are never logged,
returned, or written.
"""

from __future__ import annotations

import errno
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

from . import config

log = logging.getLogger("psychosight.disk_access")

SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
SETTINGS_URL_FALLBACK = "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles"
PROBE_BYTES = 16
_PROBE_REASONS = frozenset({"ok", "denied", "missing", "error"})

MSG_GRANTED = "Full Disk Access is on. Messages can be read."
MSG_RELAUNCH = (
    "Full Disk Access is on for a new PsychoSight process, but this one still cannot read Messages. "
    "Quit PsychoSight and open it again."
)
MSG_DENIED = (
    "PsychoSight still cannot read Messages. Turn on PsychoSight in Full Disk Access, then quit and reopen the app. "
    "If you just turned it on, macOS can keep the earlier denial until you relaunch."
)
MSG_MISSING = (
    "The Messages database is not there yet, so there is nothing to read. The demo conversation still works."
)


def probe_chat_db(path: Optional[Path] = None) -> dict:
    """Open ``path`` read-only and read a few bytes. Never logs those bytes."""
    db = Path(path) if path is not None else config.chat_db_path()
    fd = None
    try:
        fd = os.open(db, os.O_RDONLY)
        os.read(fd, PROBE_BYTES)
        return {"granted": True, "reason": "ok", "error_type": None}
    except OSError as exc:
        return _from_os_error(exc)
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass


def _from_os_error(exc: OSError) -> dict:
    error_type = type(exc).__name__
    if isinstance(exc, PermissionError) or exc.errno in (errno.EACCES, errno.EPERM):
        return {"granted": False, "reason": "denied", "error_type": error_type}
    if isinstance(exc, FileNotFoundError) or exc.errno == errno.ENOENT:
        return {"granted": False, "reason": "missing", "error_type": error_type}
    return {"granted": False, "reason": "error", "error_type": error_type}


def public_status(status: dict) -> dict:
    """Status safe to print. Drops anything other than granted, reason, and an error type name."""
    reason = status.get("reason")
    if reason not in _PROBE_REASONS:
        reason = "error"
    error_type = status.get("error_type")
    if error_type is not None:
        if not isinstance(error_type, str) or not error_type.isidentifier() or len(error_type) > 64:
            error_type = None
    return {"granted": bool(status.get("granted")), "reason": reason, "error_type": error_type}


def probe_log_line(status: dict) -> str:
    public = public_status(status)
    error_type = public["error_type"] or "none"
    granted = "true" if public["granted"] else "false"
    return f"disk access probe granted={granted} reason={public['reason']} error_type={error_type}"


def log_probe(status: dict) -> None:
    public = public_status(status)
    log.info(
        "disk access probe granted=%s reason=%s error_type=%s",
        public["granted"], public["reason"], public["error_type"] or "none",
    )


def probe_and_report() -> dict:
    try:
        result = probe_chat_db()
    except Exception as exc:  # noqa: BLE001 — keep the server up if the probe itself breaks
        result = {"granted": False, "reason": "error", "error_type": type(exc).__name__}
    log_probe(result)
    return result


def status_exit_code(status: dict) -> int:
    public = public_status(status)
    if public["granted"]:
        return 0
    if public["reason"] == "denied":
        return 1
    if public["reason"] == "missing":
        return 2
    return 3


def emit_status(status: dict) -> int:
    """Write the public status as one JSON line. A windowed app may have no stdout."""
    payload = json.dumps(public_status(status)) + "\n"
    stream = sys.stdout
    if stream is not None:
        try:
            stream.write(payload)
            stream.flush()
        except Exception:
            pass
    return status_exit_code(status)


def _probe_command() -> list:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--ps-probe-disk"]
    return [sys.executable, "-m", "psychosight", "probe-disk"]


def _child_env() -> dict:
    env = os.environ.copy()
    if not getattr(sys, "frozen", False):
        root = str(Path(__file__).resolve().parents[1])
        current = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = os.pathsep.join([root] + ([current] if current else []))
    return env


def _parse_status_output(stdout: Optional[str]) -> Optional[dict]:
    if not stdout:
        return None
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and "granted" in data:
            return public_status(data)
    return None


def _status_from_code(code: int) -> dict:
    if code == 0:
        return {"granted": True, "reason": "ok", "error_type": None}
    if code == 1:
        return {"granted": False, "reason": "denied", "error_type": None}
    if code == 2:
        return {"granted": False, "reason": "missing", "error_type": None}
    return {"granted": False, "reason": "error", "error_type": None}


def probe_fresh_process(timeout: float = 20.0) -> dict:
    """Probe in a new process. A new process can see a grant the current one cannot."""
    try:
        proc = subprocess.run(
            _probe_command(),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=_child_env(),
        )
    except subprocess.TimeoutExpired:
        return {"granted": False, "reason": "error", "error_type": "TimeoutExpired"}
    except OSError as exc:
        return {"granted": False, "reason": "error", "error_type": type(exc).__name__}
    parsed = _parse_status_output(proc.stdout)
    if parsed is not None:
        return parsed
    return _status_from_code(proc.returncode)


def recheck() -> dict:
    """Probe this process, then a fresh one if this process is still blocked."""
    current = probe_chat_db()
    log_probe(current)
    relaunch_required = False
    if current["granted"]:
        granted = True
        reason = "ok"
        message = MSG_GRANTED
    else:
        fresh = probe_fresh_process()
        fresh_public = public_status(fresh)
        log.info(
            "disk access fresh probe granted=%s reason=%s error_type=%s",
            fresh_public["granted"], fresh_public["reason"], fresh_public["error_type"] or "none",
        )
        if fresh_public["granted"]:
            relaunch_required = True
            granted = False
            reason = "relaunch_required"
            message = MSG_RELAUNCH
        elif current["reason"] == "missing" and fresh_public["reason"] == "missing":
            granted = False
            reason = "missing"
            message = MSG_MISSING
        else:
            granted = False
            reason = "denied"
            message = MSG_DENIED
    return {
        "granted": granted,
        "relaunch_required": relaunch_required,
        "reason": reason,
        "settings_url": SETTINGS_URL,
        "message": message,
    }


def _open_url(url: str) -> bool:
    if url not in (SETTINGS_URL, SETTINGS_URL_FALLBACK):
        return False
    try:
        proc = subprocess.run(
            ["/usr/bin/open", url],
            check=False,
            timeout=10,
            capture_output=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return proc.returncode == 0


def open_settings() -> dict:
    """Open the Full Disk Access pane. The URL is fixed; callers cannot pass one."""
    if sys.platform != "darwin":
        return {"opened": False, "url": SETTINGS_URL, "reason": "unsupported"}
    if _open_url(SETTINGS_URL):
        return {"opened": True, "url": SETTINGS_URL, "reason": None}
    if _open_url(SETTINGS_URL_FALLBACK):
        return {"opened": True, "url": SETTINGS_URL_FALLBACK, "reason": None}
    return {"opened": False, "url": SETTINGS_URL, "reason": "open_failed"}


def bundle_from_executable(executable: str) -> Optional[Path]:
    exe = Path(executable).resolve()
    if exe.parent.name != "MacOS" or exe.parent.parent.name != "Contents":
        return None
    if len(exe.parents) < 3:
        return None
    bundle = exe.parents[2]
    if bundle.suffix != ".app" or not bundle.is_dir():
        return None
    return bundle


def installed_app_candidates() -> list:
    return [
        Path("/Applications/PsychoSight.app"),
        Path.home() / "Applications" / "PsychoSight.app",
    ]


def app_bundle_path() -> Optional[Path]:
    if getattr(sys, "frozen", False):
        found = bundle_from_executable(sys.executable)
        if found is not None:
            return found
    for candidate in installed_app_candidates():
        if candidate.is_dir():
            return candidate
    return None


def reveal_app() -> dict:
    """Reveal PsychoSight.app in Finder so it can be dragged into Full Disk Access."""
    bundle = app_bundle_path()
    if bundle is None:
        return {"revealed": False, "reason": "not_bundled"}
    if sys.platform != "darwin":
        return {"revealed": False, "reason": "unsupported"}
    try:
        proc = subprocess.run(
            ["/usr/bin/open", "-R", str(bundle)],
            check=False,
            timeout=10,
            capture_output=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {"revealed": False, "reason": "open_failed"}
    if proc.returncode != 0:
        return {"revealed": False, "reason": "open_failed"}
    return {"revealed": True, "reason": None}
