"""위치 없는 수동 수집의 검수·간접 등록과 직접 관찰 제한을 검증합니다."""
from test_integrations import client
from test_collection import record, key


def test_locationless_manual_review_register_and_edit(client):
    sid=client.post('/api/species',json={'korean_name':'시험 나비'}).json()['id']
    auth={'Authorization':f'Bearer {key(client)}'}
    value={**record(),'place_raw':'','latitude':None,'longitude':None,'manual_capture':True,'location_status':'private_location'}
    assert client.post('/api/collection/naturing',json=value,headers=auth).status_code==200
    item=client.get('/api/collection').json()['items'][0]
    assert item['eligible'] and item['latitude'] is None
    headers={'X-Butterfly-Client':'app'}
    assert client.put(f"/api/collection/{item['id']}/stage",json={'stage':'pupa','species_id':sid,'expected_version':item['version']},headers=headers).status_code==200
    response=client.post('/api/collection/register',json={'ids':[item['id']]},headers=headers)
    assert response.status_code==200 and response.json()['results'][0]['status']=='registered'
    saved=client.get('/api/surveys').json()[0]
    assert saved['purpose']=='online_research' and saved['place_name']==''
    assert saved['observations'][0]['source_type']=='indirect'
    assert saved['observations'][0]['effective_latitude'] is None
    for bad in ({'manual_capture':False},{'latitude':37,'longitude':127},{'place_raw':'비공개 위치'}):
        assert client.post('/api/collection/naturing',json={**value,**bad},headers=auth).status_code==422


def test_direct_observation_still_requires_location(client):
    value={'survey_date':'2026-05-10','place_name':'','observations':[{'source_type':'direct'}]}
    assert client.post('/api/surveys',json=value).status_code==422
    assert client.post('/api/surveys',json={'survey_date':'2026-05-10','place_name':'','observations':[]}).status_code==422
