from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from psychosight import loader, pipeline, sessionize
from psychosight.app import create_app
from psychosight.message_timeline import MessageTimeline, TimelineUnavailable
from psychosight.models import ConversationData, Msg
from psychosight.storage import Store


@pytest.fixture
def saved(tmp_path):
    store = Store(tmp_path / 'timeline.db')
    report = pipeline.run_analysis('demo', llm_opt_in=False, experimental_scores=False, store=store)
    yield store, report
    store.close()


def test_real_episode_messages_pagination_and_no_store_header(saved):
    store, report = saved
    episode = report['episodes'][0]
    client = TestClient(create_app(store=store, use_default_static=False))
    url = f"/analyses/{report['report_id']}/episodes/{episode['episode_id']}/messages"
    first = client.get(url, params={'limit': 2})
    assert first.status_code == 200 and first.headers['cache-control'] == 'no-store'
    data = first.json()
    assert data['total'] == sum(episode['messages'].values())
    assert len(data['messages']) == 2 and data['next_offset'] == 2
    all_rows = list(data['messages'])
    offset = data['next_offset']
    while offset is not None:
        data = client.get(url, params={'offset': offset, 'limit': 2}).json()
        all_rows += data['messages']
        offset = data['next_offset']
    original = sessionize.sessionize(loader.load_demo().msgs)[0]
    assert [(m['id'], m['text'], m['timestamp']) for m in all_rows] == [(m.id, m.text, m.ts.isoformat()) for m in original.msgs]
    assert len({m['id'] for m in all_rows}) == len(all_rows)
    assert len({m['turn_id'] for m in all_rows}) == len(original.turns)
    # Reading messages does not add them to the saved report or database schema.
    assert store.get_report(report['report_id']) == report
    assert 'messages' not in report
    client.delete(f"/analyses/{report['report_id']}")
    assert client.get(url).status_code == 404


def test_range_is_half_open_and_keeps_original_turn_membership(saved):
    _, report = saved
    service = MessageTimeline()
    ep = report['episodes'][0]['episode_id']
    all_rows = service.page(report, ep)['messages']
    lo, hi = [datetime.fromisoformat(all_rows[i]['timestamp']).timestamp() * 1000 for i in (1, 3)]
    window = service.page(report, ep, start_ms=lo, end_ms=hi)
    assert window['messages'] == [m for m in all_rows if lo <= datetime.fromisoformat(m['timestamp']).timestamp()*1000 < hi]
    assert window['total'] == len(window['messages'])


def test_changed_source_fails_instead_of_inventing_messages(saved, monkeypatch):
    store, report = saved
    data = loader.load_demo()
    first = data.msgs[0]
    data.msgs[0] = Msg(first.id, first.ts, first.speaker, 'changed body')
    monkeypatch.setattr(loader, 'load_conversation', lambda *args: data)
    ep = report['episodes'][0]['episode_id']
    with pytest.raises(TimelineUnavailable):
        MessageTimeline().page(report, ep, expected_hash=store.episode_hash(report['report_id'], ep))


def test_memory_cache_reuses_source_and_discard_reloads(saved, monkeypatch):
    _, report = saved
    source = loader.load_demo()
    calls = []
    monkeypatch.setattr(loader, 'load_conversation', lambda *args: calls.append(args) or source)
    service = MessageTimeline()
    ep = report['episodes'][0]['episode_id']
    service.page(report, ep, limit=1)
    service.page(report, ep, offset=1, limit=1)
    assert len(calls) == 1
    service.discard(report['report_id'])
    service.page(report, ep)
    assert len(calls) == 2


def test_validation_and_unknown_episode_do_not_load_source(saved, monkeypatch):
    store, report = saved
    monkeypatch.setattr(loader, 'load_conversation', lambda *args: pytest.fail('must not load'))
    client = TestClient(create_app(store=store, use_default_static=False))
    base = f"/analyses/{report['report_id']}/episodes/{report['episodes'][0]['episode_id']}/messages"
    for params in ({'limit': 501}, {'limit': 0}, {'offset': -1}, {'start_ms': 1}, {'start_ms': 2, 'end_ms': 1}, {'start_ms': 'nan', 'end_ms': 100}):
        assert client.get(base, params=params).status_code == 422
    assert client.get(base.replace(report['episodes'][0]['episode_id'], 'absent')).status_code == 404


def test_dst_repeated_hour_uses_actual_instants(monkeypatch):
    msgs = [Msg('a', datetime.fromisoformat('2025-11-02T01:55:00-07:00'), 'me', 'One'),
            Msg('b', datetime.fromisoformat('2025-11-02T01:05:00-08:00'), 'other', 'Two')]
    monkeypatch.setattr(loader, 'load_conversation', lambda *args: ConversationData('x', 'x', msgs, False, 'chat.db'))
    report = {'report_id': 'dst', 'header': {'conversation_id': 'x', 'date_from': '2025-11-02', 'date_to': '2025-11-02'}, 'run_meta': {'created_at': 'now'},
              'episodes': [{'episode_id': 'ep', 'start': msgs[0].ts.isoformat(), 'end': msgs[1].ts.isoformat(), 'messages': {'me': 1, 'other': 1}}]}
    page = MessageTimeline().page(report, 'ep')
    assert [m['id'] for m in page['messages']] == ['a', 'b']
