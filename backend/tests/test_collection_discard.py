"""수집 자료 삭제·취소 시 원문 및 등록 관찰의 보존을 검사합니다."""
from test_integrations import client
from test_collection import record, key
from app.database import connect_database

APP_HEADERS={'X-Butterfly-Client':'app'}

def test_discard_review_needed_record_restore_and_resend(client):
    headers={'Authorization':f'Bearer {key(client)}'}
    value=record()
    item_id=client.post('/api/collection/naturing',json=value,headers=headers).json()['id']
    assert not client.get('/api/collection').json()['items'][0]['eligible']
    assert client.post('/api/collection/discard',json={'ids':[item_id]}).status_code==403
    assert client.post('/api/collection/discard',json={'ids':[]},headers=APP_HEADERS).status_code==422
    assert client.post('/api/collection/discard',json={'ids':[item_id,item_id,999]},headers=APP_HEADERS).json()['ids']==[item_id]
    assert client.get('/api/collection').json()=={'total':0,'items':[]}
    assert client.post('/api/collection/register',json={'ids':[item_id]},headers=APP_HEADERS).json()['results'][0]['status']=='skipped'
    value['place_raw']='수정된 공개 장소'
    assert client.post('/api/collection/naturing',json=value,headers=headers).json()['id']==item_id
    assert client.get('/api/collection').json()['total']==0
    with connect_database() as db:
        assert db.execute('SELECT count(*) FROM collected_observations').fetchone()[0]==1
        assert db.execute('SELECT count(*) FROM collection_revisions').fetchone()[0]==1
    assert client.post('/api/collection/restore',json={'ids':[item_id]},headers=APP_HEADERS).json()['ids']==[item_id]
    restored=client.get('/api/collection').json()
    assert restored['total']==1 and restored['items'][0]['place_raw']==value['place_raw']

def test_discard_registered_collection_keeps_observation_and_link(client):
    client.post('/api/species',json={'korean_name':'네발나비'})
    headers={'Authorization':f'Bearer {key(client)}'}
    item_id=client.post('/api/collection/naturing',json={**record(),'korean_name':'네발나비'},headers=headers).json()['id']
    client.post('/api/collection/register',json={'ids':[item_id]},headers=APP_HEADERS)
    before=client.get('/api/surveys').json()
    client.post('/api/collection/discard',json={'ids':[item_id]},headers=APP_HEADERS)
    assert client.get('/api/collection').json()['total']==0
    assert client.get('/api/surveys').json()==before
    client.post('/api/collection/restore',json={'ids':[item_id]},headers=APP_HEADERS)
    assert client.get('/api/collection').json()['total']==0
    with connect_database() as db:
        assert db.execute('SELECT observation_id FROM collection_imports WHERE item_id=?',(item_id,)).fetchone()[0]==before[0]['observations'][0]['id']
    assert client.post('/api/collection/register',json={'ids':[item_id]},headers=APP_HEADERS).json()['results'][0]['status']=='already_registered'
