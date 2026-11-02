"""완전 삭제의 범위·보호 복사본·원문 보존·실패 롤백을 시험 DB에서 검증합니다."""
import sqlite3
from app import trash
from app.database import connect_database, database_path
from test_integrations import client, upstream, record, query
from test_photos import register
from test_trash import remove, restore


def purge(client, entry):
    return client.request('DELETE', f"/api/trash/{entry['id']}", json={'expected_deleted_at': entry['deleted_at']})


def test_parent_purge_preserves_photos_weather_and_unrelated_records(client, upstream):
    photo = register(client)
    saved = record(client, tags=['태풍'], photo_ids=[photo['id']], observations=[{'tags': ['공사'], 'photo_ids': [photo['id']]}, {}])
    other = record(client)
    assert query(client, saved['id']).status_code == 200
    child = remove(client, saved, saved['observations'][0]['id']).json()
    current = client.get(f"/api/surveys/{saved['id']}").json()
    parent = remove(client, current).json()
    assert purge(client, parent).status_code == 200
    assert client.get('/api/trash').json() == []
    assert client.get(f"/api/surveys/{other['id']}").status_code == 200
    assert purge(client, child).status_code == 404
    with connect_database() as db:
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        assert db.execute('SELECT count(*) FROM photos').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM weather_samples').fetchone()[0] > 0
        for table in ('photo_links', 'weather_links', 'survey_tags', 'observation_tags'):
            assert db.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == 0
    backups = list(database_path().parent.glob('*.before-purge-*.bak'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute('SELECT count(*) FROM observations WHERE survey_id=?', (saved['id'],)).fetchone()[0] == 2
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'


def test_individual_purge_preserves_parent_and_other_observation(client):
    saved = record(client, observations=[{}, {}])
    entry = remove(client, saved, saved['observations'][0]['id']).json()
    assert purge(client, entry).status_code == 200
    current = client.get(f"/api/surveys/{saved['id']}").json()
    assert [r['id'] for r in current['observations']] == [saved['observations'][1]['id']]
    assert current['updated_at'] != saved['updated_at']


def test_backup_failure_and_changed_state_do_not_delete(client, monkeypatch):
    saved = record(client)
    entry = remove(client, saved).json()
    def fail():
        raise OSError('시험 보호 복사본 실패')
    monkeypatch.setattr(trash, 'protect_before_purge', fail)
    assert purge(client, entry).status_code == 503
    assert len(client.get('/api/trash').json()) == 1
    assert restore(client, entry).status_code == 200
    assert purge(client, entry).status_code == 409
    assert client.get(f"/api/surveys/{saved['id']}").status_code == 200


def test_failure_during_delete_rolls_back(client):
    saved = record(client, observations=[{}, {}])
    entry = remove(client, saved).json()
    with connect_database() as db:
        db.execute("CREATE TRIGGER prevent_purge BEFORE DELETE ON observations BEGIN SELECT RAISE(ABORT, '시험 삭제 실패'); END")
    assert purge(client, entry).status_code == 503
    with connect_database() as db:
        assert db.execute('SELECT count(*) FROM observations').fetchone()[0] == 2
        assert db.execute('SELECT count(*) FROM record_trash WHERE restored_at IS NULL').fetchone()[0] == 1


def test_linked_holding_blocks_purge(client):
    sid = client.post('/api/species', json={'korean_name': '완전 삭제 시험 종'}).json()['id']
    saved = record(client, observations=[{'species_id': sid}])
    entry = remove(client, saved).json()
    with connect_database() as db:
        db.execute("INSERT INTO holdings(species_id,sex,possession,acquisition,observation_id,source_note,notes,created_at,updated_at) VALUES(?,'unknown','owned','unknown',?,'','','now','now')", (sid, saved['observations'][0]['id']))
    assert purge(client, entry).status_code == 409
    assert len(client.get('/api/trash').json()) == 1


def test_imported_purge_keeps_original_and_excludes_queue(client):
    saved = record(client, observations=[{}])
    oid = saved['observations'][0]['id']
    with connect_database() as db:
        key = db.execute("INSERT INTO collected_observations(source,source_id,payload_json,first_received_at,last_received_at,collected_at) VALUES('naturing','purge','{}','now','now','now')").lastrowid
        db.execute("INSERT INTO collection_imports VALUES(?,?,'now','{}','{}')", (key, oid))
        db.execute("INSERT INTO collection_revisions(item_id,payload_json,replaced_at) VALUES(?,'{}','now')", (key,))
    entry = remove(client, saved).json()
    assert purge(client, entry).status_code == 200
    with connect_database() as db:
        assert db.execute('SELECT review_status FROM collected_observations WHERE id=?', (key,)).fetchone()[0] == 'discarded'
        assert db.execute('SELECT count(*) FROM collection_revisions').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM collection_imports').fetchone()[0] == 0
