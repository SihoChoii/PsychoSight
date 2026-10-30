"""WWBP attribution when that data is present, and no NRC or LIWC dictionaries in the tree."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WWBP = ROOT / "psychosight" / "experimental" / "wwbp"
_SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", "dist", ".mypy_cache"}
_DATA_SUFFIXES = {".txt", ".tsv", ".csv", ".dic", ".json"}
_NAME_RE = re.compile(r"liwc|emolex|nrc", re.I)
_NRC_ROW = re.compile(
    r"(?im)^[a-z][a-z' -]{0,40}\t(?:anger|anticipation|disgust|fear|joy|sadness|surprise|trust|positive|negative)\t[01]\s*$"
)


def _files():
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        yield path


def _is_liwc_dictionary(text: str) -> bool:
    lowered = text.lower()
    if "linguistic inquiry and word count" in lowered and text.count("\n") > 100:
        return True
    if text.startswith("%") and "liwc" in lowered[:500] and text.count("\n") > 50:
        return True
    return False


def test_wwbp_data_ships_with_license_and_notice():
    """Absence is allowed: deleting wwbp/ must leave the app working. Data, if present, is attributed."""
    if not WWBP.exists():
        return
    data = [
        path for path in WWBP.rglob("*")
        if path.is_file()
        and path.suffix.lower() in {".json", ".tsv", ".csv"}
        and "license" not in path.name.lower()
    ]
    if not data:
        return
    license_path = WWBP / "LICENSE-CC-BY-NC-SA-3.0.txt"
    notice_path = WWBP / "NOTICE.md"
    assert license_path.is_file(), "WWBP data is present without LICENSE-CC-BY-NC-SA-3.0.txt"
    assert notice_path.is_file(), "WWBP data is present without NOTICE.md"
    blob = (license_path.read_text(encoding="utf-8", errors="ignore") + "\n"
            + notice_path.read_text(encoding="utf-8", errors="ignore")).lower()
    assert "by-nc-sa" in blob or "noncommercial" in blob or "non-commercial" in blob
    assert "non-commercial" in blob or "noncommercial" in blob
    assert "hackathon" in blob


def test_no_nrc_or_liwc_data_in_the_repo():
    hits = []
    for path in _files():
        if _NAME_RE.search(path.name) and path.suffix.lower() in _DATA_SUFFIXES | {".dic"}:
            hits.append(f"filename {path.relative_to(ROOT)}")
            continue
        if path.suffix.lower() not in _DATA_SUFFIXES | {".dic", ".py", ".md"}:
            continue
        # Prose may name the dictionaries in order to say we do not ship them.
        if path.suffix.lower() == ".md":
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if _is_liwc_dictionary(text) or len(_NRC_ROW.findall(text)) >= 20:
            hits.append(f"contents {path.relative_to(ROOT)}")
    assert hits == []
