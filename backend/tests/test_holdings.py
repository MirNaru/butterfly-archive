"""소장 수량 미상, 취득 경로, 개인 관찰 연결과 수정 충돌·이전을 검증합니다."""
import sqlite3
import pytest
from app import migrations
from app.database import connect_database
from test_integrations import client, record
from test_photos import register
from test_updates import payload


def species(client, name='가상 소장 종'):
    return client.post('/api/species', json={'korean_name': name, 'scientific_name': 'Test species'}).json()['id']


def save(client, sid, **extra):
    return client.post('/api/holdings', json={'species_id': sid, **extra})


def test_purchase_unknown_quantity_photos_and_roundtrip_do_not_create_observations(client):
    sid = species(client)
    photo = register(client)
    response = save(client, sid, possession='owned', acquisition='purchase', sex='female', acquired_date='2026-10-28', photo_ids=[photo['id']], source_note='가상 구매 자료')
    assert response.status_code == 201, response.text
    holding = response.json()
    assert holding['quantity'] is None
    assert holding['acquisition'] == 'purchase'
    assert client.get('/api/surveys').json() == []
    assert client.get('/api/exploration?on=2026-10-28').json()[0]['capture_history'] == 'unknown'
    assert client.get(f"/api/holdings/{holding['id']}").json() == holding
    assert client.get('/api/holdings').json() == [holding]
    body = {'species_id': sid, 'possession': 'owned', 'quantity': 2, 'acquisition': 'unknown', 'notes': '수정', 'expected_updated_at': holding['updated_at']}
    changed = client.put(f"/api/holdings/{holding['id']}", json=body)
    assert changed.status_code == 200
    assert changed.json()['created_at'] == holding['created_at']
    assert changed.json()['photo_ids'] == [photo['id']]
    assert client.put(f"/api/holdings/{holding['id']}", json=body).status_code == 409
    body.update(expected_updated_at=changed.json()['updated_at'], photo_ids=[], possession='not_owned', quantity=None)
    assert client.put(f"/api/holdings/{holding['id']}", json=body).json()['photo_ids'] == []
    assert client.post('/api/photos/lookup', json={'ids': [photo['id']]}).json()[0]['id'] == photo['id']


def test_capture_holding_requires_evidence_and_only_affects_capture_history(client):
    sid = species(client)
    assert save(client, sid, acquisition='own_capture').status_code == 422
    assert save(client, sid, acquisition='own_capture', source_note='본인 확인 · 가상 라벨', possession='owned').status_code == 201
    assert client.get('/api/exploration?on=2026-10-28').json()[0]['capture_history'] == 'captured'
    assert client.get('/api/surveys').json() == []


def test_multiple_lots_and_unknown_possession_do_not_infer_counts(client):
    sid = species(client)
    first = save(client, sid).json()
    second = save(client, sid, possession='owned', acquisition='purchase', quantity=3).json()
    assert first['id'] != second['id']
    assert first['quantity'] is None and first['possession'] == 'unknown'
    assert len(client.get('/api/holdings').json()) == 2


@pytest.mark.parametrize('changes', [
    {'quantity': 0, 'possession': 'owned'}, {'quantity': 1.5, 'possession': 'owned'},
    {'quantity': 2}, {'quantity': 1, 'possession': 'not_owned'}, {'quantity': True, 'possession': 'owned'},
    {'acquisition': 'invalid'}, {'sex': 'invalid'}, {'acquired_date': 'invalid'},
    {'species_id': 9999}, {'photo_ids': [9999]}, {'observation_id': 9999, 'acquisition': 'own_capture'},
])
def test_invalid_inputs_do_not_leave_holdings(client, changes):
    sid = species(client)
    assert client.post('/api/holdings', json={'species_id': sid, **changes}).status_code == 422
    assert client.get('/api/holdings').json() == []


def test_link_requires_same_species_direct_capture_and_total_quantity_is_checked(client):
    sid, other = species(client), species(client, '다른 가상 종')
    observed = record(client, observations=[{'species_id': sid, 'capture_status': 'captured', 'captured_count': 3}])
    oid = observed['observations'][0]['id']
    assert save(client, other, acquisition='own_capture', observation_id=oid).status_code == 422
    assert save(client, sid, acquisition='purchase', observation_id=oid).status_code == 422
    first = save(client, sid, acquisition='own_capture', observation_id=oid, possession='owned', quantity=2)
    assert first.status_code == 201
    assert save(client, sid, acquisition='own_capture', observation_id=oid, possession='owned', quantity=2).status_code == 422
    assert len(client.get('/api/holdings').json()) == 1
    indirect = record(client, observations=[{'species_id': sid, 'source_type': 'indirect', 'source_note': '가상 자료', 'capture_status': 'captured'}])
    assert save(client, sid, acquisition='own_capture', observation_id=indirect['observations'][0]['id']).status_code == 422


def test_editing_linked_observation_preserves_consistency_and_rolls_back(client):
    sid = species(client)
    observed = record(client, observations=[{'species_id': sid, 'capture_status': 'captured', 'captured_count': 3}])
    oid = observed['observations'][0]['id']
    assert save(client, sid, acquisition='own_capture', observation_id=oid, possession='owned', quantity=2).status_code == 201
    body = payload(observed)
    body['observations'][0].update(source_type='indirect', source_note='가상 자료')
    assert client.put(f"/api/surveys/{observed['id']}", json=body).status_code == 422
    assert client.get(f"/api/surveys/{observed['id']}").json() == observed
    body = payload(observed)
    body['observations'][0]['captured_count'] = 1
    assert client.put(f"/api/surveys/{observed['id']}", json=body).status_code == 422
    assert client.get(f"/api/surveys/{observed['id']}").json() == observed


