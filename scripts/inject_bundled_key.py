#!/usr/bin/env python3
"""Build-time step: write the DeepSeek key into the packaged app's bundled psychosight.env.

Usage:
    python scripts/inject_bundled_key.py "dist/PsychoSight.app/Contents/Resources/psychosight.env"
    python scripts/inject_bundled_key.py DEST [--env-file PATH] [--allow-tracked]

The key comes from the DEEPSEEK_API_KEY environment variable, else from a git-ignored .env file
(default: the repo root .env; --env-file overrides). Optional settings copied when present:
DEEPSEEK_MODEL, DEEPSEEK_REASONING_EFFORT, DEEPSEEK_BASE_URL, DEEPSEEK_THINKING.

The key is never printed: only the destination and a masked form (sk-…1234). The file is created with
mode 600. Exit 1 when no key is found; exit 2 when DEST is inside this git checkout and not git-ignored.
See docs/PACKAGING_KEY.md.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, Mapping, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[1]
KEY_NAME = "DEEPSEEK_API_KEY"
OPTIONAL_NAMES = ("DEEPSEEK_MODEL", "DEEPSEEK_REASONING_EFFORT", "DEEPSEEK_BASE_URL", "DEEPSEEK_THINKING")
PLACEHOLDER_KEY = "your-key-here"


def parse_dotenv(text: str) -> Dict[str, str]:
    """Same KEY=VALUE format the backend reads (psychosight.config.parse_dotenv)."""
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    from psychosight.config import parse_dotenv as _parse

    return _parse(text)


def mask_key(key: Optional[str]) -> str:
    if not key:
        return "unset"
    return f"{key[:3]}…{key[-4:]}" if len(key) > 12 else "…"


def find_settings(env_file: Optional[Path] = None,
                  environ: Optional[Mapping[str, str]] = None) -> Tuple[Dict[str, str], str]:
    """(values, source_description). values has DEEPSEEK_API_KEY only when a real (non-placeholder) key was found.
    The environment wins over the file, per setting."""
    environ = os.environ if environ is None else environ
    env_file = Path(env_file) if env_file else REPO_ROOT / ".env"
    file_values: Dict[str, str] = {}
    try:
        file_values = parse_dotenv(env_file.read_text(encoding="utf-8"))
    except OSError:
        pass
    values: Dict[str, str] = {}
    source = ""
    env_key = (environ.get(KEY_NAME) or "").strip()
    file_key = (file_values.get(KEY_NAME) or "").strip()
    if env_key and env_key != PLACEHOLDER_KEY:
        values[KEY_NAME], source = env_key, f"the {KEY_NAME} environment variable"
    elif file_key and file_key != PLACEHOLDER_KEY:
        values[KEY_NAME], source = file_key, f"{env_file}"
    for name in OPTIONAL_NAMES:
        value = (environ.get(name) or "").strip() or (file_values.get(name) or "").strip()
        if value:
            values[name] = value
    return values, source


def render(values: Mapping[str, str]) -> str:
    lines = ["# PsychoSight bundled settings, written by scripts/inject_bundled_key.py at build time.",
             "# Temporary key for the packaged app only. Never commit this file. See docs/PACKAGING_KEY.md."]
    for name in (KEY_NAME,) + OPTIONAL_NAMES:
        if name in values:
            lines.append(f"{name}={values[name]}")
    return "\n".join(lines) + "\n"


def _inside_repo_and_tracked(dest: Path) -> bool:
    """True when dest is inside this git checkout and NOT git-ignored (so it could be committed)."""
    try:
        dest.resolve().relative_to(REPO_ROOT.resolve())
    except ValueError:
        return False
    try:
        res = subprocess.run(["git", "-C", str(REPO_ROOT), "check-ignore", "-q", "--no-index", str(dest.resolve())],
                             capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return False  # no git: nothing to commit into
    if res.returncode == 128:  # not a git checkout
        return False
    return res.returncode != 0


def write_bundle(dest: Path, values: Mapping[str, str]) -> Path:
    """Atomically write the bundled file with mode 600 (parent dirs created)."""
    dest = Path(dest).expanduser()
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".psychosight-env-", dir=str(dest.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(render(values))
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    os.chmod(dest, 0o600)
    return dest


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Write the DeepSeek key into the app bundle (never into git).")
    ap.add_argument("dest", help="e.g. dist/PsychoSight.app/Contents/Resources/psychosight.env")
    ap.add_argument("--env-file", default=None, help="git-ignored .env to read (default: repo root .env)")
    ap.add_argument("--allow-tracked", action="store_true",
                    help="allow a destination inside this checkout that is not git-ignored (not recommended)")
    args = ap.parse_args(argv)
    dest = Path(args.dest).expanduser()
    env_file = Path(args.env_file).expanduser() if args.env_file else None

    values, source = find_settings(env_file)
    if KEY_NAME not in values:
        searched = f"the {KEY_NAME} environment variable and {env_file or REPO_ROOT / '.env'}"
        print(f"error: no DeepSeek API key found (looked in {searched}). Put DEEPSEEK_API_KEY=... in the "
              f"git-ignored .env (cp .env.example .env) or export DEEPSEEK_API_KEY, then rerun.", file=sys.stderr)
        return 1
    if not args.allow_tracked and _inside_repo_and_tracked(dest):
        print(f"error: refusing to write the key to {dest}: it is inside the git checkout and not git-ignored. "
              f"Write it into the built .app (e.g. dist/PsychoSight.app/Contents/Resources/psychosight.env) or "
              f"psychosight/_bundled/psychosight.env.", file=sys.stderr)
        return 2
    written = write_bundle(dest, values)
    extras = ", ".join(n for n in OPTIONAL_NAMES if n in values) or "none"
    print(f"wrote {written} (mode 600): DEEPSEEK_API_KEY={mask_key(values[KEY_NAME])} from {source}; "
          f"other settings: {extras}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
