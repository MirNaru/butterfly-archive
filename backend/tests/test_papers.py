"""논문 수집·사례 등록·관계 보존과 DB 이전 실패를 시험 DB에서 검증합니다."""
import json
import sqlite3
import pytest
from app import papers, migrations
from app.database import connect_database, database_path
from test_integrations import client
from test_trash import remove, restore
from test_updates import payload as update_payload

HEADERS = {'X-Butterfly-Client': 'app'}


def remote(title='Butterfly larval development in Korea', doi='10.1000/test'):
    return json.dumps({'message': {'items': [{'DOI': doi, 'title': [title], 'author': [{'given': 'Test', 'family': 'Author'}], 'container-title': ['Test Journal'], 'published': {'date-parts': [[2025, 6]]}, 'language': 'en', 'abstract': '<p>Butterfly larvae and host plant study.</p>'}]}}).encode()


def collect(client, monkeypatch, **query):
    monkeypatch.setattr(papers, 'fetch', lambda *args: remote())
    response = client.post('/api/papers/refresh', json={'provider': 'crossref', **query}, headers=HEADERS)
    assert response.status_code == 200, response.text
    return client.get('/api/papers').json()['items'][0]


def observation(sid):
    return {'evidence': '12쪽 표 2 사례 1', 'survey': {'survey_date': '2020-05-03', 'place_name': '시험 장소', 'observations': [{'species_id': sid, 'source_type': 'indirect', 'source_note': '입력 출처', 'stage': 'larva', 'identification': 'user_confirmed'}]}}


def test_collection_dedup_metadata_and_no_key(client, monkeypatch):
    monkeypatch.delenv('KCI_API_KEY', raising=False)
    paper = collect(client, monkeypatch)
    assert paper['published'] == '2025-06' and paper['abstract'] == 'Butterfly larvae and host plant study.'
    assert 'original' not in paper and paper['url'] == 'https://doi.org/10.1000/test'
    result = client.post('/api/papers/refresh', json={'provider': 'all'}, headers=HEADERS).json()
    assert result['created'] == 0 and result['duplicate'] == 1 and result['warnings']
    assert client.get('/api/papers').json()['total'] == 1
    assert not client.get('/api/papers/status').json()['kci_ready']


def test_registration_preserves_evidence_original_date_and_trash(client, monkeypatch):
    paper = collect(client, monkeypatch)
    sid = client.post('/api/species', json={'korean_name': '논문 시험 나비'}).json()['id']
    value = observation(sid)
    response = client.post(f"/api/papers/{paper['id']}/observations", json=value, headers=HEADERS)
    assert response.status_code == 200, response.text
    saved = response.json(); oid = saved['observations'][0]['id']
    assert saved['survey_date'] == '2020-05-03'
    assert saved['observations'][0]['source_type'] == 'indirect'
    assert '12쪽 표 2' in saved['observations'][0]['source_note']
    assert paper['url'] in saved['observations'][0]['source_note']
    assert client.post(f"/api/papers/{paper['id']}/observations", json=value, headers=HEADERS).status_code == 409
    assert len(client.get('/api/papers').json()['items'][0]['observations']) == 1
    edited = update_payload(saved)
    edited['observations'][0]['source_type'] = 'direct'
    assert client.put(f"/api/surveys/{saved['id']}", json=edited).status_code == 422
    entry = remove(client, saved).json()
    assert client.get('/api/papers').json()['items'][0]['observations'] == []
    assert restore(client, entry).status_code == 200
    current = client.get(f"/api/surveys/{saved['id']}").json()
    assert current['observations'][0]['id'] == oid
    entry = remove(client, current).json()
    assert client.request('DELETE', f"/api/trash/{entry['id']}", json={'expected_deleted_at': entry['deleted_at']}).status_code == 200
    with connect_database() as db:
        assert db.execute('SELECT count(*) FROM papers').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM paper_observations').fetchone()[0] == 0
        assert not db.execute('PRAGMA foreign_key_check').fetchall()


