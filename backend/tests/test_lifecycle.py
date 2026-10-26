"""한살이 판본·수정 이력과 생태 메모의 보존·출처·목록 응답을 검증합니다."""
import pytest
from test_integrations import client


def period(stage='adult', **extra):
    return {'id': 'book-1', 'stage': stage, 'start': 13, 'end': 15, 'source': '가상 도감', 'edition': '초판 2020', **extra}


def test_lifecycle_history_preserves_old_and_new_versions(client):
    sid = client.post('/api/species', json={'korean_name': '한살이 시험 종'}).json()['id']
    assert client.get(f'/api/species/{sid}/reference').json()['lifecycle_history'] == []
    first = client.put(f'/api/species/{sid}/reference', json={'lifecycle': [period()], 'habitat': '가상 산지', 'ecology_source': '가상 자료'})
    assert first.status_code == 200
    doc = first.json()
    assert len(doc['lifecycle_history']) == 2
    body = {**doc['reference'], 'expected_updated_at': doc['updated_at']}
    body['lifecycle'][0].update(end=18, edition='개정판 2026')
    second = client.put(f'/api/species/{sid}/reference', json=body)
    assert second.status_code == 200
    history = second.json()['lifecycle_history']
    assert history[1]['lifecycle'][0]['end'] == 15
    assert history[1]['lifecycle'][0]['edition'] == '초판 2020'
    assert history[2]['lifecycle'][0]['end'] == 18
    assert client.put(f'/api/species/{sid}/reference', json=body).status_code == 409
    doc = second.json()
    body = {**doc['reference'], 'habits': '가상 행동', 'expected_updated_at': doc['updated_at']}
    third = client.put(f'/api/species/{sid}/reference', json=body).json()
    assert third['lifecycle_history'] == history
    catalog = client.get('/api/species/catalog').json()
    assert catalog[0]['reference']['habitat'] == '가상 산지'
    assert catalog[0]['reference']['habits'] == '가상 행동'
    assert '_lifecycle_history' not in catalog[0]['reference']
    assert client.get('/api/exploration?on=2026-05-15').json()[0]['active'] is True


@pytest.mark.parametrize('invalid', [
    {'lifecycle': [period(source='')]}, {'lifecycle': [period(stage='unknown')]},
    {'lifecycle': [period(start=0)]}, {'lifecycle': [period(), period()]},
    {'habitat': '자료만 있고 출처 없음'}, {'habits': 'x' * 5001, 'ecology_source': '시험'},
    {'_lifecycle_history': []},
])
def test_lifecycle_validation_does_not_write(client, invalid):
    sid = client.post('/api/species', json={'korean_name': '검증 시험 종'}).json()['id']
    assert client.put(f'/api/species/{sid}/reference', json=invalid).status_code == 422
    assert client.get(f'/api/species/{sid}/reference').json()['updated_at'] is None


def test_legacy_adult_is_preserved_and_stage_is_not_copied(client):
    sid = client.post('/api/species', json={'korean_name': '기존 성충 자료 종'}).json()['id']
    doc = client.put(f'/api/species/{sid}/reference', json={'periods': [{'start': 10, 'end': 12}], 'source': '기존 시트'}).json()
    body = {**doc['reference'], 'lifecycle': [period('egg')], 'expected_updated_at': doc['updated_at']}
    saved = client.put(f'/api/species/{sid}/reference', json=body).json()
    assert saved['reference']['periods'] == [{'start': 10, 'end': 12}]
    assert len(saved['reference']['lifecycle']) == 1
    assert client.get('/api/exploration?on=2026-04-15').json()[0]['active'] is True
    body = {**saved['reference'], 'lifecycle': [period('adult', region='시험 지역')], 'expected_updated_at': saved['updated_at']}
    assert client.put(f'/api/species/{sid}/reference', json=body).status_code == 200
    assert client.get('/api/exploration?on=2026-04-15').json()[0]['active'] is False
    assert client.get('/api/exploration?on=2026-05-15&region=다른지역').json()[0]['active'] is None
