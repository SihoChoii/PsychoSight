from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import httpx
import pytest

from psychosight import config, features, loader, pipeline, rubric, safety, synthesize
from psychosight.llm import DeepSeekProvider
from psychosight.mock_provider import MockProvider
from psychosight.storage import Store
from tests.test_llm import settings

ROOT = config.REPO_ROOT
SENTINEL = "REASONING-SENTINEL-7f3a"


# ---------- banned-terms lint ----------
def test_lint_catches_banned_and_generalizations():
    assert safety.lint("This suggests a clinical elevation")
    assert safety.lint("possible narcissism and impulsivity")
    assert safety.lint("an anxious attachment style")
    assert safety.lint("BiAffect entropy of replies")
    assert safety.lint("absolutist rate above 1.40% means relapse")
    for phrase in ("I always reply", "they never apologize", "he is the type of person", "she tends to be distant"):
        assert safety.lint(phrase, observation=True), phrase
        assert safety.lint(phrase, generalization=True), phrase
    assert safety.lint("my rate is above average", observation=True)
    assert safety.lint("I reply fast because I care", observation=True)
    assert not safety.lint("In this conversation, in the 40 episodes reviewed, I opened 21 episodes.", observation=True)


def test_allow_list_for_fixed_disclaimer_and_limitations():
    assert safety.lint(config.LIMITATIONS[0].replace("This is not", "This is"))  # would be flagged...
    assert not safety.lint(config.LIMITATIONS[0])  # ...but the fixed text is allow-listed
    assert not safety.lint(config.DISCLAIMER)
    assert "diagnosis" in config.LIMITATIONS[0]


def test_attachment_code_identifier_out_of_scope():
    assert not safety.lint("message attachments are skipped")


def test_prompts_are_clean():
    for prompt in (rubric.SYSTEM_PROMPT, synthesize.SYSTEM_PROMPT):
        assert safety.lint(prompt, generalization=True) == []


def test_schema_descriptions_and_copy_are_clean():
    schema = json.loads(config.SCHEMA_PATH.read_text())
    for text in safety.schema_strings(schema):
        assert safety.lint(text, generalization=True) == [], text
    copy = [config.OPT_IN_TEXT, config.NOT_RUN_REASON]
    for it in rubric.ITEMS:
        copy += [it.label, it.description] + list(it.anchors.values())
    for key, label, unit, cu, desc, *_ in features.FEATURE_DEFS:
        copy += [label, unit, desc]
    for text in copy:
        assert safety.lint(text, generalization=True) == [], text


def test_rubric_items_are_observable_behaviors_about_me():
    assert 4 <= len(rubric.ITEMS) <= 6
    assert rubric.ITEMS_BY_KEY["assigns_fault_to_other"].label == "Statements assigning fault to the other person"
    assert rubric.SCORED_SPEAKER == "me"


def test_demo_report_copy_is_clean(tmp_path):
    rep = pipeline.run_analysis("demo", llm_opt_in=True, store=Store(tmp_path / "s.db"))
    for o in rep["observations"]["items"]:
        assert safety.lint(o["text"], observation=True) == [], o["text"]
    for section in ("rubric",):
        for it in rep[section]["items"]:
            assert safety.lint(it["label"] + " " + it["description"], generalization=True) == []
    # No verdict/norm labels anywhere in the report keys or values.
    dump = json.dumps({k: v for k, v in rep.items() if k not in ("quotes", "observations", "limitations")}).lower()
    for word in ("above average", "below average", "t-score", "clinical elevation", "normal range"):
        assert word not in dump


def test_no_forbidden_models_in_code():
    for path in (ROOT / "psychosight").glob("*.py"):
        if path.name in ("safety.py", "msgexport.py"):
            continue
        text = path.read_text().lower()
        for word in ("biaffect", "kalman", "entropy", "t-score", "1.40"):
            assert word not in text, (path.name, word)


# ---------- no message bodies in logs (incl. provider response path) ----------
def demo_texts():
    return sorted({m.text for m in loader.load_demo().msgs if len(m.text) >= 15})


def deepseek_transport(reasoning_msg: str):
    mock = MockProvider()

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        system, user = body["messages"][0]["content"], body["messages"][1]["content"]
        out = mock._synthesis(user) if system.startswith("TASK: SYNTHESIS") else mock._rubric(user, 0)
        return httpx.Response(200, json={"choices": [{"message": {
            "role": "assistant", "content": json.dumps(out),
            "reasoning_content": f"{SENTINEL} the user wrote: {reasoning_msg}"}}],
            "usage": {"total_tokens": 42}})

    return httpx.MockTransport(handler)


def test_no_bodies_or_reasoning_in_logs_or_db(tmp_path, caplog, capsys):
    caplog.set_level(logging.DEBUG)
    texts = demo_texts()
    reasoning_msg = texts[0]
    provider = DeepSeekProvider(settings(), transport=deepseek_transport(reasoning_msg))
    db = tmp_path / "s.db"
    store = Store(db)
    rep = pipeline.run_analysis("demo", llm_opt_in=True, store=store, provider=provider)
    assert rep["run_meta"]["provider"] == "deepseek" and rep["rubric"]["status"] == "ok"
    # Det-only run too, plus a malformed-output path.
    pipeline.run_analysis("demo", llm_opt_in=False, store=store)
    rubric.score_episodes(MockProvider(mode="always_malformed"), [], store, True)

    out = capsys.readouterr()
    logs = caplog.text + out.out + out.err
    assert SENTINEL not in logs
    for t in texts:
        assert t not in logs, t

    store.close()
    raw = db.read_bytes().decode("utf-8", "ignore")
    assert SENTINEL not in raw
    assert SENTINEL not in json.dumps(rep)
    # Only the reports table may contain quote text; cache/episodes/features hold none.
    import sqlite3
    conn = sqlite3.connect(db)
    non_report = " ".join(str(r) for tbl in ("llm_scores", "episodes", "features")
                          for r in conn.execute(f"SELECT * FROM {tbl}").fetchall())
    for t in texts:
        assert t not in non_report, t


def test_api_flow_logs_have_no_bodies(tmp_path, caplog):
    import time
    from fastapi.testclient import TestClient
    from psychosight.app import create_app
    caplog.set_level(logging.DEBUG)
    c = TestClient(create_app(store=Store(tmp_path / "a.db"), use_default_static=False))
    job = c.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": True}).json()["job_id"]
    for _ in range(500):
        if c.get(f"/analyses/{job}").json()["status"] in ("done", "error"):
            break
        time.sleep(0.02)
    assert c.get(f"/analyses/{job}/report").status_code == 200
    for t in demo_texts():
        assert t not in caplog.text
