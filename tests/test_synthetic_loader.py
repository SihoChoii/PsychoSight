from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from psychosight import loader, synthetic
from psychosight.models import utc
from psychosight.errors import FullDiskAccessRequired, GroupChatUnsupported, NotFound
from tests.helpers import make_chat_db

ROOT = Path(__file__).resolve().parents[1]


def _generator():
    import importlib.util
    spec = importlib.util.spec_from_file_location("make_demo", ROOT / "scripts" / "make_demo_conversation.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_generator_is_deterministic_and_matches_committed_file():
    gen = _generator()
    text = gen.dumps(gen.generate())
    assert text == gen.dumps(gen.generate())
    assert text == synthetic.DATA_FILE.read_text(encoding="utf-8")
    assert gen.INJECTION_TEXT == synthetic.INJECTION_TEXT
    assert synthetic.DATA_FILE.stat().st_size < 1_500_000


def test_demo_size_span_quiet_week_dst_injection_late_night():
    from psychosight import sessionize
    msgs = loader.load_demo().msgs
    eps = sessionize.sessionize(msgs)
    assert 3000 <= len(msgs) <= 5000 and 120 <= len(eps) <= 200
    assert any(m.text == synthetic.INJECTION_TEXT for m in msgs)
    assert sum(1 for e in eps if 1 <= e.start.hour < 4) >= 8
    weeks = {m.ts.isocalendar()[:2] for m in msgs}
    assert len(weeks) == synthetic.WEEKS_WITH_MESSAGES and (2025, 46) not in weeks
    assert (msgs[-1].ts.date() - msgs[0].ts.date()).days >= 175
    nov2 = {m.ts.utcoffset() for m in msgs if m.ts.date() == date(2025, 11, 2) and m.ts.hour == 1}
    assert nov2 == {timedelta(hours=-7), timedelta(hours=-8)}  # runs through the repeated 01:00 hour
    texts = " ".join(m.text.lower() for m in msgs)
    for planted in ("always", "never", "sorry", "speaking of", "https://example.com/", "makes sense you're upset"):
        assert planted in texts


def test_normalize_drops_tapbacks_attachments_dupes():
    rows = synthetic.generate_rows()
    msgs = loader.normalize_rows(rows)
    assert len({m.id for m in msgs}) == len(msgs)
    assert not any(m.text.startswith("Loved \u201c") for m in msgs)
    assert not any(m.text in ("", "\ufffc") for m in msgs)
    assert all(m.ts.tzinfo is not None for m in msgs)
    assert [utc(m.ts) for m in msgs] == sorted(utc(m.ts) for m in msgs)
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
