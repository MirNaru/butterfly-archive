"""수집 단계 직접 수정·재수집 보존·등록과 충돌 처리를 임시 DB에서 검증합니다."""
import json
from test_integrations import client
from test_collection import record,key
from app.database import connect_database
from app.inaturalist import save_payload

HEADERS={'X-Butterfly-Client':'app'}


def naturing_item(client):
    client.post('/api/species',json={'korean_name':'네발나비'})
    value={**record(),'korean_name':'네발나비'}
    auth={'Authorization':f'Bearer {key(client)}'}
    client.post('/api/collection/naturing',json=value,headers=auth)
    return client.get('/api/collection').json()['items'][0],value,auth


def edit(client,item,stage):
    return client.put(f"/api/collection/{item['id']}/stage",json={'stage':stage,'expected_version':item['version']},headers=HEADERS)


def test_naturing_stage_saved_reloaded_resend_and_registered(client):
    item,value,auth=naturing_item(client)
    with connect_database() as db:
        before=json.loads(db.execute('SELECT payload_json FROM collected_observations').fetchone()[0])
    saved=edit(client,item,'egg')
    assert saved.status_code==200,saved.text
    listing=client.get('/api/collection').json()['items'][0]
    assert listing['stage_manual'] and listing['inferred_stage']=='egg'
    assert listing['version']==saved.json()['version']
    assert client.get('/api/surveys').json()==[]
    assert client.post('/api/collection/naturing',json=value,headers=auth).json()['outcome']=='unchanged'
    with connect_database() as db:
        after=json.loads(db.execute('SELECT payload_json FROM collected_observations').fetchone()[0])
        assert after.pop('_stage_override')=='egg' and after==before
    assert client.post('/api/collection/register',json={'ids':[item['id']]},headers=HEADERS).json()['results'][0]['status']=='registered'
    observation=client.get('/api/surveys').json()[0]['observations'][0]
    assert observation['stage']=='egg' and not observation['stage_inferred']
    assert observation['observation_date']=='2026-10-29'
    assert '사용자가 직접 수정' in observation['notes'] and '도감 기간으로 추정' not in observation['notes']
    with connect_database() as db:
        assert json.loads(db.execute('SELECT inference_json FROM collection_imports').fetchone()[0])['manual_stage_override']
    assert edit(client,listing,'pupa').status_code==409
    assert client.post('/api/collection/register',json={'ids':[item['id']]},headers=HEADERS).json()['results'][0]['status']=='already_registered'


def test_stage_validation_auth_conflict_discard_and_missing(client):
    item,value,auth=naturing_item(client)
    path=f"/api/collection/{item['id']}/stage"
    body={'stage':'pupa','expected_version':item['version']}
    assert client.put(path,json=body).status_code==403
    assert client.put(path,json={**body,'stage':'invalid'},headers=HEADERS).status_code==422
    assert edit(client,item,'larva').status_code==200
    assert edit(client,item,'adult').status_code==409
    fresh=client.get('/api/collection').json()['items'][0]
    assert edit(client,fresh,'unknown').status_code==200
    fresh=client.get('/api/collection').json()['items'][0]
    assert fresh['stage_manual'] and fresh['inferred_stage']=='unknown'
    client.post('/api/collection/discard',json={'ids':[item['id']]},headers=HEADERS)
    assert edit(client,fresh,'pupa').status_code==409
    assert client.put('/api/collection/99999/stage',json=body,headers=HEADERS).status_code==404


def test_inaturalist_stage_survives_source_update_and_register(client):
    client.post('/api/species',json={'korean_name':'호랑나비','scientific_name':'Papilio xuthus'})
    payload={'source':'inaturalist','source_id':'123','url':'https://www.inaturalist.org/observations/123',
             'korean_name':'Papilio xuthus','scientific_name':'Papilio xuthus','observed_raw':'2026-05-10',
             'observed_date':'2026-05-10','observed_time':None,'place_raw':'Jeju, South Korea',
             'latitude':33.36,'longitude':126.53,'original':{},'location_accuracy':50}
    with connect_database() as db: save_payload(db,payload,'2026-11-02T01:00:00Z')
    item=client.get('/api/collection?source=inaturalist').json()['items'][0]
    assert edit(client,item,'pupa').status_code==200
    with connect_database() as db:
        assert save_payload(db,{**payload,'place_raw':'Jeju Island'},'2026-11-02T02:00:00Z')=='updated'
    fresh=client.get('/api/collection?source=inaturalist').json()['items'][0]
    assert fresh['inferred_stage']=='pupa' and fresh['stage_manual']
    client.post('/api/collection/register',json={'ids':[fresh['id']]},headers=HEADERS)
    observed=client.get('/api/surveys').json()[0]['observations'][0]
    assert observed['stage']=='pupa' and not observed['stage_inferred']
    assert observed['observation_date']=='2026-05-10'


