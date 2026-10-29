"""GET /conversations bounds + paging + q search; POST /analyses date-range validation and clamping (offline)."""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from psychosight import loader
from psychosight.app import create_app
from psychosight.errors import DateRangeInvalid, DateRangeOutOfBounds
from psychosight.storage import Store
from tests.helpers import make_chat_db
from tests.test_api import wait_done
from tests.test_pipeline_report import check

T0 = datetime(2025, 3, 1, 15, 0, tzinfo=timezone.utc)


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(store=Store(tmp_path / "api.db"), use_default_static=False))


@pytest.fixture
def chat_db(tmp_path, monkeypatch):
    chats = [
        # chat 1: oldest activity, spans 2025-03-01 .. 2025-03-20
        (["+15550001"], [(T0, False, "+15550001", "hello there"), (T0 + timedelta(days=19), True, None, "bye")]),
        # chat 2: most recent, 2025-06-01 .. 2025-06-02
        (["alice@example.com"], [(T0 + timedelta(days=92), True, None, "hi alice"),
                                  (T0 + timedelta(days=93), False, "alice@example.com", "hi")]),
        # chat 3: group, middle activity
        (["+15550002", "+15550003"], [(T0 + timedelta(days=40), False, "+15550002", "group hi")]),
        # chat 4: 1:1, single message
        (["+15550004"], [(T0 + timedelta(days=50), False, "+15550004", "one")]),
    ]
    db = make_chat_db(tmp_path / "chat.db", chats)
    conn = sqlite3.connect(db)
    conn.execute("UPDATE chat SET display_name = 'Bob Smith' WHERE ROWID = 1")
    conn.commit()
    conn.close()
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(db))
    return db


def _local(dt: datetime) -> datetime:
    return dt.astimezone()


def test_conversation_items_have_tz_aware_bounds(client, chat_db):
    body = client.get("/conversations").json()
    by_id = {c["id"]: c for c in body["conversations"]}
    one = by_id["1"]
    first, last = datetime.fromisoformat(one["first_message_at"]), datetime.fromisoformat(one["last_message_at"])
    assert first.tzinfo is not None and last.tzinfo is not None
    assert first == T0 and last == T0 + timedelta(days=19)
    assert one["first_message_date"] == _local(T0).date().isoformat()
    assert one["last_message_date"] == _local(T0 + timedelta(days=19)).date().isoformat()
    assert one["message_count"] == 2 and one["latest_date"] == one["last_message_at"]
    single = by_id["4"]
    assert single["first_message_at"] == single["last_message_at"] and single["message_count"] == 1
    demo = by_id["demo"]
    msgs = loader._demo_msgs()
    assert demo["first_message_at"] == msgs[0].ts.isoformat() and demo["last_message_at"] == msgs[-1].ts.isoformat()
    assert datetime.fromisoformat(demo["first_message_at"]).tzinfo is not None
    assert demo["first_message_date"] == msgs[0].ts.date().isoformat() and demo["message_count"] == len(msgs)


def test_unpaged_response_is_backward_compatible(client, chat_db):
    res = client.get("/conversations")
    body = res.json()
    ids = [c["id"] for c in body["conversations"]]
    # demo first, then most recent activity first (existing order), group listed but unsupported
    assert ids == ["demo", "2", "4", "3", "1"]
    assert body["chat_db"] == {"available": True, "error": None}
    assert body["total"] == 5 and body["limit"] is None and body["offset"] == 0 and body["q"] is None
    assert res.headers["X-Total-Count"] == "5"


def test_paging_limit_offset(client, chat_db):
    full = [c["id"] for c in client.get("/conversations").json()["conversations"]]
    p1 = client.get("/conversations?limit=2&offset=0").json()
    p2 = client.get("/conversations?limit=2&offset=2").json()
    p3 = client.get("/conversations?limit=2&offset=4").json()
    assert [c["id"] for c in p1["conversations"] + p2["conversations"] + p3["conversations"]] == full
    assert (p1["total"], p1["limit"], p1["offset"]) == (5, 2, 0)
    assert len(p3["conversations"]) == 1
    beyond = client.get("/conversations?offset=99").json()
    assert beyond["conversations"] == [] and beyond["total"] == 5 and beyond["limit"] == 50


@pytest.mark.parametrize("q,expected", [
    ("bob", ["1"]), ("BOB SM", ["1"]), ("+1555000", ["4", "3", "1"]), ("ALICE@", ["2"]),
    ("demo", ["demo"]), ("synthetic", ["demo"]), ("nobody-matches", []), ("   ", ["demo", "2", "4", "3", "1"]),
])
def test_q_search_name_and_handle(client, chat_db, q, expected):
    body = client.get("/conversations", params={"q": q, "limit": 200}).json()
    assert [c["id"] for c in body["conversations"]] == expected and body["total"] == len(expected)


@pytest.mark.parametrize("query", ["limit=0", "limit=201", "limit=-1", "offset=-1", "limit=abc", "offset=x",
                                   "q=" + "a" * 201])
def test_paging_param_errors(client, chat_db, query):
    res = client.get(f"/conversations?{query}")
    assert res.status_code == 422 and res.json()["error"]["code"] == "INVALID_REQUEST"


