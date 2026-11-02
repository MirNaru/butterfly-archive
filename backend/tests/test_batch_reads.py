"""일괄 조회가 개별 기록·기상의 보존 규칙과 같은 결과를 내는지 검사합니다."""
import json
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import records, weather_store
from app.database import connect_database


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('BUTTERFLY_DB_PATH', str(tmp_path / 'batch.sqlite3'))
    with TestClient(app) as client:
        yield client


def test_batch_matches_details_with_locations_and_trash(client):
    surveys = []
    for index in range(3):
        response = client.post('/api/surveys', json={
            'survey_date': '2026-05-01', 'place_name': '시험 장소',
            'latitude': 37, 'longitude': 127, 'tags': ['강풍', '안개'],
            'observations': [{'stage': 'adult', 'tags': ['안개', '공사']},
                             {'place_name': '개별 장소', 'observation_date': '2026-05-02'}]})
        assert response.status_code == 201
        surveys.append(response.json())
    for target, observation in [(surveys[0], None), (surveys[1], surveys[1]['observations'][0]['id'])]:
        from app.trash import move_to_trash, DeleteInput
        move_to_trash(target['id'], DeleteInput(expected_updated_at=target['updated_at']), observation)
    listing = records.list_surveys()
    assert listing == [records.get_survey(surveys[2]['id']), records.get_survey(surveys[1]['id'])]
    assert listing[0]['observations'][1]['effective_latitude'] is None
    assert listing[0]['observations'][0]['effective_tags'] == ['강풍', '안개', '공사']


def test_batch_weather_matches_single_and_stale(client):
    survey = client.post('/api/surveys', json={'survey_date': '2026-05-01', 'place_name': '시험 장소',
        'latitude': 37, 'longitude': 127, 'observations': [{}, {'place_name': '개별 장소', 'observation_time': '09:10:00'}]}).json()
    ids = [item['id'] for item in survey['observations']]
    assert weather_store.saved_observations() == {}
    for key in ids:
        context = weather_store.context('observation', key)
        with connect_database() as db:
            sample = db.execute("INSERT INTO weather_samples(station_id,kind,target_time,payload_json,fetched_at) VALUES(108,?,?,?,?)",
                (context['kind'], context['target_time'], json.dumps({'values': [], 'kind': context['kind']}), '2026-10-30')).lastrowid
            db.execute('INSERT INTO weather_links(observation_id,sample_id,context_json,station_json,distance_km) VALUES(?,?,?,?,?)',
                (key, sample, json.dumps(context), json.dumps({'id': 108}), 0))
    with connect_database() as db:
        db.execute("UPDATE surveys SET survey_date='2026-05-03' WHERE id=?", (survey['id'],))
    assert weather_store.saved_observations() == {key: weather_store.saved('observation', key) for key in ids}
    assert all(item['weather']['stale'] for item in weather_store.saved_observations().values())
    from app.trash import move_to_trash, DeleteInput
    move_to_trash(survey['id'], DeleteInput(expected_updated_at=survey['updated_at']), ids[0])
    assert list(weather_store.saved_observations()) == [ids[1]]
