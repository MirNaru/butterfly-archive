"""PDF 업로드·중복·원본 보존·잘못된 파일과 추가 이전을 검증합니다."""
import hashlib
import io
import sqlite3
import pytest
from pypdf import PdfWriter
from app import migrations, paper_pdf
from app.database import connect_database, database_path
from test_integrations import client

HEADERS = {'X-Butterfly-Client': 'app', 'Content-Type': 'application/pdf'}


def pdf(encrypted=False):
    writer = PdfWriter(); writer.add_blank_page(width=200, height=200)
    if encrypted:
        writer.encrypt('test')
    output = io.BytesIO(); writer.write(output)
    return output.getvalue()


def test_upload_dedup_local_file_and_no_automatic_observation(client):
    raw = pdf()
    endpoint = '/api/papers/pdf?filename=butterfly.pdf'
    assert client.post(endpoint, content=raw).status_code == 403
    first = client.post(endpoint, content=raw, headers=HEADERS)
    assert first.status_code == 200, first.text
    saved = first.json()
    assert not saved['duplicate'] and saved['warning']
    assert client.post(endpoint, content=raw, headers=HEADERS).json()['duplicate']
    papers = client.get('/api/papers?provider=pdf').json()
    assert papers['total'] == 1 and papers['items'][0]['files'][0]['id'] == saved['id']
    assert client.get('/api/papers?provider=crossref').json()['total'] == 0
    assert client.get(f"/api/papers/pdf/{saved['id']}").content == raw
    assert client.get(f"/api/papers/pdf/{saved['id']}/text").json()['pages'] == ['']
    assert client.get('/api/surveys').json() == []
    assert hashlib.sha256((database_path().parent / 'papers' / (hashlib.sha256(raw).hexdigest() + '.pdf')).read_bytes()).digest() == hashlib.sha256(raw).digest()
    assert client.get('/api/papers/pdf/999').status_code == 404


def test_pdf_validation_and_bounded_body(client, monkeypatch):
    endpoint = '/api/papers/pdf?filename=test.pdf'
    for raw in (b'not PDF', b'%PDF-broken', pdf(True)):
        assert client.post(endpoint, content=raw, headers=HEADERS).status_code == 422
    assert client.post('/api/papers/pdf?filename=test.exe', content=pdf(), headers=HEADERS).status_code == 422
    monkeypatch.setattr(paper_pdf, 'MAX_BYTES', 20)
    assert client.post(endpoint, content=pdf(), headers=HEADERS).status_code == 413
    assert client.get('/api/papers').json()['total'] == 0


def test_pdf_merges_existing_doi_without_replacing_metadata(client):
    from app.papers import save_paper
    with connect_database() as db:
        save_paper(db, dict(provider='crossref', source_id='10.1000/test', doi='10.1000/test', title='Existing butterfly title', authors='Author', journal='', published='2020', language='en', abstract='', url='https://doi.org/10.1000/test', original={}), '2026')
    result = paper_pdf.import_pdf(pdf(), 'butterfly.pdf', {'doi': '10.1000/test', 'title': 'PDF title'})
    papers = client.get('/api/papers').json()
    assert papers['total'] == 1 and papers['items'][0]['title'] == 'Existing butterfly title'
    assert papers['items'][0]['providers'] == ['crossref', 'pdf']
    assert result['paper_id'] == papers['items'][0]['id']


def test_version_twelve_migration_failure_preserves_rows(client, monkeypatch):
    client.post('/api/species', json={'korean_name': '보존 시험'})
    with connect_database() as db:
        db.execute('DROP TABLE paper_files'); db.execute('PRAGMA user_version=12')
    with monkeypatch.context() as patch:
        patch.setattr(migrations, 'PAPER_FILE_STATEMENTS', migrations.PAPER_FILE_STATEMENTS + ('INVALID SQL',))
        with pytest.raises(sqlite3.Error): migrations.initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 12
        assert db.execute('SELECT count(*) FROM species').fetchone()[0] == 1
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='paper_files'").fetchone()
    migrations.initialize_database(); migrations.initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 13
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    assert list(database_path().parent.glob('*.before-v13-*.bak'))
