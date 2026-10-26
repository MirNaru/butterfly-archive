"""수정의 원자성, 상속, 충돌 방지와 기상 보존을 별도 DB에서 검증합니다."""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.schemas import SurveyUpdate
from app.database import connect_database
from test_integrations import client, upstream, record, query


def payload(saved):
    fields = SurveyUpdate.model_fields
    result = {key: value for key, value in saved.items() if key in fields}
    result['expected_updated_at'] = saved['updated_at']
    from app.schemas import ObservationUpdate
    result['observations'] = [{k: v for k, v in item.items() if k in ObservationUpdate.model_fields}
                              for item in saved['observations']]
    return result


def test_edit_inheritance_ids_and_restart(client):
    original = record(client, observations=[{}, {'observation_date': '2025-09-01', 'place_name': '개별 장소'}])
    body = payload(original)
    body.update(survey_date='2025-10-21', place_name='변경 장소', latitude=36, notes='수정')
    body['observations'][0].update(count=4, capture_status='captured', captured_count=2)
    body['observations'].append({'notes': '추가 기록'})
    response = client.put(f"/api/surveys/{original['id']}", json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved['created_at'] == original['created_at']
    assert saved['updated_at'] != original['updated_at']
    first, second, added = saved['observations']
    assert [first['id'], second['id']] == [o['id'] for o in original['observations']]
    assert first['effective_date'] == '2025-10-21' and first['observation_date'] is None
    assert first['effective_latitude'] == 36 and first['count'] == 4 and first['captured_count'] == 2
    assert second['effective_date'] == '2025-09-01' and second['effective_place'] == '개별 장소'
    assert second['effective_latitude'] is None and second['count'] is None
    assert added['id'] not in [first['id'], second['id']]
    with TestClient(app) as restarted:
        assert restarted.get(f"/api/surveys/{saved['id']}").json() == saved


@pytest.mark.parametrize('invalid', ['missing', 'duplicate', 'foreign', 'species', 'count'])
def test_edit_rejects_without_partial_save(client, invalid):
    saved = record(client, observations=[{}, {}])
    body = payload(saved)
    body['notes'] = '저장되면 안 됨'
    if invalid == 'missing': body['observations'].pop()
    if invalid == 'duplicate': body['observations'][1]['id'] = body['observations'][0]['id']
    if invalid == 'foreign': body['observations'][1]['id'] = 999
    if invalid == 'species': body['observations'][1]['species_id'] = 999
    if invalid == 'count': body['observations'][1]['count'] = 0
    assert client.put(f"/api/surveys/{saved['id']}", json=body).status_code == 422
    assert client.get(f"/api/surveys/{saved['id']}").json() == saved


def test_conflict_missing_and_database_failure(client, monkeypatch, tmp_path):
    saved = record(client)
    body = payload(saved)
    assert client.put('/api/surveys/999', json=body).status_code == 404
    changed = client.put(f"/api/surveys/{saved['id']}", json={**body, 'notes': '첫 수정'}).json()
    assert client.put(f"/api/surveys/{saved['id']}", json=body).status_code == 409
    with monkeypatch.context() as patch:
        patch.setenv('BUTTERFLY_DB_PATH', str(tmp_path))
        assert client.put(f"/api/surveys/{saved['id']}", json=payload(changed)).status_code == 503
    assert client.get(f"/api/surveys/{saved['id']}").json() == changed


@pytest.mark.parametrize('change', [{'survey_date': '2025-10-21'}, {'latitude': 36}, {'place_name': '새 장소'}])
def test_weather_preserved_no_external_refetch(client, upstream, change):
    saved = record(client, observations=[{'observation_time': '12:34:56'}])
    query(client, saved['id'])
    obs_id = saved['observations'][0]['id']
    client.post('/api/weather/query', json={'target_type': 'observation', 'target_id': obs_id, 'station_id': 108})
    with connect_database() as db:
        before = [tuple(r) for r in db.execute('SELECT * FROM weather_links')]
    call_count = len(upstream)
    body = payload(saved)
    body['notes'] = '메모만 변경'
    unchanged = client.put(f"/api/surveys/{saved['id']}", json=body).json()
    assert not client.get(f"/api/weather/survey/{saved['id']}").json()['weather']['stale']
    body = payload(unchanged)
    body.update(change)
    assert client.put(f"/api/surveys/{saved['id']}", json=body).status_code == 200
    for target, key in [('survey', saved['id']), ('observation', obs_id)]:
        assert client.get(f'/api/weather/{target}/{key}').json()['weather']['stale']
    assert len(upstream) == call_count
    with connect_database() as db:
        assert [tuple(r) for r in db.execute('SELECT * FROM weather_links')] == before
