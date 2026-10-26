"""탐사 기간 경계, 미확인 처리, 참고자료 보존과 버전 이전을 검사합니다."""
import sqlite3
from datetime import date
import pytest
from app.exploration import season
from app import migrations
from app.database import connect_database
from test_integrations import client, upstream, record


@pytest.mark.parametrize('periods,on,days,next_period', [
    ([{'start': 6, 'end': 6}], '2024-02-21', 8, False),
    ([{'start': 6, 'end': 6}], '2025-02-21', 7, False),
    ([{'start': 34, 'end': 3}], '2025-12-31', 31, False),
    ([{'start': 34, 'end': 3}], '2026-01-10', 21, True),
    ([{'start': 10, 'end': 12}, {'start': 12, 'end': 15}], '2025-04-30', 31, False),
    ([{'start': 10, 'end': 12}, {'start': 19, 'end': 21}], '2025-04-30', 0, True),
])
def test_season_boundaries(periods, on, days, next_period):
    result = season(periods, date.fromisoformat(on))
    assert result['active'] is True
    assert result['days_left'] == days
    assert result['next_period'] is next_period


def test_unknown_outside_and_year_round():
    assert season([], date(2026, 10, 26))['active'] is None
    assert season([{'start': 1, 'end': 3}], date(2026, 10, 26))['active'] is False
    result = season([{'start': 1, 'end': 36}], date(2026, 10, 26))
    assert result['year_round'] and result['days_left'] is None


def new_species(client, name='탐사 시험 종'):
    return client.post('/api/species', json={'korean_name': name}).json()['id']


def test_reference_roundtrip_and_conflict(client):
    key = new_species(client)
    original = client.get(f'/api/species/{key}/reference').json()
    assert original['reference']['vagrant'] is None
    payload = {**original['reference'], 'periods': [{'start': 28, 'end': 30}], 'source': '사용자 시트 참고', 'sighting_years': [2009], 'vagrant': True}
    saved = client.put(f'/api/species/{key}/reference', json=payload)
    assert saved.status_code == 200, saved.text
    assert client.get(f'/api/species/{key}/reference').json() == saved.json()
    assert client.put(f'/api/species/{key}/reference', json=payload).status_code == 409
    rows = client.get('/api/exploration?on=2026-10-26').json()
    assert rows[0]['old_vagrant'] and rows[0]['days_left'] == 5
    assert rows[0]['capture_history'] == 'unknown' and rows[0]['permission'] == 'unknown'
    payload.update(expected_updated_at=saved.json()['updated_at'], sighting_years=[2009, 2010])
    assert client.put(f'/api/species/{key}/reference', json=payload).status_code == 200
    assert not client.get('/api/exploration?on=2026-10-26').json()[0]['old_vagrant']


@pytest.mark.parametrize('invalid', [
    {'periods': [{'start': 0, 'end': 2}]}, {'periods': [{'start': 1, 'end': 37}]},
    {'periods': [{'start': 1, 'end': 3}]}, {'sighting_years': [True]},
    {'protected': False}, {'permission': 'permitted'}, {'capture_history': 'not_captured'},
])
def test_reference_rejects_invalid_without_write(client, invalid):
    key = new_species(client)
    assert client.put(f'/api/species/{key}/reference', json=invalid).status_code == 422
    assert client.get(f'/api/species/{key}/reference').json()['updated_at'] is None


def test_permission_scope_and_capture_evidence(client):
    key = new_species(client)
    value = {'source': '시험 출처', 'regions': ['시험 지역'], 'capture_history': 'not_captured', 'capture_source': '사용자 확인',
             'permission': 'permitted', 'permission_region': '시험 지역', 'permission_start': '2026-10-01', 'permission_end': '2026-10-31', 'permission_source': '시험 근거'}
    assert client.put(f'/api/species/{key}/reference', json=value).status_code == 200
    assert client.get('/api/exploration', params={'on': '2026-10-26', 'region': '시험 지역'}).json()[0]['permission'] == 'permitted'
    assert client.get('/api/exploration', params={'on': '2026-11-01', 'region': '시험 지역'}).json()[0]['permission'] == 'unknown'
    assert client.get('/api/exploration', params={'on': '2026-10-26', 'region': '다른 지역'}).json()[0]['permission'] == 'unknown'
    record(client, observations=[{'species_id': key, 'capture_status': 'captured'}])
    assert client.get('/api/exploration?on=2026-10-26').json()[0]['capture_history'] == 'captured'
    assert client.get('/api/exploration?on=invalid').status_code == 422
    assert client.get('/api/species/999/reference').status_code == 404


def test_saved_weather_summary_never_fetches(client, upstream):
    saved = record(client, observations=[{}])
    oid = saved['observations'][0]['id']
    assert client.get('/api/record-weather').json() == {}
    assert client.post('/api/weather/query', json={'target_type': 'observation', 'target_id': oid, 'station_id': 108}).status_code == 200
    count = len(upstream)
    summary = client.get('/api/record-weather').json()[str(oid)]
    assert summary['weather']['values'][0]['value'] == 13.1
    with connect_database() as db:
        db.execute("UPDATE surveys SET survey_date='2025-10-21' WHERE id=?", (saved['id'],))
    assert client.get('/api/record-weather').json()[str(oid)]['weather']['stale']
    assert len(upstream) == count


def test_v2_backup_rollback_and_upgrade(tmp_path, monkeypatch):
    path = tmp_path / 'v2.sqlite3'
    monkeypatch.setenv('BUTTERFLY_DB_PATH', str(path))
    with sqlite3.connect(path) as db:
        for sql in migrations.STATEMENTS + migrations.INTEGRATION_STATEMENTS: db.execute(sql)
        db.execute("INSERT INTO species VALUES (1,'기존 종',NULL,'2026-10-23')")
        db.execute('PRAGMA user_version=2')
    with monkeypatch.context() as patch:
        patch.setattr(migrations, 'REFERENCE_STATEMENTS', migrations.REFERENCE_STATEMENTS + ('INVALID SQL',))
        with pytest.raises(sqlite3.Error): migrations.initialize_database()
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 2
        assert db.execute("SELECT name FROM sqlite_master WHERE name='species_references'").fetchone() is None
    migrations.initialize_database()
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 3
        assert db.execute('SELECT korean_name FROM species').fetchone()[0] == '기존 종'
    for backup in tmp_path.glob('*.bak'):
        with sqlite3.connect(backup) as db: assert db.execute('PRAGMA user_version').fetchone()[0] == 2
    assert list(tmp_path.glob('*.bak'))