def test_fda_missing_still_pages_demo(client, tmp_path, monkeypatch):
    monkeypatch.setenv("PSYCHOSIGHT_CHAT_DB", str(tmp_path / "missing" / "chat.db"))
    body = client.get("/conversations?limit=1").json()
    assert [c["id"] for c in body["conversations"]] == ["demo"] and body["total"] == 1
    assert body["chat_db"]["available"] is False
    assert client.get("/conversations?q=zzz").json()["total"] == 0


def test_resolve_date_range_rules():
    first, last = datetime(2025, 3, 1, 12, tzinfo=timezone.utc), datetime(2025, 3, 20, 12, tzinfo=timezone.utc)
    lo, hi = first.date(), last.date()
    assert loader.resolve_date_range(None, None, first, last) == (None, None, None)
    assert loader.resolve_date_range(lo, hi, first, last) == (lo, hi, None)
    f, t, info = loader.resolve_date_range(date(2025, 1, 1), date(2025, 3, 5), first, last)
    assert (f, t) == (lo, date(2025, 3, 5))
    assert info == {"requested": {"date_from": "2025-01-01", "date_to": "2025-03-05"},
                    "applied": {"date_from": lo.isoformat(), "date_to": "2025-03-05"},
                    "bounds": {"date_from": lo.isoformat(), "date_to": hi.isoformat()}}
    f, t, info = loader.resolve_date_range(None, date(2026, 1, 1), first, last)
    assert (f, t) == (None, hi) and info["applied"] == {"date_from": None, "date_to": hi.isoformat()}
    with pytest.raises(DateRangeOutOfBounds) as exc:
        loader.resolve_date_range(date(2026, 1, 1), None, first, last)
    assert lo.isoformat() in exc.value.message and hi.isoformat() in exc.value.message
    with pytest.raises(DateRangeOutOfBounds):
        loader.resolve_date_range(date(2024, 1, 1), date(2024, 12, 31), first, last)
    with pytest.raises(DateRangeInvalid):
        loader.resolve_date_range(date(2025, 3, 10), date(2025, 3, 2), first, last)
    # no bounds (no dated messages): unchanged
    assert loader.resolve_date_range(date(2020, 1, 1), None, None, None) == (date(2020, 1, 1), None, None)


def test_post_analyses_out_of_bounds_and_invalid(client, chat_db):
    demo = client.get("/conversations?q=demo").json()["conversations"][0]
    r = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": False,
                                       "date_from": "1999-01-01", "date_to": "1999-02-01"})
    err = r.json()["error"]
    assert r.status_code == 422 and err["code"] == "DATE_RANGE_OUT_OF_BOUNDS"
    assert demo["first_message_date"] in err["message"] and demo["last_message_date"] in err["message"]
    r = client.post("/analyses", json={"conversation_id": "1", "llm_opt_in": False, "date_from": "2030-01-01"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "DATE_RANGE_OUT_OF_BOUNDS"
    r = client.post("/analyses", json={"conversation_id": "1", "llm_opt_in": False,
                                       "date_from": "2025-03-10", "date_to": "2025-03-02"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "DATE_RANGE_INVALID"
    # group / unknown checks still win over the date range
    r = client.post("/analyses", json={"conversation_id": "3", "llm_opt_in": False, "date_from": "2030-01-01"})
    assert r.json()["error"]["code"] == "GROUP_CHAT_UNSUPPORTED"


def test_post_analyses_clamps_and_records_in_run_meta(client, chat_db):
    one = {c["id"]: c for c in client.get("/conversations").json()["conversations"]}["1"]
    job = client.post("/analyses", json={"conversation_id": "1", "llm_opt_in": False,
                                         "date_from": "2024-01-01", "date_to": "2099-12-31"}).json()["job_id"]
    st, _ = wait_done(client, job)
    assert st["status"] == "done"
    rep = client.get(f"/analyses/{job}/report").json()
    check(rep)
    clamp = rep["run_meta"]["date_range_clamped"]
    assert clamp["requested"] == {"date_from": "2024-01-01", "date_to": "2099-12-31"}
    assert clamp["applied"] == clamp["bounds"] == {"date_from": one["first_message_date"],
                                                   "date_to": one["last_message_date"]}
    assert rep["header"]["requested_range"] == clamp["requested"]

    job = client.post("/analyses", json={"conversation_id": "1", "llm_opt_in": False}).json()["job_id"]
    wait_done(client, job)
    rep = client.get(f"/analyses/{job}/report").json()
    check(rep)
    assert rep["run_meta"]["date_range_clamped"] is None


def test_demo_clamps_the_same_way(client):
    demo = client.get("/conversations").json()["conversations"][0]
    job = client.post("/analyses", json={"conversation_id": "demo", "llm_opt_in": False,
                                         "experimental_scores": False, "date_from": "2000-01-01",
                                         "date_to": demo["first_message_date"]}).json()["job_id"]
    st, _ = wait_done(client, job, timeout=60)
    assert st["status"] == "done"
    rep = client.get(f"/analyses/{job}/report").json()
    check(rep)
    assert rep["run_meta"]["date_range_clamped"]["applied"] == {
        "date_from": demo["first_message_date"], "date_to": demo["first_message_date"]}
    assert rep["header"]["date_from"] == demo["first_message_date"]
