"""Fail if a built app contains a real DeepSeek key or a bundled .env. Prints paths only."""

from __future__ import annotations

import sys
from pathlib import Path

NEEDLE = b"DEEPSEEK_API_KEY="
PLACEHOLDER = b"your-key-here"


def offending(path: Path) -> bool:
    if path.name == ".env" or (path.name.endswith(".env") and path.name != ".env.example"):
        return True
    try:
        data = path.read_bytes()
    except OSError:
        return False
    start = 0
    while True:
        found = data.find(NEEDLE, start)
        if found < 0:
            return False
        window = data[found:found + 120]
        if PLACEHOLDER not in window:
            return True
        start = found + len(NEEDLE)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: scan_bundle.py PsychoSight.app", file=sys.stderr)
        return 2
    app = Path(argv[1])
    if not app.is_dir():
        print(f"not a bundle: {app}", file=sys.stderr)
        return 2
    bad = [str(path.relative_to(app)) for path in app.rglob("*") if path.is_file() and offending(path)]
    if bad:
        print("refusing to ship: bundle contains a .env or a DEEPSEEK_API_KEY assignment", file=sys.stderr)
        for item in bad:
            print(item, file=sys.stderr)
        return 1
    print("secret scan ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
