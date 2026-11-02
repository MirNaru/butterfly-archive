"""미접 연도의 검수·국내 범위·수정·휴지통 연동을 임시 DB에서 검증합니다."""
import json
import pytest
from app.database import connect_database
from app.vagrant_years import domestic_observation
from test_integrations import client, record
from test_updates import payload


def setup_species(client):
    sid = client.post('/api/species', json={'korean_name': '미접 시험 종'}).json()['id']
    response = client.put(f'/api/species/{sid}/reference', json={
        'vagrant': True, 'sighting_years': [2008, 2015], 'source': '사용자 확인 자료'})
    assert response.status_code == 200
    assert response.json()['reference']['sighting_years'] == [2015]
    return sid


def observation(client, sid, year, **changes):
    return record(client, survey_date=f'{year}-05-20', place_name='경기도 시험 장소', observations=[{
        'species_id': sid, 'source_type': 'indirect', 'source_note': '시험 논문 p.3',
        'identification': 'user_confirmed', **changes}])


def years(client, sid):
    reference = client.get(f'/api/species/{sid}/reference').json()['reference']
    catalog = next(r['reference'] for r in client.get('/api/species/catalog').json() if r['id'] == sid)
    exploration = next(r['reference'] for r in client.get('/api/exploration?on=2026-11-02').json() if r['id'] == sid)
    assert catalog == reference == exploration
    return reference['sighting_years']


def test_confirmation_replaces_previous_year_and_withdrawal_clears_without_restore(client):
    sid = setup_species(client)
    saved = observation(client, sid, 2024, identification='candidate')
    assert years(client, sid) == [2015]
    change = payload(saved)
    change['observations'][0]['identification'] = 'user_confirmed'
    response = client.put(f"/api/surveys/{saved['id']}", json=change)
    assert response.status_code == 200, response.text
    assert years(client, sid) == [2024]
    ref = client.get(f'/api/species/{sid}/reference').json()
    assert '2024-05-20' in ref['reference']['sighting_source']
    assert client.put(f'/api/species/{sid}/reference', json={**ref['reference'], 'expected_updated_at': ref['updated_at']}).status_code == 200
    change = payload(response.json())
    change['observations'][0]['identification'] = 'candidate'
    assert client.put(f"/api/surveys/{saved['id']}", json=change).status_code == 200
    assert years(client, sid) == []


def test_latest_actual_date_trash_restore_and_date_edit(client):
    sid = setup_species(client)
    observation(client, sid, 2022)
    saved = observation(client, sid, 2024, observation_date='2025-03-01')
    assert years(client, sid) == [2025]
    moved = client.request('DELETE', f"/api/surveys/{saved['id']}", json={'expected_updated_at': saved['updated_at']})
    assert moved.status_code == 200
    assert years(client, sid) == [2022]
    entry = moved.json()
    assert client.post(f"/api/trash/{entry['id']}/restore", json={'expected_deleted_at': entry['deleted_at']}).status_code == 200
    assert years(client, sid) == [2025]
    saved = client.get(f"/api/surveys/{saved['id']}").json()
    change = payload(saved)
    change['observations'][0]['observation_date'] = '2021-01-01'
    assert client.put(f"/api/surveys/{saved['id']}", json=change).status_code == 200
    assert years(client, sid) == [2022]


@pytest.mark.parametrize('place', ['Tokyo, Japan', '장소 미확인', '광주리 시험 장소'])
def test_foreign_unknown_and_partial_region_names_do_not_change_year(client, place):
    sid = setup_species(client)
    observation(client, sid, 2025, place_name=place, latitude=37, longitude=127)
    assert years(client, sid) == [2015]


