"""원본 DB와 조회 사본·인증을 분리하고 외부 쓰기 경로를 거절하는지 검증합니다."""
import http.client
import json
import secrets
import threading
import time
import sqlite3
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import viewer_server
from test_integrations import client
from app.database import database_path

HEADERS={'X-Butterfly-Client':'app'}


def test_legacy_auth_migration_preserves_sessions(tmp_path):
    (tmp_path/'auth').mkdir()
    with sqlite3.connect(tmp_path/'auth/viewer.sqlite3') as db:
        db.execute('CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,label TEXT NOT NULL,expires REAL NOT NULL)')
        db.execute("INSERT INTO sessions VALUES('existing','personal',123)")
    viewer_server.initialize_auth(tmp_path)
    viewer_server.initialize_auth(tmp_path)
    with viewer_server.connect(tmp_path) as db:
        assert dict(db.execute('SELECT * FROM sessions').fetchone())==dict(token_hash='existing',label='personal',expires=123,purpose='personal')
    assert len(list((tmp_path/'auth').glob('viewer-before-review-*.sqlite3')))==1


def test_review_code_reuse_expiry_rotation_and_revocation(client,tmp_path,monkeypatch):
    folder=tmp_path/'viewer';(folder/'snapshots').mkdir(parents=True)
    viewer_server.initialize_auth(folder)
    monkeypatch.setenv('BUTTERFLY_VIEWER_ROOT',str(folder))
    (folder/'snapshots/current.json').write_text('{}')
    server=viewer_server.ViewerServer(('127.0.0.1',0),folder)
    worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
    try:
        assert client.post('/api/viewer/review-code').status_code==403
        personal=client.post('/api/viewer/connection',headers=HEADERS).json()['code']
        personal_cookie=viewer_request(server,'/viewer/login',{'code':personal})[2].split(';')[0]
        code=client.post('/api/viewer/review-code',headers=HEADERS).json()['code']
        assert client.get('/api/viewer/status').json()['review_enabled']
        assert viewer_request(server,'/viewer/login',{'code':'invalid'})[0]==401
        before=time.time()
        first=viewer_request(server,'/viewer/login',{'code':code.lower()})
        second=viewer_request(server,'/viewer/login',{'code':code})
        assert first[0]==second[0]==200
        assert 'Max-Age=2592000' in first[2]
        cookies=[result[2].split(';')[0] for result in (first,second)]
        with viewer_server.connect(folder) as db:
            rows=db.execute("SELECT * FROM sessions WHERE purpose='review'").fetchall()
            assert len(rows)==2
            assert all(before+30*86400<=row['expires']<=time.time()+30*86400 for row in rows)
            assert db.execute('SELECT code_hash FROM review_code').fetchone()[0]==viewer_server.digest(code)
        assert viewer_request(server,'/viewer/data',cookie=cookies[0])[0]==200
        assert viewer_request(server,'/viewer/data',{},cookie=cookies[0],method='PUT')[0]==405
        expires=rows[0]['expires']
        with monkeypatch.context() as clock:
            clock.setattr(viewer_server.time,'time',lambda:expires)
            token_cookie=next(c for c in cookies if viewer_server.digest(c.split('=',1)[1])==rows[0]['token_hash'])
            assert viewer_request(server,'/viewer/data',cookie=token_cookie)[0]==401
        new_code=client.post('/api/viewer/review-code',headers=HEADERS).json()['code']
        assert viewer_request(server,'/viewer/login',{'code':code})[0]==401
        assert all(viewer_request(server,'/viewer/data',cookie=c)[0]==401 for c in cookies)
        assert viewer_request(server,'/viewer/data',cookie=personal_cookie)[0]==200
        renewed=viewer_request(server,'/viewer/login',{'code':new_code})
        assert renewed[0]==200
        assert client.post('/api/viewer/review-disable').status_code==403
        client.post('/api/viewer/review-disable',headers=HEADERS)
        assert viewer_request(server,'/viewer/data',cookie=renewed[2].split(';')[0])[0]==401
        assert viewer_request(server,'/viewer/login',{'code':new_code})[0]==401
        assert viewer_request(server,'/viewer/data',cookie=personal_cookie)[0]==200
        assert not client.get('/api/viewer/status').json()['review_enabled']
        client.post('/api/viewer/review-code',headers=HEADERS)
        client.post('/api/viewer/disable',headers=HEADERS)
        assert not client.get('/api/viewer/status').json()['review_enabled']
    finally:server.shutdown();server.server_close();worker.join(timeout=3)


