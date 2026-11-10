"""선택 등록의 출처 보존·단계 추정·중복과 등록 제한을 검사합니다."""
import json
from datetime import date
from test_integrations import client
from test_collection import record, key
from app.database import connect_database
from app.collection_import import EXEMPT_SPECIES, infer_stage, observed_datetime

APP_HEADERS = {'X-Butterfly-Client':'app'}

def test_stage_inference_and_original_time():
    assert len(EXEMPT_SPECIES) == 31
    assert observed_datetime('2026년 5월 10일 오전 12시')[1].hour == 0
    assert observed_datetime('2026년 5월 10일 오후 12시')[1].hour == 12
    periods = [dict(stage=s, start=13, end=15, enabled=True) for s in ('egg','larva','pupa','adult')]
    result = infer_stage({'lifecycle':periods}, date(2026,5,11), '')
    assert result['stage']=='adult' and result['slot']==14
    periods[-1]['enabled']=False
    assert infer_stage({'lifecycle':periods}, date(2026,5,11), '')['stage']=='pupa'
    assert infer_stage({'lifecycle':periods}, date(2026,8,1), '')['stage']=='unknown'
    assert infer_stage({'lifecycle':[dict(stage='egg',start=31,end=6)]}, date(2024,2,29),'')['stage']=='egg'
    assert infer_stage({'lifecycle':[dict(stage='adult',start=1,end=36,region='제주')]}, date(2026,5,11),'서울')['stage']=='unknown'
    assert infer_stage({'periods':[dict(start=13,end=15)]},date(2026,5,11),'')['stage']=='adult'

def test_register_selected_preserves_original_and_skips_duplicates(client):
    species_id=client.post('/api/species',json={'korean_name':'네발나비'}).json()['id']
    with connect_database() as db:
        reference={'lifecycle':[dict(id='a',stage='larva',start=28,end=32,enabled=True,source='시험 도감'),dict(id='b',stage='adult',start=29,end=33,enabled=True,source='시험 도감')]}
        db.execute('INSERT INTO species_references VALUES(?,?,?)',(species_id,json.dumps(reference),'test'))
    headers={'Authorization':f'Bearer {key(client)}'}
    value={**record(),'korean_name':'네발나비\n\n-aureum','weather_raw':'기온 11.5℃'}
    item_id=client.post('/api/collection/naturing',json=value,headers=headers).json()['id']
    preview=client.get('/api/collection').json()['items'][0]
    assert preview['eligible'] and preview['inferred_stage']=='adult' and preview['observation_id'] is None
    assert client.post('/api/collection/register',json={'ids':[item_id]}).status_code==403
    assert client.post('/api/collection/register',json={'ids':[]},headers=APP_HEADERS).status_code==422
    result=client.post('/api/collection/register',json={'ids':[item_id,item_id]},headers=APP_HEADERS)
    assert result.status_code==200 and len(result.json()['results'])==1
    assert result.json()['results'][0]['status']=='registered'
    surveys=client.get('/api/surveys').json()
    assert result.json()['surveys'] == surveys
    observation=surveys[0]['observations'][0]
    assert observation['source_type']=='indirect' and observation['source_note']==value['url']
    assert observation['observation_date']=='2026-10-29' and observation['stage']=='adult'
    assert observation['latitude']==37.0 and observation['count'] is None
    assert observation['identification']=='user_confirmed' and '추정' in observation['notes']
    assert value['weather_raw'] in observation['notes'] and value['observed_raw'] in observation['notes']
    assert observation['source_weather']==dict(text=value['weather_raw'],source='네이처링',url=value['url'],stale=False)
    assert client.get('/api/collection').json()=={'total':0,'items':[]}
    assert client.post('/api/collection/register',json={'ids':[item_id]},headers=APP_HEADERS).json()['results'][0]['status']=='already_registered'
    value['place_raw']='바뀐 원문 장소'
    client.post('/api/collection/naturing',json=value,headers=headers)
    assert client.get('/api/collection').json()=={'total':0,'items':[]}
    assert client.get('/api/surveys').json()==surveys
    with connect_database() as db:
        saved=db.execute('SELECT * FROM collection_imports').fetchone()
        assert json.loads(saved['inference_json'])['reference_snapshot']==reference
        assert '공개 시험 장소' in saved['payload_json']
        assert db.execute('SELECT count(*) FROM api_usage').fetchone()[0]==0
        db.execute('UPDATE observations SET observation_date=? WHERE id=?',('2026-10-28',observation['id']))
    assert client.get('/api/surveys').json()[0]['observations'][0]['source_weather']['stale']