def test_species_override_preserves_original_resend_and_registration(client):
    item,value,auth=naturing_item(client)
    target=client.post('/api/species',json={'korean_name':'산호랑나비','scientific_name':'Papilio machaon'}).json()
    path=f"/api/collection/{item['id']}/stage"
    body={'stage':'adult','species_id':target['id'],'expected_version':item['version']}
    assert client.put(path,json={**body,'species_id':999999},headers=HEADERS).status_code==422
    assert client.put(path,json=body,headers=HEADERS).status_code==200
    assert client.put(path,json=body,headers=HEADERS).status_code==409
    fresh=client.get('/api/collection').json()['items'][0]
    assert fresh['species_id']==target['id'] and fresh['korean_name']=='산호랑나비'
    assert client.post('/api/collection/naturing',json=value,headers=auth).json()['outcome']=='unchanged'
    with connect_database() as db:
        payload=json.loads(db.execute('SELECT payload_json FROM collected_observations').fetchone()[0])
        assert payload['korean_name']=='네발나비' and payload['_species_override']==target['id']
    client.post('/api/collection/register',json={'ids':[item['id']]},headers=HEADERS)
    assert client.get('/api/surveys').json()[0]['observations'][0]['species_id']==target['id']
    assert client.put(path,json={**body,'expected_version':fresh['version']},headers=HEADERS).status_code==409


def test_observed_sort_before_pagination_and_unknown_last(client):
    auth={'Authorization':f'Bearer {key(client)}'}
    for source_id,raw in [('1','2026년 2월 1일'),('2','미상'),('3','2025년 12월 31일')]:
        client.post('/api/collection/naturing',json={**record(),'source_id':source_id,'url':f'https://www.naturing.net/o/{source_id}','observed_raw':raw},headers=auth)
    asc=client.get('/api/collection?sort=asc&limit=1').json()
    assert asc['total']==3 and asc['items'][0]['source_id']=='3'
    assert client.get('/api/collection?sort=desc&limit=1').json()['items'][0]['source_id']=='1'
    assert client.get('/api/collection?sort=asc&offset=2').json()['items'][0]['source_id']=='2'
    assert client.get('/api/collection?sort=invalid').status_code==422


def test_inaturalist_species_override_and_time_sort(client):
    original=client.post('/api/species',json={'korean_name':'호랑나비','scientific_name':'Papilio xuthus'}).json()
    target=client.post('/api/species',json={'korean_name':'산호랑나비','scientific_name':'Papilio machaon'}).json()
    payload={'source':'inaturalist','source_id':'11','url':'https://www.inaturalist.org/observations/11',
             'korean_name':'Papilio xuthus','scientific_name':'Papilio xuthus','observed_raw':'2026-05-10',
             'observed_date':'2026-05-10','observed_time':'10:00:00','place_raw':'Jeju, South Korea',
             'latitude':33.36,'longitude':126.53,'original':{},'location_accuracy':50}
    with connect_database() as db:
        save_payload(db,payload,'2026-11-02T01:00:00Z')
        save_payload(db,{**payload,'source_id':'12','url':'https://www.inaturalist.org/observations/12','observed_time':'09:00:00'},'2026-11-02T01:00:00Z')
    item=client.get('/api/collection?source=inaturalist&sort=desc&limit=1').json()['items'][0]
    assert item['source_id']=='11' and item['species_id']==original['id']
    assert client.get('/api/collection?source=inaturalist&sort=asc&limit=1').json()['items'][0]['source_id']=='12'
    assert client.put(f"/api/collection/{item['id']}/stage",json={'stage':'adult','species_id':target['id'],'expected_version':item['version']},headers=HEADERS).status_code==200
    with connect_database() as db:
        save_payload(db,{**payload,'place_raw':'Jeju Island'},'2026-11-02T02:00:00Z')
    fresh=client.get('/api/collection?source=inaturalist&sort=desc').json()['items'][0]
    assert fresh['species_id']==target['id'] and fresh['scientific_name']=='Papilio machaon'
    client.post('/api/collection/register',json={'ids':[fresh['id']]},headers=HEADERS)
    assert client.get('/api/surveys').json()[0]['observations'][0]['species_id']==target['id']
