"""Schema 1.1.0 sample, stored 1.0.0 reports, and experimental docs. Runnable before tracks A–D."""

from __future__ import annotations

import json
import re
from pathlib import Path

import jsonschema
import pytest
from fastapi.testclient import TestClient

from psychosight.app import create_app
from psychosight.experimental import contract, strings
from psychosight.safety import ALLOW_LIST, EXP_ALLOW_LIST, lint
from psychosight.storage import Store

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "schemas" / "report.schema.json").read_text())
SAMPLE_SECTION = json.loads((ROOT / "docs" / "sample_experimental_scores.json").read_text())
DESIGN = (ROOT / "docs" / "experimental" / "SCORES_DESIGN_v2.md").read_text()
SCORES_DOC = (ROOT / "docs" / "EXPERIMENTAL_SCORES.md").read_text()

# Named in design v2 section 15 as not independently verified. They must not be cited as evidence.
_UNVERIFIED_NAMES = ("Raskin", "Krizan", "Casale", "Vazire")


def _validator(schema=None):
    schema = SCHEMA if schema is None else schema
    return jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())


def _section_validator():
    sub = {"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"], "$ref": "#/$defs/experimentalScores"}
    return _validator(sub)


def _report_with_section():
    report = json.loads((ROOT / "docs" / "sample_report.json").read_text())
    report["schema_version"] = "1.1.0"
    report["experimental_scores"] = SAMPLE_SECTION
    report["run_meta"].update({
        "experimental_opt_in": True,
        "score_other_opt_in": True,
        "experimental_scoring_version": "exp-scores-v1",
        "experimental_prompt_versions": {"episode": "traits-exp-v1", "holistic": "exp-holistic-v1"},
        "experimental_llm_calls": 84,
        "experimental_cache_hits": 0,
    })
    return report


def _walk_keys(node):
    if isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from _walk_keys(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk_keys(value)


def _ref_name(ref: str):
    if isinstance(ref, str) and ref.startswith("#/$defs/"):
        return ref.rsplit("/", 1)[-1]
    return None


def _walk_experimental_schema_keys(node, seen_refs=None):
    """Property names under the experimental section, following exp* $refs once."""
    seen_refs = seen_refs if seen_refs is not None else set()
    if isinstance(node, dict):
        ref = _ref_name(node.get("$ref"))
        if ref and (ref.startswith("exp") or ref == "experimentalScores") and ref not in seen_refs:
            seen_refs.add(ref)
            yield from _walk_experimental_schema_keys(SCHEMA["$defs"][ref], seen_refs)
        for key, value in node.items():
            if key != "$ref":
                yield key
            yield from _walk_experimental_schema_keys(value, seen_refs)
    elif isinstance(node, list):
        for value in node:
            yield from _walk_experimental_schema_keys(value, seen_refs)


def _ids(text: str):
    dois = [item.rstrip(".,;:)>]") for item in re.findall(r"10\.\d{4,9}/\S+", text)]
    pmcs = re.findall(r"PMC\d+", text)
    return dois, pmcs


def _section(text: str, heading: str) -> str:
    """Slice a markdown section. README uses ### under the backend heading; the docs use ##."""
    for hashes in ("###", "##"):
        marker = f"{hashes} {heading}\n"
        start = text.find(marker)
        if start == -1:
            continue
        rest = text[start + len(marker):]
        stops = []
        for prefix in ("\n## ", "\n### "):
            if hashes == "##" and prefix == "\n### ":
                continue
            found = rest.find(prefix)
            if found != -1:
                stops.append(found)
        return rest[:min(stops)] if stops else rest
    raise AssertionError(heading)


def _strip_for_doc_lint(text: str) -> str:
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"`[^`]+`", " ", text)
    for allowed in sorted(list(EXP_ALLOW_LIST) + list(ALLOW_LIST), key=len, reverse=True):
        text = text.replace(allowed, " ")
    return text


def test_sample_section_validates_alone_and_inside_a_report():
    _section_validator().validate(SAMPLE_SECTION)
    _validator().validate(_report_with_section())
    assert [d["key"] for d in SAMPLE_SECTION["dimensions"]] == list(contract.DIMENSION_KEYS)


@pytest.mark.parametrize("name", ["sample_report.json", "sample_report_deterministic_only.json"])
def test_v1_reports_still_validate(name):
    report = json.loads((ROOT / "docs" / name).read_text())
    assert report["schema_version"] == "1.0.0"
    assert "experimental_scores" not in report
    _validator().validate(report)


def test_forbidden_keys_absent_from_sample_and_schema():
    for key in _walk_keys(SAMPLE_SECTION):
        assert key not in contract.FORBIDDEN_KEYS
    for key in _walk_experimental_schema_keys(SCHEMA["properties"]["experimental_scores"]):
        assert key not in contract.FORBIDDEN_KEYS, key


def test_v1_stored_report_still_loads(tmp_path):
    report = json.loads((ROOT / "docs" / "sample_report.json").read_text())
    assert report["schema_version"] == "1.0.0"
    store = Store(tmp_path / "p.db")
    store.save_report(report)
    loaded = store.get_report(report["report_id"])
    assert loaded["schema_version"] == "1.0.0"
    assert "experimental_scores" not in loaded
    assert loaded["report_id"] == report["report_id"]
    _validator().validate(loaded)

    client = TestClient(create_app(store=store, use_default_static=False))
    response = client.get(f"/analyses/{report['report_id']}/report")
    assert response.status_code == 200
    body = response.json()
    assert body["schema_version"] == "1.0.0"
    assert "experimental_scores" not in body
    assert body["quotes"] == report["quotes"]


def test_scores_doc_covers_validity_evidence_and_checked_citations_only():
    lowered = SCORES_DOC.lower()
    for phrase in (
        "not validated",
        "not a diagnosis",
        "imessage",
        "forer 1949",
        "barnum",
        "cc by-nc-sa",
        "liwc",
        "nrc",
        "engineering anchor",
        "1.63",
        "2.92",
        "10.76",
        "12.17",
        "very weak",
        "non-commercial",
        "not calibrated",
    ):
        assert phrase in lowered, phrase
    assert strings.BANNER in SCORES_DOC

    def _flat(text: str) -> str:
        return re.sub(r"\s+", " ", text.replace(">", " ")).strip()

    assert _flat(strings.HOW_IT_WORKS) in _flat(SCORES_DOC)
    for key in contract.DIMENSION_KEYS:
        assert key in SCORES_DOC
    dois, pmcs = _ids(SCORES_DOC)
    design_dois, design_pmcs = _ids(DESIGN)
    assert dois, "expected citations"
    unknown = [item for item in dois if item not in design_dois]
    assert unknown == [], unknown
    assert [item for item in pmcs if item not in design_pmcs] == []
    for name in _UNVERIFIED_NAMES:
        assert name not in SCORES_DOC


def test_readme_api_and_schema_sections_respect_the_global_lint():
    readme = _section((ROOT / "README.md").read_text(), "Experimental scores")
    api = _section((ROOT / "docs" / "API.md").read_text(), "Experimental scores")
    schema_doc = _section((ROOT / "docs" / "REPORT_SCHEMA.md").read_text(), "experimental_scores (schema 1.1.0, optional)")
    for label, text in (("readme", readme), ("api", api), ("schema", schema_doc)):
        hits = lint(_strip_for_doc_lint(text))
        assert hits == [], (label, hits)
    assert "EXPERIMENTAL_CONSENT_REQUIRED" in api
    assert "experimental_scores" in schema_doc
    assert "1.0.0" in schema_doc and "1.1.0" in schema_doc
