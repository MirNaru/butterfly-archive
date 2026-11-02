"""등록 시 검수 상태와 온라인 조사 목적을 저장 후 재조회하여 확인합니다."""
from test_records import client, species, survey


def test_indirect_registration_and_edit_are_reviewed(client):
    sid = species(client)
    value = survey(observations=[dict(species_id=sid, source_type='indirect',
                                     source_note='https://example.org/observation', stage='egg')])
    response = client.post('/api/surveys', json=value)
    assert response.status_code == 201
    saved = response.json()
    assert saved['purpose'] == 'online_research'
    assert saved['observations'][0]['identification'] == 'user_confirmed'
    value['observations'][0].update(id=saved['observations'][0]['id'], stage='pupa')
    value['expected_updated_at'] = saved['updated_at']
    response = client.put(f"/api/surveys/{saved['id']}", json=value)
    assert response.status_code == 200, response.text
    reread = client.get(f"/api/surveys/{saved['id']}").json()
    assert reread['purpose'] == 'online_research'
    assert reread['observations'][0]['stage'] == 'pupa'
    assert reread['observations'][0]['identification'] == 'user_confirmed'


def test_direct_unknown_absence_are_preserved(client):
    sid = species(client)
    response = client.post('/api/surveys', json=survey(purpose='target', observations=[
        dict(species_id=sid),
        dict(species_id=None),
        dict(species_id=sid, result='not_found', capture_status='not_captured'),
    ]))
    assert response.status_code == 201, response.text
    saved = client.get(f"/api/surveys/{response.json()['id']}").json()
    assert saved['purpose'] == 'target'
    assert [item['identification'] for item in saved['observations']] == [
        'user_confirmed', 'unidentified', 'unidentified']


def test_mixed_sources_rejected_on_create_and_update(client):
    sid = species(client)
    mixed = survey(observations=[dict(species_id=sid), dict(species_id=sid,source_type='indirect',source_note='논문')])
    assert client.post('/api/surveys', json=mixed).status_code == 422
    assert client.get('/api/surveys').json() == []
    saved = client.post('/api/surveys',json=survey(observations=[dict(species_id=sid)])).json()
    mixed['observations'][0]['id'] = saved['observations'][0]['id']
    mixed['expected_updated_at'] = saved['updated_at']
    assert client.put(f"/api/surveys/{saved['id']}",json=mixed).status_code == 422
    assert client.get(f"/api/surveys/{saved['id']}").json() == saved
