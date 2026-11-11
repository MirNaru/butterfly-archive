"""별도 SQLite와 모의 Gemini 응답으로 연구 자료의 저장 경계를 검증합니다."""
import json
import sqlite3
from urllib.error import HTTPError

from app import migrations, research
from app.database import connect_database, database_path
from test_paper_pdf import pdf
from test_papers import HEADERS, client, collect, observation


def test_organize_and_filter_preserves_paper(client, monkeypatch):
    paper = collect(client, monkeypatch)
    route = f"/api/research/papers/{paper['id']}/organization"
    assert client.get('/api/papers?favorite=true').json()['total'] == 0
    assert client.put(route, json={'favorite': True, 'tags': []}).status_code == 403
    saved = client.put(route, headers=HEADERS, json={'favorite': True, 'tags': [' 사육 ', '복원', '복원']})
    assert saved.json() == {'favorite': True, 'tags': ['사육', '복원']}
    assert client.put(route, headers=HEADERS, json={'favorite': True, 'tags': [' ']}).status_code == 422
    collect(client, monkeypatch)
    reread = client.get('/api/papers?favorite=true&tag=복').json()['items'][0]
    assert reread['title'] == paper['title'] and reread['tags'] == ['사육', '복원']


def test_pdf_candidate_transmission_and_review(client, monkeypatch):
    added = client.post('/api/papers/pdf?filename=butterfly.pdf', content=pdf(), headers=HEADERS).json()
    root = f"/api/research/pdf/{added['id']}"
    assert client.post(root+'/extract', json={'consent': False}, headers=HEADERS).status_code == 422
    assert client.post(root+'/extract', json={'consent': True}, headers=HEADERS).status_code == 422
    with connect_database() as db:
        db.execute('UPDATE paper_files SET pages_json=?', (json.dumps(['첫 쪽', '둘째 쪽', '전송 제외']),))
    candidate = {'title': 'Butterfly research', 'authors': 'Sample Author', 'journal': '', 'published': '2023'}

    def mock(payload):
        assert payload['contents'][0]['parts'][0]['text'] == '첫 쪽\n\n둘째 쪽'
        return {'content': {'parts': [{'text': json.dumps(candidate)}]}}

    monkeypatch.setattr(research, 'gemini_request', mock)
    assert client.post(root+'/extract', json={'consent': True}, headers=HEADERS).json() == candidate
    assert client.get('/api/papers').json()['items'][0]['title'] == 'butterfly'
    assert client.put(root+'/bibliography', headers=HEADERS, json=candidate).json()['updated'] == ['title', 'authors', 'published']
    assert client.put(root+'/bibliography', headers=HEADERS, json={'title': 'Overwrite', 'journal': 'Example Journal'}).json()['updated'] == ['journal']
    assert client.get('/api/papers').json()['items'][0]['title'] == candidate['title']
    assert client.get('/api/surveys').json() == []
    monkeypatch.setattr(research, 'gemini_request', lambda _: {'content': {'parts': [{'text': 'invalid'}]}})
    assert client.post(root+'/extract', json={'consent': True}, headers=HEADERS).status_code == 502


def test_search_display_only_and_manual_web_registration(client, monkeypatch):
    sid = client.post('/api/species', json={'korean_name': '시험 나비'}).json()['id']
    redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/example'

    def mock(payload):
        assert payload['tools'] == [{'google_search': {}}]
        return {'content': {'parts': [{'text': 'Example result'}]}, 'groundingMetadata': {
            'searchEntryPoint': {'renderedContent': '<p>Search suggestions</p>'},
            'groundingChunks': [{'web': {'uri': redirect, 'title': 'Example'}}],
        }}

    monkeypatch.setattr(research, 'gemini_request', mock)
    result = client.post('/api/research/web/search', headers=HEADERS, json={'query': 'butterfly observation', 'consent': True})
    assert result.json()['links'][0]['url'] == redirect
    route = '/api/research/web/sources'
    assert client.get(route).json()['total'] == 0
    value = {'url': 'https://example.com/field-note#section', 'title': '원문 기록', 'species_id': sid}
    assert client.post(route, headers=HEADERS, json={**value, 'url': redirect}).status_code == 422
    saved = client.post(route, headers=HEADERS, json=value).json()
    assert not saved['duplicate']
    assert client.post(route, headers=HEADERS, json=value).json()['duplicate']
    assert client.get('/api/surveys').json() == []
    register = f"{route}/{saved['id']}/observations"
    data = observation(sid)
    saved_case = client.post(register, headers=HEADERS, json=data)
    assert saved_case.status_code == 200, saved_case.text
    assert 'https://example.com/field-note\n원문 기록' in saved_case.json()['observations'][0]['source_note']
    assert client.post(register, headers=HEADERS, json=data).status_code == 409
    assert client.get(route).json()['items'][0]['registered_count'] == 1


