from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from psychosight import loader, synthetic
from psychosight.errors import FullDiskAccessRequired, GroupChatUnsupported, NotFound
from tests.helpers import make_chat_db

FIXTURE = Path(__file__).parent / "fixtures" / "demo_messages.json"


def test_generator_is_deterministic_and_matches_fixture():
    a = synthetic.to_fixture(synthetic.generate_rows())
    assert a == synthetic.to_fixture(synthetic.generate_rows())
    assert a == json.loads(FIXTURE.read_text())


def test_demo_has_thin_weeks_injection_and_late_night():
    msgs = loader.load_demo().msgs
    assert any(m.text == synthetic.INJECTION_TEXT for m in msgs)
    assert any(1 <= m.ts.hour < 4 for m in msgs)
    weeks = {}
    for m in msgs:
        weeks.setdefault(m.ts.isocalendar()[:2], 0)
        weeks[m.ts.isocalendar()[:2]] += 1
    assert len(weeks) == synthetic.WEEKS
    assert sorted(weeks.values())[0] < 10  # thin weeks exist


def test_normalize_drops_tapbacks_attachments_dupes():
    rows = synthetic.generate_rows()
    msgs = loader.normalize_rows(rows)
    assert len({m.id for m in msgs}) == len(msgs)
    assert not any(m.text.startswith("Loved \u201c") for m in msgs)
    assert not any(m.text in ("", "\ufffc") for m in msgs)
    assert all(m.ts.tzinfo is not None for m in msgs)
    assert [m.ts for m in msgs] == sorted(m.ts for m in msgs)
    assert {m.speaker for m in msgs} == {"me", "other"}


def test_date_range_filter():
    msgs = loader.load_demo(date(2025, 10, 6), date(2025, 10, 19)).msgs
    assert msgs and all(date(2025, 10, 6) <= m.ts.date() <= date(2025, 10, 19) for m in msgs)


def _db(tmp_path):
    t0 = datetime(2025, 10, 1, 18, 0, tzinfo=timezone.utc)
    one = [(t0, False, "+15550001", "hi there"), (t0 + timedelta(seconds=40), True, None, "hey you"),
           (t0 + timedelta(seconds=60), False, "+15550001", "Liked \u201chey you\u201d"),
           (t0 + timedelta(seconds=90), True, None, "")]
    group = [(t0, False, "+15550002", "group hello"), (t0 + timedelta(seconds=5), False, "+15550003", "yo")]
    return make_chat_db(tmp_path / "chat.db", [(["+15550001"], one), (["+15550002", "+15550003"], group)])


def test_loader_reads_chat_db_shape(tmp_path):
    db = _db(tmp_path)
    convs = {c["id"]: c for c in loader.list_conversations(db)}
    assert convs["1"]["supported"] and not convs["1"]["is_group"]
    assert convs["2"]["is_group"] and not convs["2"]["supported"]
    data = loader.load_conversation("1", db_path=db)
    assert [(m.speaker, m.text) for m in data.msgs] == [("other", "hi there"), ("me", "hey you")]
    assert data.source == "chat.db"


def test_group_chat_rejected(tmp_path):
    db = _db(tmp_path)
    with pytest.raises(GroupChatUnsupported):
        loader.load_conversation("2", db_path=db)
    with pytest.raises(GroupChatUnsupported):
        loader.check_supported("2", db_path=db)


def test_unknown_conversation(tmp_path):
    with pytest.raises(NotFound):
        loader.load_conversation("99", db_path=_db(tmp_path))


def test_missing_db_is_full_disk_access_error(tmp_path):
    with pytest.raises(FullDiskAccessRequired) as exc:
        loader.list_conversations(tmp_path / "missing" / "chat.db")
    assert exc.value.code == "FULL_DISK_ACCESS_REQUIRED"
