from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import jsonschema
import pytest

from psychosight import config, pipeline, report
from psychosight.errors import LLMOptInRequired, ReportInvalid
from psychosight.storage import Store

SCHEMA = json.loads(config.SCHEMA_PATH.read_text())


def check(rep):
    jsonschema.Draft202012Validator(SCHEMA, format_checker=jsonschema.FormatChecker()).validate(rep)


def test_demo_full_mode_validates_and_records_opt_in(tmp_path):
    stages = []
    rep = pipeline.run_analysis("demo", llm_opt_in=True, store=Store(tmp_path / "p.db"),
                                progress=lambda s, c, t: stages.append(s))
    check(rep)
    assert rep["mode"] == "full" and rep["run_meta"]["llm_opt_in"] is True
    assert rep["run_meta"]["provider"] == "mock" and rep["run_meta"]["model"] == "mock-rubric-1"
    assert rep["rubric"]["status"] == "ok" and rep["rubric"]["scored_speaker"] == "me"
    assert 30 <= rep["header"]["episodes_scored"] <= 40
    assert 3 <= len(rep["observations"]["items"]) <= 5
    assert "assigns_fault_to_other" in rep["rubric"]["unstable_items"]
    assert [s for i, s in enumerate(stages) if i == 0 or stages[i - 1] != s] == list(pipeline.STAGES)
    quote_ids = {q["quote_id"] for q in rep["quotes"]}
    for it in rep["rubric"]["items"]:
        assert set(it["quote_ids"]) <= quote_ids
    for o in rep["observations"]["items"]:
        assert o["text"].startswith(f"In this conversation, in the {rep['header']['episodes_scored']} episodes reviewed, ")


def test_demo_deterministic_only_validates(tmp_path):
    rep = pipeline.run_analysis("demo", llm_opt_in=False, store=Store(tmp_path / "p.db"))
    check(rep)
    assert rep["mode"] == "deterministic_only" and rep["run_meta"]["llm_opt_in"] is False
    assert rep["rubric"]["status"] == "not_run" and rep["rubric"]["reason"]
    assert rep["observations"]["status"] == "not_run" and rep["observations"]["reason"]
    assert rep["quotes"] == [] and rep["run_meta"]["llm_calls"] == 0 and rep["run_meta"]["provider"] is None
    assert not any(e["scored"] for e in rep["episodes"])


def test_full_mode_requires_opt_in(tmp_path):
    with pytest.raises(LLMOptInRequired):
        pipeline.run_analysis("demo", llm_opt_in=False, mode="full", store=Store(tmp_path / "p.db"))


def test_second_run_hits_cache(tmp_path):
    store = Store(tmp_path / "p.db")
    first = pipeline.run_analysis("demo", llm_opt_in=True, store=store)
    second = pipeline.run_analysis("demo", llm_opt_in=True, store=store)
    # (identical episode texts can already hit within the first run: the key is the content hash)
    assert first["run_meta"]["cache_misses"] > 0
    assert second["run_meta"]["cache_misses"] == 0
    assert second["run_meta"]["cache_hits"] == first["run_meta"]["cache_hits"] + first["run_meta"]["cache_misses"]
    assert second["run_meta"]["llm_calls"] == 1  # synthesis only
    assert second["rubric"]["items"] == first["rubric"]["items"]


def test_thin_conversation_insufficient_data_end_to_end(tmp_path):
    rep = pipeline.run_analysis("demo", llm_opt_in=True, date_from=date(2025, 8, 7), date_to=date(2025, 8, 7),
                                store=Store(tmp_path / "p.db"))
    check(rep)
    absol = next(f for f in rep["series"] if f["key"] == "absolutist_pct")
    assert absol["overall"]["me"]["value"] is None and absol["overall"]["me"]["reason"] == "insufficient data"
    assert rep["rubric"]["status"] == "insufficient_data"
    # Only feature-based observations (e.g. reply times with enough replies) can remain; none cite rubric items.
    assert all(not o["item_keys"] for o in rep["observations"]["items"])
    assert all(o["confidence"] == "low" for o in rep["observations"]["items"])


def test_report_saved_and_deleted(tmp_path):
    store = Store(tmp_path / "p.db")
    rep = pipeline.run_analysis("demo", llm_opt_in=True, store=store, report_id="r1")
    assert store.get_report("r1")["report_id"] == "r1"
    assert store.list_reports()[0]["job_id"] == "r1"
    assert store.delete_report("r1") is True
    assert store.get_report("r1") is None and store.delete_report("r1") is False
    raw = (tmp_path / "p.db").read_bytes()
    for q in rep["quotes"]:
        assert q["text"].encode() not in raw
    assert store._conn.execute("SELECT COUNT(*) FROM episodes").fetchone()[0] == 0


def test_invalid_report_is_hard_error():
    with pytest.raises(ReportInvalid):
        report.validate({"schema_version": "1.0.0"})


def test_regenerated_samples_match_schema():
    for name in ("sample_report.json", "sample_report_deterministic_only.json"):
        check(json.loads((config.REPO_ROOT / "docs" / name).read_text()))