def test_v6_upgrade_does_not_rewrite_existing_tables_and_rollback(tmp_path, monkeypatch):
    path = tmp_path / 'v6.sqlite3'
    monkeypatch.setenv('BUTTERFLY_DB_PATH', str(path))
    with sqlite3.connect(path) as db:
        for sql in migrations.STATEMENTS + migrations.INTEGRATION_STATEMENTS + migrations.REFERENCE_STATEMENTS + migrations.SOURCE_STATEMENTS + migrations.TAG_STATEMENTS + migrations.PHOTO_STATEMENTS:
            db.execute(sql)
        db.execute("INSERT INTO species VALUES(1,'기존 가상 종',NULL,'before')")
        db.execute('PRAGMA user_version=6')
        names = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        before = {name: db.execute(f'SELECT * FROM "{name}"').fetchall() for name in names}
    with monkeypatch.context() as context:
        context.setattr(migrations, 'HOLDING_STATEMENTS', migrations.HOLDING_STATEMENTS + ('INVALID SQL',))
        with pytest.raises(sqlite3.Error): migrations.initialize_database()
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 6
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='holdings'").fetchone()
    migrations.initialize_database(); migrations.initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == migrations.SCHEMA_VERSION
        for name, rows in before.items(): assert [tuple(r) for r in db.execute(f'SELECT * FROM "{name}"')] == rows
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    assert list(tmp_path.glob(f'*.before-v{migrations.SCHEMA_VERSION}-*.bak'))


@pytest.mark.parametrize('fields', [
    {'quantity': None}, {'quantity': 1}, {'quantity': 0}, {'quantity': 2.5},
    {'quantity': 4, 'male_quantity': 1},
    {'quantity': 4, 'male_quantity': 1, 'female_quantity': 2},
    {'quantity': 4, 'male_quantity': 0, 'female_quantity': 4},
    {'quantity': 4, 'male_quantity': True, 'female_quantity': 3},
])
def test_both_sexes_require_total_at_least_two_and_coherent_breakdown(client, fields):
    sid = species(client)
    response = save(client, sid, sex='mixed', possession='owned', **fields)
    assert response.status_code == 422, response.text
    assert client.get('/api/holdings').json() == []


def test_both_sexes_roundtrip_unknown_breakdown_and_update_preservation(client):
    sid = species(client)
    minimal = save(client, sid, sex='mixed', possession='owned', quantity=2)
    assert minimal.status_code == 201
    assert minimal.json()['male_quantity'] is None
    response = save(client, sid, sex='mixed', possession='owned', quantity=4, male_quantity=1, female_quantity=3)
    assert response.status_code == 201
    saved = response.json()
    assert client.get(f"/api/holdings/{saved['id']}").json() == saved
    body = {key: saved[key] for key in ('species_id', 'sex', 'possession', 'quantity', 'acquisition', 'source_note', 'notes')}
    body.update(expected_updated_at=saved['updated_at'], notes='수량 보존 확인')
    updated = client.put(f"/api/holdings/{saved['id']}", json=body)
    assert updated.status_code == 200, updated.text
    assert updated.json()['male_quantity'] == 1 and updated.json()['female_quantity'] == 3
    body.update(expected_updated_at=updated.json()['updated_at'], quantity=5)
    assert client.put(f"/api/holdings/{saved['id']}", json=body).status_code == 422
    assert client.get(f"/api/holdings/{saved['id']}").json() == updated.json()
    assert save(client, sid, sex='male', possession='owned', quantity=2, male_quantity=2).status_code == 422


def test_v7_upgrade_preserves_separate_sex_quantities_and_rolls_back(tmp_path, monkeypatch):
    path = tmp_path / 'v7.sqlite3'
    monkeypatch.setenv('BUTTERFLY_DB_PATH', str(path))
    with sqlite3.connect(path) as db:
        for sql in migrations.STATEMENTS + migrations.INTEGRATION_STATEMENTS + migrations.REFERENCE_STATEMENTS + migrations.SOURCE_STATEMENTS + migrations.TAG_STATEMENTS + migrations.PHOTO_STATEMENTS + migrations.HOLDING_STATEMENTS:
            db.execute(sql)
        db.execute("INSERT INTO species VALUES(1,'가상 종',NULL,'before')")
        db.execute("INSERT INTO holdings VALUES(1,1,'male','owned',1,'own_capture',NULL,NULL,'본인 확인','메모','before','before')")
        db.execute("INSERT INTO holdings VALUES(2,1,'female','owned',3,'own_capture',NULL,NULL,'다른 근거','다른 메모','before','before')")
        db.execute('PRAGMA user_version=7')
        columns = [r[1] for r in db.execute('PRAGMA table_info(holdings)')]
        before = db.execute('SELECT * FROM holdings ORDER BY id').fetchall()
    with monkeypatch.context() as context:
        context.setattr(migrations, 'HOLDING_SEX_STATEMENTS', migrations.HOLDING_SEX_STATEMENTS + ('INVALID SQL',))
        with pytest.raises(sqlite3.Error):
            migrations.initialize_database()
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 7
        assert [r[1] for r in db.execute('PRAGMA table_info(holdings)')] == columns
        assert db.execute('SELECT * FROM holdings ORDER BY id').fetchall() == before
    migrations.initialize_database(); migrations.initialize_database()
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT ' + ','.join(columns) + ' FROM holdings ORDER BY id').fetchall() == before
        assert db.execute('SELECT male_quantity,female_quantity FROM holdings').fetchall() == [(None, None), (None, None)]
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
