from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "schemas" / "report.schema.json").read_text())


def validator():
    jsonschema.Draft202012Validator.check_schema(SCHEMA)
    return jsonschema.Draft202012Validator(SCHEMA, format_checker=jsonschema.FormatChecker())


@pytest.mark.parametrize("name", ["sample_report.json", "sample_report_deterministic_only.json"])
def test_samples_validate(name):
    validator().validate(json.loads((ROOT / "docs" / name).read_text()))


def test_schema_rejects_zero_instead_of_null_reason():
    bad = json.loads((ROOT / "docs" / "sample_report.json").read_text())
    bad["series"][1]["points"][1]["me"] = {"value": None, "count": 3}
    assert list(validator().iter_errors(bad))


def test_deterministic_sample_marks_llm_sections_not_run():
    det = json.loads((ROOT / "docs" / "sample_report_deterministic_only.json").read_text())
    assert det["rubric"]["status"] == "not_run" and det["rubric"]["reason"]
    assert det["observations"]["status"] == "not_run" and det["observations"]["reason"]
    assert det["run_meta"]["llm_opt_in"] is False
