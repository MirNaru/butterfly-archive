"""모바일의 인증 경계·메타데이터 보존·중복·직접 관찰 등록을 시험 DB로 확인합니다."""
import json
import time
import pytest
from fastapi.testclient import TestClient
from test_integrations import client
from app.mobile import COOKIE
DOMAIN='https://192.168.75.181:8443'
from app.mobile_server import app as mobile_app
from app.database import connect_database

PC = {'X-Butterfly-Client':'app'}
HEADERS = {'Origin':DOMAIN,'X-Butterfly-Mobile':'1'}


@pytest.fixture
def remote(client,tmp_path,monkeypatch):
    config=tmp_path/'lan.json'
    config.write_text(json.dumps({'url':DOMAIN,'ip':'192.168.75.181','networks':['192.168.75.0/24','192.168.45.0/24','127.0.0.0/8']}))
    monkeypatch.setenv('BUTTERFLY_LAN_CONFIG',str(config))
    with TestClient(mobile_app, base_url=DOMAIN,client=('192.168.45.12',50000)) as remote:
        yield remote


def authenticate(client, remote):
    result = client.post('/api/mobile/connection', headers=PC).json()
    code = result['code']
    response = remote.post('/m/api/login',json={'code':code,'label':'시험 갤럭시'},headers=HEADERS)
    assert response.status_code == 200
    assert 'Secure' in response.headers['set-cookie'] and 'HttpOnly' in response.headers['set-cookie']
    return code


def photo(sha='a'*64):
    return dict(sha256=sha,filename='test.jpg',format='JPEG',size_bytes=1234,camera='test',taken_at_raw='2026:05:10 23:30:00',offset_raw='-04:00',latitude=37.1,longitude=127.2)


def test_remote_has_no_pc_routes_and_requires_https_and_origin(remote):
    assert remote.get('/api/surveys').status_code == 404
    assert remote.get('/api/mobile/connection').status_code == 404
    assert remote.get('/docs').status_code == 404
    assert remote.get('/openapi.json').status_code == 404
    assert remote.get('/m/api/session').status_code == 401
    assert remote.get('http://archive.mirnaru.kro.kr/').status_code == 400
    assert remote.get('/',headers={'Host':'other.test'}).status_code == 400
    assert remote.post('/m/api/login',json={'code':'a'*12}).status_code == 403
    assert remote.post('/m/api/login',content='x'*32769,headers={**HEADERS,'Content-Type':'application/json'}).status_code == 413
    assert remote.get('/').headers['cache-control'] == 'no-store'


def test_wan_client_cannot_open_lan_upload_even_with_forwarded_header(remote):
    with TestClient(mobile_app,base_url=DOMAIN,client=('198.51.100.2',50000)) as outside:
        assert outside.get('/',headers={'X-Forwarded-For':'192.168.45.12'}).status_code==403
        assert outside.post('/m/api/photos',json=photo(),headers=HEADERS).status_code==403


def test_one_time_code_expiry_and_revoke(client,remote):
    code = authenticate(client,remote)
    assert remote.get('/m/api/session').status_code == 200
    assert remote.post('/m/api/login',json={'code':code},headers=HEADERS).status_code == 401
    status = client.get('/api/mobile/status').json()
    assert len(status['sessions']) == 1
    assert 'token_hash' not in status['sessions'][0]
    client.post('/api/mobile/revoke',json={'id':status['sessions'][0]['id']},headers=PC)
    assert remote.get('/m/api/session').status_code == 401
    new = client.post('/api/mobile/connection',headers=PC).json()
    with connect_database() as db:
        db.execute('UPDATE mobile_settings SET code_expires=?',(time.time()-1,))
    assert remote.post('/m/api/login',json={'code':new['code']},headers=HEADERS).status_code == 401


