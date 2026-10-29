"""휴지통의 관계 보존·충돌·소장 연결과 DB 이전 실패를 검증합니다."""
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import migrations
from app.database import connect_database
from test_integrations import client, upstream, record, query
from test_photos import register
from test_updates import payload


def remove(client, saved, oid=None):
    path = f"/api/surveys/{saved['id']}" + (f'/observations/{oid}' if oid is not None else '')
    return client.request('DELETE', path, json={'expected_updated_at': saved['updated_at']})


def restore(client, entry):
    return client.post(f"/api/trash/{entry['id']}/restore", json={'expected_deleted_at': entry['deleted_at']})


def test_individual_then_parent_restore_preserves_hidden_child_and_all_links(client, upstream):
    sid = client.post('/api/species', json={'korean_name': '휴지통 시험 종'}).json()['id']
    photo = register(client)
    saved = record(client, tags=['태풍'], photo_ids=[photo['id']], notes='공통 메모', observations=[
        {'species_id': sid, 'tags': ['하천 범람'], 'photo_ids': [photo['id']], 'notes': '개별 메모', 'capture_status': 'captured', 'captured_count': 2},
        {'notes': '다른 관찰'},
    ])
    oid = saved['observations'][0]['id']
    assert query(client, saved['id']).status_code == 200
    assert query(client, oid, target_type='observation').status_code == 200
    with connect_database() as db:
        tables = ['observations', 'photo_links', 'photos', 'survey_tags', 'observation_tags', 'weather_links', 'weather_samples', 'api_usage']
        before = {t: [tuple(r) for r in db.execute(f'SELECT * FROM {t} ORDER BY rowid')] for t in tables}
    calls = len(upstream)
    removed = remove(client, saved, oid)
    assert removed.status_code == 200, removed.text
    child = removed.json()
    visible = client.get(f"/api/surveys/{saved['id']}").json()
    assert len(visible['observations']) == 1
    assert client.get(f'/api/weather/observation/{oid}').status_code == 404
    assert str(oid) not in client.get('/api/record-weather').json()
    assert client.get('/api/exploration?on=2026-10-29').json()[0]['capture_history'] == 'unknown'
    assert client.put(f"/api/surveys/{saved['id']}", json=payload(saved)).status_code == 409
    parent = remove(client, visible).json()
    assert client.get('/api/surveys').json() == []
    assert client.get(f"/api/surveys/{saved['id']}").status_code == 404
    assert client.get(f"/api/weather/survey/{saved['id']}").status_code == 404
    assert restore(client, child).status_code == 409
    assert len(client.get('/api/trash').json()) == 2
    with TestClient(app) as restarted:
        assert len(restarted.get('/api/trash').json()) == 2
        assert restore(restarted, parent).status_code == 200
        assert len(restarted.get(f"/api/surveys/{saved['id']}").json()['observations']) == 1
        assert restore(restarted, child).status_code == 200
    restored = client.get(f"/api/surveys/{saved['id']}").json()
    assert restored['observations'] == saved['observations']
    assert all(restored[k] == saved[k] for k in saved if k != 'updated_at')
    assert client.get('/api/trash').json() == []
    assert restore(client, child).status_code == 409
    assert client.get(f'/api/weather/observation/{oid}').json()['weather'] is not None
    assert str(oid) in client.get('/api/record-weather').json()
    assert client.get('/api/exploration?on=2026-10-29').json()[0]['capture_history'] == 'captured'
    assert len(upstream) == calls
    with connect_database() as db:
        for t in tables:
            assert [tuple(r) for r in db.execute(f'SELECT * FROM {t} ORDER BY rowid')] == before[t], t


def test_deleted_observation_cannot_be_edited_relinked_or_duplicate_deleted(client):
    sid = client.post('/api/species', json={'korean_name': '연결 시험 종'}).json()['id']
    saved = record(client, observations=[{'species_id': sid, 'capture_status': 'captured'}])
    oid = saved['observations'][0]['id']
    assert remove(client, saved, oid).status_code == 200
    visible = client.get(f"/api/surveys/{saved['id']}").json()
    assert remove(client, visible, oid).status_code == 404
    body = payload(saved); body['expected_updated_at'] = visible['updated_at']
    assert client.put(f"/api/surveys/{saved['id']}", json=body).status_code == 422
    assert client.post('/api/holdings', json={'species_id': sid, 'acquisition': 'own_capture', 'observation_id': oid}).status_code == 422
    assert client.get('/api/holdings').json() == []
    changed = client.put(f"/api/surveys/{saved['id']}", json={**payload(visible), 'notes': '남은 조사 수정'})
    assert changed.status_code == 200
    assert len(client.get('/api/trash').json()) == 1