def test_review_needed_and_invalid_dates_are_not_registered(client):
    headers={'Authorization':f'Bearer {key(client)}'}
    client.post('/api/species',json={'korean_name':'네발나비'})
    ids=[]
    for n, changes in enumerate([{}, {'korean_name':'네발나비','observed_raw':'2026년 2월 30일'}, {'korean_name':'네발나비','observed_raw':'2026년 10월 29일 오후 13시'}, {'korean_name':'네발나비','place_raw':'','latitude':None,'longitude':None}],1):
        value={**record(), 'source_id':str(n),'url':f'https://www.naturing.net/o/{n}', **changes}
        ids.append(client.post('/api/collection/naturing',json=value,headers=headers).json()['id'])
    result=client.post('/api/collection/register',json={'ids':ids+[999]},headers=APP_HEADERS).json()
    assert all(row['status']=='skipped' for row in result['results'])
    assert client.get('/api/surveys').json()==[]

def test_register_without_lifecycle_keeps_unknown(client):
    client.post('/api/species',json={'korean_name':'네발나비'})
    headers={'Authorization':f'Bearer {key(client)}'}
    item_id=client.post('/api/collection/naturing',json={**record(),'korean_name':'네발나비'},headers=headers).json()['id']
    client.post('/api/collection/register',json={'ids':[item_id]},headers=APP_HEADERS)
    assert client.get('/api/surveys').json()[0]['observations'][0]['stage']=='unknown'
    assert client.get('/api/surveys').json()[0]['observations'][0]['source_weather'] is None

def test_non_exempt_selection_is_user_reviewed(client):
    client.post('/api/species',json={'korean_name':'모시나비'})
    headers={'Authorization':f'Bearer {key(client)}'}
    item_id=client.post('/api/collection/naturing',json={**record(),'korean_name':'모시나비'},headers=headers).json()['id']
    preview=client.get('/api/collection').json()['items'][0]
    assert preview['eligible'] and not preview['exempt']
    result=client.post('/api/collection/register',json={'ids':[item_id]},headers=APP_HEADERS).json()
    assert result['results'][0]['status']=='registered'
    observation=client.get('/api/surveys').json()[0]['observations'][0]
    assert observation['identification']=='user_confirmed'
    assert '사용자가 체크하여 검수 완료' in observation['notes']

def test_registered_weather_survives_trash_restore_and_inbox_stays_empty(client):
    client.post('/api/species',json={'korean_name':'모시나비'})
    headers={'Authorization':f'Bearer {key(client)}'}
    value={**record(),'korean_name':'모시나비','weather_raw':'구름 | 기온 20℃'}
    item_id=client.post('/api/collection/naturing',json=value,headers=headers).json()['id']
    client.post('/api/collection/register',json={'ids':[item_id]},headers=APP_HEADERS)
    survey=client.get('/api/surveys').json()[0]
    observation=survey['observations'][0]
    removed=client.request('DELETE',f"/api/surveys/{survey['id']}/observations/{observation['id']}",json={'expected_updated_at':survey['updated_at']})
    assert removed.status_code==200
    assert client.get('/api/surveys').json()[0]['observations']==[]
    assert client.get('/api/collection').json()['total']==0
    entry=client.get('/api/trash').json()[0]
    assert client.post(f"/api/trash/{entry['id']}/restore",json={'expected_deleted_at':entry['deleted_at']}).status_code==200
    assert client.get('/api/surveys').json()[0]['observations'][0]['source_weather']==observation['source_weather']
    assert client.get('/api/collection').json()['total']==0

