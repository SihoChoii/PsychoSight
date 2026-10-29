"""Nothing key-related is ever committed: no key-shaped strings in tracked files, bundled paths git-ignored."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]

KEY_SHAPE = re.compile(r"sk-[A-Za-z0-9]{20,}")
# Known fake key-shaped strings that are allowed in tracked files (exact matches only).
ALLOWED_KEY_SHAPES = {
    "sk-abcdefghijklmnop1234",  # tests/test_llm.py::test_mask_key
}
ASSIGNMENT = re.compile(r"DEEPSEEK_API_KEY\s*=\s*['\"]?([^\s'\"\\)]*)")
PLACEHOLDERS = {"", "your-key-here"}


def _allowed_assignment(value: str) -> bool:
    if value in PLACEHOLDERS:
        return True
    if "FAKE" in value or "fake" in value:  # test fixtures are always marked FAKE
        return True
    if value[0] in "${<.…" or "…" in value or "..." in value:  # interpolation, placeholders, masked forms
        return True
    return False


def _git(*args) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, timeout=30)


def _tracked_files() -> list:
    if shutil.which("git") is None:
        pytest.skip("git not installed")
    res = _git("ls-files", "-z")
    if res.returncode != 0:
        pytest.skip("not a git checkout")
    return [REPO / p for p in res.stdout.split("\0") if p]


def test_no_key_shaped_strings_in_tracked_files():
    hits = []
    for path in _tracked_files():
        try:
            if not path.is_file() or path.stat().st_size > 5_000_000:
                continue
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue  # binary
        rel = path.relative_to(REPO)
        for lineno, line in enumerate(text.splitlines(), 1):
            for m in KEY_SHAPE.finditer(line):
                if m.group(0) not in ALLOWED_KEY_SHAPES:
                    hits.append(f"{rel}:{lineno}: key-shaped string {m.group(0)[:5]}…")
            for m in ASSIGNMENT.finditer(line):
                if not _allowed_assignment(m.group(1)):
                    hits.append(f"{rel}:{lineno}: DEEPSEEK_API_KEY= with a non-placeholder value")
    assert not hits, "possible secrets in tracked files:\n" + "\n".join(hits)


def test_placeholder_env_example_is_tracked_and_real_env_files_are_not():
    tracked = {str(p.relative_to(REPO)) for p in _tracked_files()}
    assert ".env.example" in tracked
    assert not any(Path(t).name == "psychosight.env" or Path(t).name == ".env" or
                   (Path(t).name.startswith(".env.") and Path(t).name != ".env.example") for t in tracked)
    assert "your-key-here" in (REPO / ".env.example").read_text(encoding="utf-8")


@pytest.mark.parametrize("rel", [
    ".env",
    ".env.local",
    ".env.production",
    "psychosight/_bundled/psychosight.env",
    "psychosight/psychosight.env",
    "psychosight.env",
    "dist/PsychoSight.app/Contents/Resources/psychosight.env",
    "PsychoSight.app/Contents/Resources/psychosight.env",
    "build/PsychoSight.app/Contents/Resources/psychosight.env",
])
def test_bundled_and_env_paths_are_gitignored(rel):
    _tracked_files()  # skips outside a git checkout
    res = _git("check-ignore", "-q", "--no-index", rel)
    assert res.returncode == 0, f"{rel} is not git-ignored"


def test_env_example_is_not_gitignored():
    _tracked_files()
    assert _git("check-ignore", "-q", "--no-index", ".env.example").returncode == 1
