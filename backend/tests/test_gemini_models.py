"""Gemini 모델 선택과 외부 오류 진단을 모의 응답으로 검증합니다."""
import json
from urllib.error import HTTPError
from app import research
from app.database import connect_database
from test_paper_pdf import pdf
from test_papers import HEADERS, client


def test_gemini_models_and_unavailable_search_log(client, monkeypatch, caplog):
    monkeypatch.setenv('GEMINI_API_KEY', 'private-test-key')
    monkeypatch.setenv('BUTTERFLY_GEMINI_FREE_PROJECT', '1')
    added = client.post('/api/papers/pdf?filename=butterfly.pdf', content=pdf(), headers=HEADERS).json()
    with connect_database() as db:
        db.execute('UPDATE paper_files SET pages_json=?', (json.dumps(['private-test-excerpt']),))
    urls = []

    class MockOpener:
        def open(self, request, timeout):
            urls.append(request.full_url)
            raise HTTPError(request.full_url, 404, 'test', {}, None)

    monkeypatch.setattr(research.urllib.request, 'build_opener', lambda *_: MockOpener())
    extract = client.post(f"/api/research/pdf/{added['id']}/extract", headers=HEADERS, json={'consent': True})
    search = client.post('/api/research/web/search', headers=HEADERS, json={'consent': True, 'query': 'butterfly'})
    assert extract.status_code == search.status_code == 503
    assert '무료 Gemini 웹 검색 모델' in search.json()['detail']
    assert urls[0].endswith('/gemini-3.5-flash-lite:generateContent')
    assert urls[1].endswith('/gemini-2.5-flash-lite:generateContent')
    assert 'model=gemini-3.5-flash-lite status=404' in caplog.text
    assert 'private-test-key' not in caplog.text
    assert 'private-test-excerpt' not in caplog.text
