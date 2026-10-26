"""직접·간접 출처, 내 채집 이력 분리와 기존 DB의 보존 이전을 검증합니다."""
import json
import sqlite3
import pytest
from app import migrations
from test_integrations import client, record
from test_updates import payload


def test_source_roundtrip_and_personal_capture_history(client):
    sid = client.post('/api/species', json={'korean_name': '출처 시험 종'}).json()['id']
    saved = record(client, observations=[{'species_id': sid, 'source_type': 'indirect',
                    'source_note': '외부 시험 자료 / 원 관찰자', 'capture_status': 'captured', 'captured_count': 1}])
    observed = client.get(f"/api/surveys/{saved['id']}").json()['observations'][0]
    assert observed['source_type'] == 'indirect' and observed['source_note'] == '외부 시험 자료 / 원 관찰자'
    assert client.get('/api/exploration?on=2026-10-26').json()[0]['capture_history'] == 'unknown'
    body = payload(saved)
    body['notes'] = '출처를 유지한 수정'
    edited = client.put(f"/api/surveys/{saved['id']}", json=body)
    assert edited.status_code == 200
    assert edited.json()['observations'][0]['source_note'] == observed['source_note']
    record(client, observations=[{'species_id': sid, 'capture_status': 'captured'}])
    assert client.get('/api/exploration?on=2026-10-26').json()[0]['capture_history'] == 'captured'
    assert client.get('/api/surveys').json()[0]['observations'][0]['source_type'] in ('direct', 'indirect')


@pytest.mark.parametrize('observation', [
    {'source_type': 'indirect'}, {'source_type': 'indirect', 'source_note': '   '},
    {'source_type': 'other'}, {'source_note': 'x' * 2001},
])
def test_invalid_source_has_no_partial_write(client, observation):
    before = client.get('/api/surveys').json()
    response = client.post('/api/surveys', json={'survey_date': '2026-10-26', 'place_name': '시험', 'observations': [observation]})
    assert response.status_code == 422
    assert client.get('/api/surveys').json() == before


def test_v3_source_upgrade_is_atomic_and_preserves_existing_data(tmp_path, monkeypatch):
    path = tmp_path / 'legacy-v3.sqlite3'
    monkeypatch.setenv('BUTTERFLY_DB_PATH', str(path))
    with sqlite3.connect(path) as db:
        for sql in migrations.STATEMENTS + migrations.INTEGRATION_STATEMENTS + migrations.REFERENCE_STATEMENTS:
            db.execute(sql)
        db.execute("INSERT INTO species VALUES(1,'기존 종','Test species','original')")
        db.execute("INSERT INTO surveys VALUES(1,'2026-10-26','기존 장소',NULL,NULL,'unknown','general','기존 메모','original','original')")
        db.execute("INSERT INTO observations VALUES(1,1,1,'observed',NULL,NULL,'',NULL,NULL,'unknown','adult','unknown',2,0,'user_confirmed','captured',1,'기존 기록')")
        db.execute('INSERT INTO species_references VALUES(1,?,?)', (json.dumps({'host_plants': '기존 식물', 'display_order': 7}), 'original'))
        db.execute('PRAGMA user_version=3')
        originals = {name: db.execute(f'SELECT * FROM {name}').fetchall() for name in ('species', 'surveys', 'observations', 'species_references')}
    with monkeypatch.context() as patch:
        patch.setattr(migrations, 'SOURCE_STATEMENTS', migrations.SOURCE_STATEMENTS + ('INVALID SQL',))
        with pytest.raises(sqlite3.Error): migrations.initialize_database()
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 3
        assert 'source_type' not in [r[1] for r in db.execute('PRAGMA table_info(observations)')]
    migrations.initialize_database()
    migrations.initialize_database()
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 4
        for table, rows in originals.items():
            actual = db.execute(f'SELECT * FROM {table}').fetchall()
            if table == 'observations':
                assert actual == [rows[0] + ('direct', '')]
            else:
                assert actual == rows
    assert list(tmp_path.glob('*.before-v4-*.bak'))