def test_manual_stage_edit_overrides_inference_and_preserves_weather(client):
    from test_updates import payload
    client.post('/api/species',json={'korean_name':'모시나비'})
    headers={'Authorization':f'Bearer {key(client)}'}
    item_id=client.post('/api/collection/naturing',json={**record(),'korean_name':'모시나비','weather_raw':'기온 20℃'},headers=headers).json()['id']
    client.post('/api/collection/register',json={'ids':[item_id]},headers=APP_HEADERS)
    original=client.get('/api/surveys').json()[0]
    body=payload(original); body['observations'][0]['stage']='adult'
    saved=client.put(f"/api/surveys/{original['id']}",json=body)
    assert saved.status_code==200,saved.text
    observation=saved.json()['observations'][0]
    assert observation['stage']=='adult' and not observation['stage_inferred']
    assert observation['collection_accepted'] and '사용자가 직접 수정' in observation['notes']
    assert observation['source_weather']==original['observations'][0]['source_weather']
    assert client.get('/api/surveys').json()[0]==saved.json()
    assert client.get('/api/collection').json()['total']==0
    with connect_database() as db:
        metadata=json.loads(db.execute('SELECT inference_json FROM collection_imports').fetchone()[0])
        assert metadata['manual_stage_override']
        assert metadata['manual_stage_history'][0]['to']=='adult'

def test_migration_from_ten_preserves_existing_rows(client):
    from app.migrations import initialize_database, SCHEMA_VERSION
    client.post('/api/species',json={'korean_name':'네발나비'})
    with connect_database() as db:
        for table in ('mobile_photos','mobile_limits','mobile_sessions','mobile_settings'):
            db.execute('DROP TABLE '+table)
        db.execute('DROP TABLE collection_imports')
        db.execute('DROP TABLE paper_files')
        db.execute('DROP TABLE paper_observations')
        db.execute('DROP TABLE papers')
        db.execute('ALTER TABLE tags DROP COLUMN category')
        db.execute('PRAGMA user_version=10')
        before=[tuple(r) for r in db.execute('SELECT * FROM species')]
    initialize_database()
    initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
        assert before==[tuple(r) for r in db.execute('SELECT * FROM species')]
        assert db.execute('SELECT count(*) FROM collection_imports').fetchone()[0]==0
        assert not db.execute('PRAGMA foreign_key_check').fetchall()

def test_batch_stage_updates_only_selected_and_rolls_back_on_conflict(client):
    first_species = client.post('/api/species', json={'korean_name': '네발나비'}).json()['id']
    second_species = client.post('/api/species', json={'korean_name': '모시나비'}).json()['id']
    headers = {'Authorization': f'Bearer {key(client)}'}
    ids = []
    for n, name in enumerate(['네발나비', '모시나비', '네발나비'], 1):
        item = {**record(), 'source_id': str(n), 'url': f'https://www.naturing.net/o/{n}', 'korean_name': name}
        ids.append(client.post('/api/collection/naturing', json=item, headers=headers).json()['id'])

    def listing():
        return {row['id']: row for row in client.get('/api/collection').json()['items']}

    original = listing()
    targets = [{'id': item_id, 'expected_version': original[item_id]['version']} for item_id in ids[:2]]
    route = '/api/collection/batch/stage'
    bad_targets = [targets[0], {**targets[1], 'expected_version': '0' * 64}]
    assert client.put(route, headers=APP_HEADERS, json={'stage': 'pupa', 'items': bad_targets}).status_code == 409
    assert listing() == original
    assert client.put(route, headers=APP_HEADERS, json={'stage': 'pupa', 'items': targets}).json() == {'ids': ids[:2]}
    current = listing()
    assert [current[i]['species_id'] for i in ids] == [first_species, second_species, first_species]
    assert all(current[i]['inferred_stage'] == 'pupa' and current[i]['stage_manual'] for i in ids[:2])
    assert current[ids[2]] == original[ids[2]]
    assert client.get('/api/surveys').json() == []
