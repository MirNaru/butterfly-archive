"""외부 자료 인증·검증·중복·변경 이력과 개인 기록 격리를 검증합니다."""
import json
from test_integrations import client
from app.database import connect_database

def record():
    return dict(source='naturing', source_id='123', url='https://www.naturing.net/o/123', korean_name='시험 나비', scientific_name='', observed_raw='2026년 10월 29일', place_raw='공개 시험 장소', latitude=37.0, longitude=127.0, collected_at='2026-10-29T00:00:00Z')

def key(client):
    return client.post('/api/collection/connection', headers={'X-Butterfly-Client':'app'}).json()['token']

def test_collection_auth_validation_and_history(client):
    assert client.get('/api/collection').json() == {'total':0,'items':[]}
    assert client.post('/api/collection/connection').status_code == 403
    assert client.post('/api/collection/connection', headers={'X-Butterfly-Client':'app','Origin':'https://www.naturing.net'}).status_code == 403
    assert client.post('/api/collection/naturing', json=record()).status_code == 401
    token = key(client)
    headers = {'Authorization':f'Bearer {token}'}
    value = record()
    for bad in ({'latitude':100}, {'longitude':None}, {'url':'https://example.com'}, {'source_id':'../1'}, {'collected_at':'2026-01-01'}, {'review_status':'confirmed'}):
        assert client.post('/api/collection/naturing', json={**value,**bad}, headers=headers).status_code == 422
    assert client.post('/api/collection/naturing', json=value, headers=headers).json()['outcome'] == 'created'
    value['collected_at']='2026-10-29T01:00:00Z'
    assert client.post('/api/collection/naturing', json=value, headers=headers).json()['outcome'] == 'unchanged'
    value['place_raw']='수정된 공개 장소'
    assert client.post('/api/collection/naturing', json=value, headers=headers).json()['outcome'] == 'updated'
    result=client.get('/api/collection').json()
    assert result['total']==1 and result['items'][0]['place_raw']==value['place_raw']
    assert result['items'][0]['review_status']=='pending'
    with connect_database() as db:
        history=db.execute('SELECT payload_json FROM collection_revisions').fetchall()
        assert len(history)==1 and json.loads(history[0][0])['place_raw']=='공개 시험 장소'
        assert db.execute('SELECT count(*) FROM observations').fetchone()[0]==0
        assert db.execute('SELECT count(*) FROM api_usage').fetchone()[0]==0
        assert token not in db.execute('SELECT token_hash FROM collection_connection').fetchone()[0]
    key(client)
    assert client.post('/api/collection/naturing', json=value, headers=headers).status_code==401
    assert client.get('/api/collection?offset=25').json()['items']==[]