def test_explicit_domestic_tag_and_individual_location_override(client):
    sid = setup_species(client)
    saved = observation(client, sid, 2024, place_name='섬 이름', tags=['국내 관찰 확인'])
    assert years(client, sid) == [2024]
    change = payload(saved)
    change['observations'][0]['tags'] = []
    assert client.put(f"/api/surveys/{saved['id']}", json=change).status_code == 200
    assert years(client, sid) == []
    observation(client, sid, 2025, latitude=37, longitude=127)
    assert years(client, sid) == []  # 개별 좌표를 탐사의 국내 주소와 임의로 결합하지 않습니다.


def test_inaturalist_country_requires_unchanged_location():
    row = dict(place_name='Island', latitude=33, longitude=126, survey_place='경기도',
               survey_latitude=37, survey_longitude=127, domestic_confirmed=False)
    original = dict(source='inaturalist', place_raw='Island', latitude=33, longitude=126,
                    original={'place_ids': [6891]})
    row['imported_payload'] = json.dumps(original)
    assert domestic_observation(row)
    row['longitude'] = 130
    assert not domestic_observation(row)
    row.update(place_name='경기도 시험 장소', longitude=126)
    original.update(place_raw='경기도 시험 장소', original={'place_ids': [6737]})
    row['imported_payload'] = json.dumps(original)
    assert not domestic_observation(row)


def test_species_change_recomputes_both_and_invalid_edit_rolls_back(client):
    first = setup_species(client)
    second = client.post('/api/species', json={'korean_name': '다른 미접 종'}).json()['id']
    assert client.put(f'/api/species/{second}/reference', json={'vagrant': True, 'source': '시험 자료'}).status_code == 200
    saved = observation(client, first, 2025)
    change = payload(saved)
    change['observations'][0]['species_id'] = second
    updated = client.put(f"/api/surveys/{saved['id']}", json=change)
    assert updated.status_code == 200
    assert years(client, first) == []
    assert years(client, second) == [2025]
    change = payload(updated.json())
    change['observations'][0]['species_id'] = 99999
    assert client.put(f"/api/surveys/{saved['id']}", json=change).status_code == 422
    assert years(client, second) == [2025]
    with connect_database() as db:
        raw = json.loads(db.execute('SELECT payload_json FROM species_references WHERE species_id=?', (first,)).fetchone()[0])
    assert raw['sighting_years'] == []


def test_naturing_pending_does_not_update_until_selected_registration(client):
    from test_collection import key, record as incoming
    sid = setup_species(client)
    token = key(client)
    item = {**incoming(), 'korean_name': '미접 시험 종', 'place_raw': '제주특별자치도 서귀포시'}
    response = client.post('/api/collection/naturing', json=item, headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 200
    assert years(client, sid) == [2015]
    item_id = client.get('/api/collection').json()['items'][0]['id']
    response = client.post('/api/collection/register', json={'ids': [item_id]}, headers={'X-Butterfly-Client': 'app'})
    assert response.status_code == 200, response.text
    assert response.json()['results'][0]['status'] == 'registered'
    assert years(client, sid) == [2026]


def test_paper_registration_uses_observation_not_publication_year(client, monkeypatch):
    from test_papers import collect, observation as paper_observation, HEADERS
    sid = setup_species(client)
    paper = collect(client, monkeypatch)
    assert paper['published'] == '2025-06'
    value = paper_observation(sid)
    value['survey']['place_name'] = '경상남도 시험 장소'
    response = client.post(f"/api/papers/{paper['id']}/observations", json=value, headers=HEADERS)
    assert response.status_code == 200, response.text
    assert years(client, sid) == [2020]
    saved = response.json()
    oid = saved['observations'][0]['id']
    removed = client.request('DELETE', f"/api/surveys/{saved['id']}/observations/{oid}",
                             json={'expected_updated_at': saved['updated_at']})
    assert removed.status_code == 200
    assert years(client, sid) == []
    entry = removed.json()
    assert client.request('DELETE', f"/api/trash/{entry['id']}", json={'expected_deleted_at': entry['deleted_at']}).status_code == 200
    assert years(client, sid) == []