def test_linked_holdings_block_parent_and_child_until_detached(client):
    sid = client.post('/api/species', json={'korean_name': '소장 연결 종'}).json()['id']
    saved = record(client, observations=[{'species_id': sid, 'capture_status': 'captured', 'captured_count': 2}])
    oid = saved['observations'][0]['id']
    holding = client.post('/api/holdings', json={'species_id': sid, 'acquisition': 'own_capture', 'observation_id': oid, 'possession': 'owned', 'quantity': 2}).json()
    assert remove(client, saved).status_code == 409
    assert remove(client, saved, oid).status_code == 409
    assert client.get('/api/trash').json() == []
    assert client.get(f"/api/surveys/{saved['id']}").json() == saved
    fields = {k:holding[k] for k in ('species_id', 'acquisition', 'possession', 'quantity')}
    fields.update(observation_id=None, source_note='직접 채집한 표본 본인 확인', expected_updated_at=holding['updated_at'])
    assert client.put(f"/api/holdings/{holding['id']}", json=fields).status_code == 200
    assert remove(client, saved).status_code == 200
    assert client.get('/api/holdings').json()[0]['quantity'] == 2


def test_trash_invalid_conflict_foreign_empty_and_repeat_cycle(client):
    assert client.get('/api/trash').json() == []
    first = record(client, observations=[{}]); second = record(client, observations=[{}])
    assert remove(client, first, second['observations'][0]['id']).status_code == 404
    assert client.request('DELETE', f"/api/surveys/{first['id']}", json={}).status_code == 422
    assert client.request('DELETE', f"/api/surveys/{first['id']}", json={'expected_updated_at':'old'}).status_code == 409
    assert remove(client, {**first, 'id':999}).status_code == 404
    entry = remove(client, first).json()
    assert restore(client, {**entry,'deleted_at':'old'}).status_code == 409
    assert restore(client, {**entry,'id':999}).status_code == 404
    assert restore(client, entry).status_code == 200
    current = client.get(f"/api/surveys/{first['id']}").json()
    newer = remove(client, current).json()
    assert newer['id'] != entry['id']
    assert restore(client, entry).status_code == 409
    assert restore(client, newer).status_code == 200


def test_trash_database_failure_is_atomic(client):
    saved = record(client, observations=[{}])
    with connect_database() as db:
        db.execute("CREATE TRIGGER fail_trash BEFORE UPDATE ON surveys BEGIN SELECT RAISE(ABORT,'test'); END")
    assert remove(client, saved).status_code == 503
    assert client.get('/api/trash').json() == []
    assert client.get(f"/api/surveys/{saved['id']}").json() == saved
    with connect_database() as db:
        db.execute('DROP TRIGGER fail_trash')
    entry = remove(client, saved).json()
    with connect_database() as db:
        db.execute("CREATE TRIGGER fail_restore BEFORE UPDATE ON surveys BEGIN SELECT RAISE(ABORT,'test'); END")
    assert restore(client, entry).status_code == 503
    assert client.get('/api/trash').json()[0]['id'] == entry['id']
    assert client.get(f"/api/surveys/{saved['id']}").status_code == 404
    with connect_database() as db:
        db.execute('DROP TRIGGER fail_restore')
    assert restore(client, entry).status_code == 200


def test_v8_migration_preserves_rows_and_failure_rolls_back(tmp_path, monkeypatch):
    path = tmp_path / 'v8.sqlite3'
    monkeypatch.setenv('BUTTERFLY_DB_PATH', str(path))
    with sqlite3.connect(path) as db:
        for sql in migrations.STATEMENTS + migrations.INTEGRATION_STATEMENTS + migrations.REFERENCE_STATEMENTS + migrations.SOURCE_STATEMENTS + migrations.TAG_STATEMENTS + migrations.PHOTO_STATEMENTS + migrations.HOLDING_STATEMENTS + migrations.HOLDING_SEX_STATEMENTS:
            db.execute(sql)
        db.execute("INSERT INTO species VALUES(1,'기존 종',NULL,'before')")
        db.execute('PRAGMA user_version=8')
        names = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        before = {n: db.execute(f'SELECT * FROM {n}').fetchall() for n in names}
    with monkeypatch.context() as patch:
        patch.setattr(migrations, 'TRASH_STATEMENTS', migrations.TRASH_STATEMENTS + ('INVALID SQL',))
        with pytest.raises(sqlite3.Error): migrations.initialize_database()
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 8
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='record_trash'").fetchone()
    migrations.initialize_database(); migrations.initialize_database()
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == migrations.SCHEMA_VERSION
        for name in names: assert db.execute(f'SELECT * FROM {name}').fetchall() == before[name]
    assert list(tmp_path.glob(f'*.before-v{migrations.SCHEMA_VERSION}-*.bak'))
