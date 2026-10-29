"""Packaged file locations and the loopback port the macOS app binds.

A frozen app resolves data from the bundle (``sys._MEIPASS``), never from the process working directory.
"""

from __future__ import annotations

import socket
import sys
from pathlib import Path
from typing import Optional


def frozen_root() -> Optional[Path]:
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(meipass)
    return None


def package_dir() -> Path:
    """Directory that contains ``data/`` and ``experimental/``."""
    frozen = frozen_root()
    if frozen is not None:
        return frozen / "psychosight"
    return Path(__file__).resolve().parent


def pick_loopback_port(preferred: int = 8765) -> int:
    """``preferred`` when nothing is accepting connections there, otherwise a free ephemeral port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.2)
        if probe.connect_ex(("127.0.0.1", preferred)) != 0:
            return preferred
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])