def test_metadata_duplicate_register_and_rollback(client,remote):
    authenticate(client,remote)
    response=remote.post('/m/api/photos',json=photo(),headers=HEADERS)
    assert response.status_code == 200
    item_id=response.json()['id']
    assert remote.post('/m/api/photos',json=photo(),headers=HEADERS).json()['status']=='duplicate'
    assert remote.post('/m/api/photos',json={**photo(),'longitude':None},headers=HEADERS).status_code==422
    listing=client.get('/api/mobile/photos').json()
    assert listing['total']==1
    metadata=listing['items'][0]['metadata']
    assert metadata['date_candidate']=='2026-05-11' and metadata['time_candidate']=='12:30:00'
    assert metadata['taken_at_raw']=='2026:05:10 23:30:00'
    assert client.get('/api/surveys').json()==[]
    species=client.post('/api/species',json={'korean_name':'시험나비'}).json()['id']
    survey=dict(survey_date='2026-05-11',latitude=37.1,longitude=127.2,observations=[dict(species_id=species,stage='adult',source_type='direct')])
    assert client.post('/api/mobile/register',json={'ids':[item_id],'survey':survey}).status_code==403
    bad={**survey,'observations':[dict(species_id=999,source_type='direct')]}
    assert client.post('/api/mobile/register',json={'ids':[item_id],'survey':bad},headers=PC).status_code==422
    assert client.get('/api/mobile/photos').json()['total']==1
    result=client.post('/api/mobile/register',json={'ids':[item_id],'survey':survey},headers=PC)
    assert result.status_code==200, result.text
    assert result.json()['observations'][0]['source_type']=='direct'
    assert result.json()['observations'][0]['identification']=='user_confirmed'
    assert result.json()['observations'][0]['photo_ids']
    assert client.get('/api/surveys').json()==[result.json()]
    assert client.get('/api/mobile/photos').json()['total']==0
    assert client.post('/api/mobile/register',json={'ids':[item_id],'survey':survey},headers=PC).status_code==409
    assert len(client.get('/api/surveys').json())==1
    saved=client.get('/api/photos/library').json()['items'][0]
    assert saved['taken_at_raw']==photo()['taken_at_raw'] and not saved['original_stored']


def test_group_photos_discard_missing_metadata_disable(client,remote):
    authenticate(client,remote)
    value=photo();value.update(taken_at_raw='',offset_raw='',latitude=None,longitude=None)
    first=remote.post('/m/api/photos',json=value,headers=HEADERS).json()['id']
    second=remote.post('/m/api/photos',json=photo('b'*64),headers=HEADERS).json()['id']
    listing=client.get('/api/mobile/photos').json()
    missing=next(i['metadata'] for i in listing['items'] if i['id']==first)
    assert missing['date_candidate'] is None and missing['latitude'] is None
    client.post('/api/mobile/discard',json={'ids':[first]},headers=PC)
    assert client.get('/api/mobile/photos').json()['total']==1
    assert remote.post('/m/api/photos',json=value,headers=HEADERS).json()['existing_status']=='discarded'
    client.post('/api/mobile/disable',headers=PC)
    assert remote.post('/m/api/photos',json=photo('c'*64),headers=HEADERS).status_code==401


def test_login_limit_counts_failures(client,remote):
    client.post('/api/mobile/connection',headers=PC)
    for _ in range(12):
        assert remote.post('/m/api/login',json={'code':'0'*12},headers=HEADERS).status_code==401
    assert remote.post('/m/api/login',json={'code':'0'*12},headers=HEADERS).status_code==429


def test_mobile_migration_from_thirteen_preserves_rows_and_rolls_back(client,monkeypatch):
    from app import migrations
    from app.database import database_path
    import sqlite3
    client.post('/api/species',json={'korean_name':'보존 시험'})
    with connect_database() as db:
        before=[tuple(r) for r in db.execute('SELECT * FROM species')]
        for table in ('mobile_photos','mobile_limits','mobile_sessions','mobile_settings'):
            db.execute('DROP TABLE '+table)
        db.execute('PRAGMA user_version=13')
    with monkeypatch.context() as patch:
        patch.setattr(migrations,'MOBILE_STATEMENTS',migrations.MOBILE_STATEMENTS+('INVALID SQL',))
        with pytest.raises(sqlite3.Error):migrations.initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==13
        assert [tuple(r) for r in db.execute('SELECT * FROM species')]==before
        assert not db.execute("SELECT name FROM sqlite_master WHERE name LIKE 'mobile_%'").fetchall()
    migrations.initialize_database();migrations.initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==14
        assert [tuple(r) for r in db.execute('SELECT * FROM species')]==before
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    assert list(database_path().parent.glob('*.before-v14-*.bak'))