def test_gemini_limit_and_upstream_failure(client, monkeypatch):
    route = '/api/research/web/search'
    data = {'query': 'butterfly', 'consent': True}
    monkeypatch.delenv('BUTTERFLY_GEMINI_FREE_PROJECT', raising=False)
    assert client.post(route, headers=HEADERS, json=data).status_code == 503
    monkeypatch.setenv('BUTTERFLY_GEMINI_FREE_PROJECT', '1')
    monkeypatch.setenv('GEMINI_API_KEY', 'mock-key')
    monkeypatch.setattr(research, 'DAILY_LIMIT', 1)
    sent = []

    class MockOpener:
        def open(self, request, timeout):
            sent.append(request.full_url)
            assert 'mock-key' not in request.full_url
            raise HTTPError(request.full_url, 429, 'quota', {}, None)

    monkeypatch.setattr(research.urllib.request, 'build_opener', lambda *_: MockOpener())
    assert client.post(route, headers=HEADERS, json=data).status_code == 429
    assert client.post(route, headers=HEADERS, json=data).status_code == 429
    assert len(sent) == 1


def test_schema_15_upgrade_keeps_papers_and_backup(client, monkeypatch):
    paper = collect(client, monkeypatch)
    with connect_database() as db:
        for table in ('web_observations', 'web_sources', 'paper_organization', 'gemini_daily_usage'):
            db.execute(f'DROP TABLE {table}')
        db.execute('DROP TABLE map_lookup_cache'); db.execute('PRAGMA user_version=15')
    migrations.initialize_database()
    assert client.get('/api/papers').json()['items'][0]['id'] == paper['id']
    backup, = database_path().parent.glob(f'*.before-v{migrations.SCHEMA_VERSION}-*.bak')
    with sqlite3.connect(backup) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 15
        assert db.execute('SELECT COUNT(*) FROM papers').fetchone()[0] == 1

def test_auto_extract_replaces_existing_fields_and_preserves_original(client, monkeypatch):
    added = client.post('/api/papers/pdf?filename=butterfly.pdf', content=pdf(), headers=HEADERS).json()
    root = f"/api/research/pdf/{added['id']}/extract"
    with connect_database() as db:
        db.execute('UPDATE paper_files SET pages_json=?', (json.dumps(['첫 쪽']),))
        paper = json.loads(db.execute('SELECT payload_json FROM papers').fetchone()[0])
        paper.update(title='Existing title', authors='Existing author', published='2015-03-01')
        db.execute('UPDATE papers SET payload_json=?', (json.dumps(paper),))
    candidate = {'title': 'Butterfly research', 'authors': '', 'journal': 'Example Journal', 'published': '2015'}
    monkeypatch.setattr(research, 'gemini_request', lambda _: {'content': {'parts': [{'text': json.dumps(candidate)}]}})
    assert client.post(root, headers=HEADERS, json={'consent': True, 'save': True}).json() == {'updated': ['title', 'journal']}
    assert client.post(root, headers=HEADERS, json={'consent': True, 'save': True}).json() == {'updated': []}
    paper = client.get('/api/papers').json()['items'][0]
    assert (paper['title'], paper['authors'], paper['published']) == ('Butterfly research', 'Existing author', '2015-03-01')
    assert paper['reviewed_bibliography']['title']['original_value'] == 'Existing title'
    assert client.get('/api/surveys').json() == []


def test_record_rendering_does_not_block_map_permit_counter(client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from app import records, api_usage

    sid = client.post('/api/species', json={'korean_name': '잠금 시험 나비'}).json()['id']
    assert client.post('/api/surveys', json=observation(sid)['survey']).status_code == 201
    started, release = Event(), Event()
    original = records.observation_view

    def delayed(*args):
        started.set()
        assert release.wait(8)
        return original(*args)

    monkeypatch.setattr(records, 'observation_view', delayed)
    with ThreadPoolExecutor(max_workers=2) as pool:
        listing = pool.submit(records.list_surveys)
        try:
            assert started.wait(3)
            pool.submit(api_usage.reserve, 'map').result(timeout=3)
        finally:
            release.set()
        assert listing.result(timeout=3)[0]['observations']