def viewer_request(server,path,body=None,cookie='',method=None):
    connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
    headers={'Host':'archive.mirnaru.kro.kr','X-Forwarded-Proto':'https','Origin':viewer_server.ORIGIN,'X-Butterfly-Viewer':'1','Content-Type':'application/json'}
    if cookie:headers['Cookie']=cookie
    encoded=json.dumps(body).encode() if body is not None else None
    connection.request(method or ('POST' if body is not None else 'GET'),path,body=encoded,headers=headers)
    response=connection.getresponse();result=(response.status,response.read(),response.getheader('Set-Cookie'));connection.close();return result


def test_snapshot_only_changes_when_pc_publishes(client,tmp_path,monkeypatch):
    folder=tmp_path/'viewer';(folder/'snapshots').mkdir(parents=True)
    viewer_server.initialize_auth(folder)
    monkeypatch.setenv('BUTTERFLY_VIEWER_ROOT',str(folder))
    species=client.post('/api/species',json={'korean_name':'시험나비'}).json()['id']
    survey={'survey_date':'2026-05-10','place_name':'시험 장소','observations':[{'species_id':species,'stage':'adult'}]}
    assert client.post('/api/surveys',json=survey).status_code==201
    assert client.post('/api/viewer/snapshot').status_code==403
    assert client.post('/api/viewer/snapshot',headers=HEADERS).status_code==200
    target=folder/'snapshots/current.json';before=target.read_bytes();value=json.loads(before)
    assert len(value['records'])==1 and len(value['catalog'])==1
    assert 'mobile_photos' not in value and 'photos' not in value and 'sessions' not in value
    assert value['records'][0]['species_name']=='시험나비'
    client.post('/api/surveys',json={**survey,'survey_date':'2026-05-11'})
    assert target.read_bytes()==before
    client.post('/api/viewer/snapshot',headers=HEADERS)
    assert len(json.loads(target.read_bytes())['records'])==2


def test_viewer_reads_only_snapshot_and_has_no_write_routes(client,tmp_path,monkeypatch):
    folder=tmp_path/'viewer';(folder/'snapshots').mkdir(parents=True);(folder/'web').mkdir()
    (folder/'web/index.html').write_text('viewer')
    viewer_server.initialize_auth(folder);monkeypatch.setenv('BUTTERFLY_VIEWER_ROOT',str(folder))
    (folder/'snapshots/current.json').write_text(json.dumps({'records':[{'name':'test'}],'catalog':[],'holdings':[]}))
    server=viewer_server.ViewerServer(('127.0.0.1',0),folder)
    worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
    try:
        assert viewer_request(server,'/viewer/data')[0]==401
        assert viewer_request(server,'/api/surveys')[0]==404
        assert viewer_request(server,'/m/api/photos',{})[0]==405
        assert viewer_request(server,'/viewer/data',{},method='PUT')[0]==405
        assert viewer_request(server,'/viewer/../../butterfly.sqlite3')[0]==404
        code=client.post('/api/viewer/connection',headers=HEADERS).json()['code']
        login=viewer_request(server,'/viewer/login',{'code':code})
        assert login[0]==200
        assert 'HttpOnly' in login[2] and 'Secure' in login[2]
        cookie=login[2].split(';')[0]
        assert viewer_request(server,'/viewer/data',cookie=cookie)[0]==200
        assert viewer_request(server,'/viewer/login',{'code':code})[0]==401
        client.post('/api/viewer/disable',headers=HEADERS)
        assert viewer_request(server,'/viewer/data',cookie=cookie)[0]==401
    finally:server.shutdown();server.server_close();worker.join(timeout=3)


def test_pc_api_needs_launcher_session_but_extension_keeps_its_key(client):
    key=secrets.token_urlsafe(48)
    target=database_path().parent/'pc-access.key';target.write_text(key)
    assert client.get('/api/surveys').status_code==401
    assert client.post('/api/species',json={'korean_name':'시험나비'}).status_code==401
    assert client.get('/api/health').status_code==200
    assert client.post('/api/collection/naturing',json={}).status_code==422
    assert client.post('/api/local/session',headers={'X-Butterfly-Local':'wrong'}).status_code==401
    assert client.post('/api/local/session',headers={'X-Butterfly-Local':key,'Origin':'https://archive.mirnaru.kro.kr'}).status_code==401
    assert client.post('/api/local/session',headers={'X-Butterfly-Local':key,'Origin':'http://127.0.0.1:5173'}).status_code==200
    assert client.get('/api/surveys').status_code==200