def test_case_validation_and_link_failure_is_atomic(client, monkeypatch):
    paper = collect(client, monkeypatch)
    sid = client.post('/api/species', json={'korean_name': '논문 시험 종'}).json()['id']
    value = observation(sid)
    endpoint = f"/api/papers/{paper['id']}/observations"
    assert client.post(endpoint, json=value).status_code == 403
    assert client.post(endpoint, json={**value, 'evidence': ''}, headers=HEADERS).status_code == 422
    direct = observation(sid); direct['survey']['observations'][0]['source_type'] = 'direct'
    assert client.post(endpoint, json=direct, headers=HEADERS).status_code == 422
    with connect_database() as db:
        db.execute("CREATE TRIGGER fail_paper BEFORE INSERT ON paper_observations BEGIN SELECT RAISE(ABORT,'test'); END")
    assert client.post(endpoint, json=value, headers=HEADERS).status_code == 503
    assert client.get('/api/surveys').json() == []


def test_topic_language_and_failure_preserve_rows(client, monkeypatch):
    collect(client, monkeypatch)
    assert client.get('/api/papers?topic=rearing').json()['total'] == 1
    assert client.get('/api/papers?topic=new_record').json()['total'] == 0
    assert client.get('/api/papers?language=ko').json()['total'] == 0
    assert client.get('/api/papers?start=2025-06-15').json()['total'] == 1
    assert client.get('/api/papers?start=2025-07-01').json()['total'] == 0
    assert client.get('/api/papers?end=2025-05-31').json()['total'] == 0
    def fail(*args):
        raise papers.IntegrationError('test')
    monkeypatch.setattr(papers, 'fetch', fail)
    assert client.post('/api/papers/refresh', json={}, headers=HEADERS).json()['warnings']
    assert client.get('/api/papers').json()['total'] == 1
    assert client.post('/api/papers/refresh', json={'start': '2026-05-02', 'end': '2026-05-01'}, headers=HEADERS).status_code == 422
    assert not papers.relevant({'title': 'Butterfly optimization algorithm', 'abstract': ''}, 'latest', None)
    assert not papers.relevant({'title': 'Explosion response of butterfly-shaped auxetic sandwich panels', 'abstract': 'Structural engineering'}, 'latest', None)
    assert not papers.relevant({'title': 'A butterfly-coil-based EMAT for shear wave excitation', 'abstract': ''}, 'latest', None)
    assert papers.relevant({'title': 'First record of a butterfly in Korea', 'abstract': ''}, 'new_record', None)


def test_kci_xml_and_cross_provider_doi_merge(client, monkeypatch):
    first = collect(client, monkeypatch)
    raw = b'''<MetaData><result><total>1</total></result><outputData><record><journalInfo><journal-name>Korean Journal</journal-name><pub-year>2025</pub-year></journalInfo><articleInfo article-id="ART001"><title-group><article-title lang="original">Butterfly study</article-title></title-group><doi>10.1000/test</doi><abstract-group><abstract>Butterfly host plant</abstract></abstract-group></articleInfo></record></outputData></MetaData>'''
    monkeypatch.setenv('KCI_API_KEY', 'fake-test-key')
    monkeypatch.setattr(papers, 'fetch', lambda *args: raw)
    result = client.post('/api/papers/refresh', json={'provider': 'kci'}, headers=HEADERS).json()
    assert result['duplicate'] == 1 and result['created'] == 0
    assert client.get('/api/papers').json()['items'][0]['id'] == first['id']
    with connect_database() as db:
        assert len(json.loads(db.execute('SELECT payload_json FROM papers').fetchone()[0])['sources']) == 2
    with pytest.raises(ValueError): papers.kci_rows(b'<!DOCTYPE x><x/>')
    with pytest.raises(papers.IntegrationError): papers.kci_rows(b'<MetaData><error>bad key</error></MetaData>')


def test_version_eleven_migration_backup_and_rollback(client, monkeypatch):
    client.post('/api/species', json={'korean_name': '기존 자료'})
    with connect_database() as db:
        db.execute('DROP TABLE paper_files')
        db.execute('DROP TABLE paper_observations'); db.execute('DROP TABLE papers')
        db.execute('PRAGMA user_version=11')
    with monkeypatch.context() as patch:
        patch.setattr(migrations, 'PAPER_STATEMENTS', migrations.PAPER_STATEMENTS + ('INVALID SQL',))
        with pytest.raises(sqlite3.Error): migrations.initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 11
        assert db.execute('SELECT count(*) FROM species').fetchone()[0] == 1
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='papers'").fetchone()
    migrations.initialize_database(); migrations.initialize_database()
    assert list(database_path().parent.glob(f'*.before-v{migrations.SCHEMA_VERSION}-*.bak'))
