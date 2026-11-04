"""제공자 연결명과 검토 후보의 종 연결·충돌·보존을 시험 DB에서 검사합니다."""
from test_integrations import client
from app.database import connect_database
from app.collection_import import registration_info

HEADERS = {'X-Butterfly-Client': 'app'}


def species(client, name='시험 나비', scientific='Oldgenus example'):
    return client.post('/api/species', json={'korean_name': name, 'scientific_name': scientific}).json()['id']


def save(client, sid, status='linked'):
    doc=client.get(f'/api/species/{sid}/reference').json()
    return client.put(f'/api/species/{sid}/reference',json={**doc['reference'],
        'expected_updated_at':doc['updated_at'], 'inaturalist_names':[
            {'name':'Newgenus example','taxon_id':123,'status':status,'source':'사용자 확인','notes':'대표 학명 유지'}]})


def info(taxon=123):
    with connect_database() as db:
        return registration_info(db, {'source':'inaturalist','korean_name':'provider name',
            'scientific_name':'Newgenus example','original':{'taxon':{'id':taxon}},
            'observed_date':'2026-05-10','place_raw':'시험 위치','latitude':37.0,'longitude':127.0})


def test_linked_name_and_taxon_id_required(client):
    sid=species(client)
    assert save(client,sid).status_code==200
    assert info()['species_id']==sid
    assert info(999)['species_id'] is None
    assert client.get('/api/species').json()[0]['scientific_name']=='Oldgenus example'


def test_pending_and_ambiguous_names_never_auto_merge(client):
    first=species(client)
    assert save(client,first,'pending').status_code==200
    assert info()['species_id'] is None
    assert save(client,first).status_code==200
    second=species(client,'다른 종','Newgenus example')
    assert second!=first and info()['species_id'] is None


def test_legacy_reference_save_preserves_links_and_duplicate_rejected(client):
    sid=species(client)
    assert save(client,sid).status_code==200
    doc=client.get(f'/api/species/{sid}/reference').json()
    value=doc['reference']; aliases=value.pop('inaturalist_names')
    r=client.put(f'/api/species/{sid}/reference',json={**value,'expected_updated_at':doc['updated_at']})
    assert r.status_code==200 and r.json()['reference']['inaturalist_names']==aliases
    assert client.put(f'/api/species/{sid}/reference',json={**r.json()['reference'],
        'expected_updated_at':r.json()['updated_at'],'inaturalist_names':aliases*2}).status_code==422


def test_two_alias_owners_conflict_and_registered_original_preserved(client):
    import json
    from app.inaturalist import save_payload
    first=species(client)
    assert save(client,first).status_code==200
    payload={'source':'inaturalist','source_id':'123','url':'https://www.inaturalist.org/observations/123',
        'korean_name':'외부 원문 종','scientific_name':'Newgenus example','original':{'taxon':{'id':123}},
        'observed_raw':'2026-05-10','observed_date':'2026-05-10','place_raw':'공개 시험 위치',
        'latitude':37.0,'longitude':127.0,'weather_raw':''}
    with connect_database() as db:save_payload(db,payload,'2026-11-04T00:00:00Z')
    item=client.get('/api/collection?source=inaturalist').json()['items'][0]
    assert item['species_id']==first
    assert client.post('/api/collection/register',json={'ids':[item['id']]},headers=HEADERS).status_code==200
    with connect_database() as db:
        snapshot=json.loads(db.execute('SELECT payload_json FROM collection_imports').fetchone()[0])
        assert snapshot['scientific_name']=='Newgenus example'
    second=species(client,'다른 나비','Anothergenus example')
    assert save(client,second).status_code==200
    assert info()['species_id'] is None
