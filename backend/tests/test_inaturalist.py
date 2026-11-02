"""iNaturalist 수집의 재개·증분·중복·원문 및 위치 보호를 외부 호출 없이 검증합니다."""
import json
import sqlite3
import urllib.error
import pytest
from app import inaturalist
from app.database import connect_database, database_path
from app.integration_settings import IntegrationError
from test_integrations import client

HEADERS = {'X-Butterfly-Client': 'app'}
TAXON = {'id': 123, 'name': 'Papilio xuthus', 'rank': 'species', 'ancestor_ids': [47224]}


def observation(key, **changes):
    return dict(id=key, taxon=TAXON, observed_on='2020-05-10', observed_on_string='2020/05/10 14:00',
                time_observed_at='2020-05-10T05:00:00Z', observed_time_zone='Asia/Seoul',
                geojson={'coordinates': [127, 37]}, geoprivacy=None, taxon_geoprivacy=None,
                obscured=False, place_guess='공개 시험 장소', positional_accuracy=50,
                license_code='cc-by', annotations=[], **changes)


def provider(monkeypatch, pages):
    calls = []
    def fetch(path, params):
        calls.append((path, dict(params)))
        return {'results': [TAXON] if path.startswith('taxa/') else pages.pop(0)}
    monkeypatch.setattr(inaturalist, 'fetch', fetch)
    monkeypatch.setattr(inaturalist, 'PAGE_SIZE', 2)
    monkeypatch.setattr(inaturalist, 'INITIAL_LATEST_SIZE', 2)
    return calls


def sync(client, mode='history', **changes):
    return client.post('/api/collection/inaturalist/sync', json={'mode': mode, 'taxon_id': 123 if mode == 'history' else None, **changes}, headers=HEADERS)


def test_history_cursor_restart_dedup_and_registration(client, monkeypatch):
    calls = provider(monkeypatch, [[observation(9), observation(8)], [observation(7)]])
    sid = client.post('/api/species', json={'korean_name': '호랑나비', 'scientific_name': TAXON['name']}).json()['id']
    first = sync(client).json()
    assert first['created'] == 2 and not first['done'] and first['cursor'] == 8
    second = sync(client).json()
    assert second['created'] == 1 and second['done']
    assert calls[-1][1]['id_below'] == 8
    assert sync(client).json()['created'] == 0
    assert len(calls) == 3
    assert client.get('/api/collection').json()['total'] == 0
    listing = client.get('/api/collection?source=inaturalist').json()
    assert listing['total'] == 3 and listing['items'][0]['korean_name'] == '호랑나비'
    key = listing['items'][0]['id']
    assert client.post('/api/collection/register', json={'ids': [key]}, headers=HEADERS).status_code == 200
    record = client.get('/api/surveys').json()[0]['observations'][0]
    assert record['species_id'] == sid and record['source_type'] == 'indirect'
    assert record['observation_date'] == '2020-05-10' and record['observation_time'] is None
    assert '2020-05-10T05:00:00Z' in record['notes'] and record['source_weather'] is None
    assert client.get('/api/collection?source=inaturalist').json()['total'] == 2
    backups = list(database_path().parent.glob('*.before-inaturalist-*.bak'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute('SELECT count(*) FROM collected_observations').fetchone()[0] == 0


def test_latest_baseline_and_multi_page_new_posts(client, monkeypatch):
    calls = provider(monkeypatch, [[observation(10), observation(9)], [observation(14), observation(13)], [observation(12), observation(11)], []])
    assert sync(client, 'latest').json()['done']
    assert not sync(client, 'latest').json()['done']
    assert sync(client, 'latest').json()['cursor'] == 11
    assert sync(client, 'latest').json()['done']
    assert calls[1][1]['id_above'] == 10 and calls[2][1]['id_below'] == 13
    assert calls[3][1]['id_above'] == 10
    assert client.get('/api/collection?source=inaturalist').json()['total'] == 6
    state = next(iter(json.loads(inaturalist.state_path().read_text(encoding='utf-8')).values()))
    assert state['completed_high'] == 14 and state['cursor'] is None
    ids = [int(r['source_id']) for r in client.get('/api/collection?source=inaturalist').json()['items']]
    assert ids == sorted(ids, reverse=True)


def test_explicit_local_timestamp_preserved_without_timezone_guess():
    row = observation(1)
    row.update(time_observed_at='2020-05-10T14:00:00+09:00', time_zone_offset='+09:00')
    assert inaturalist.normalized(row)['observed_time'] == '14:00:00'
    row['time_zone_offset'] = '+08:00'
    assert inaturalist.normalized(row)['observed_time'] is None


def test_modes_overlap_and_discard_never_reappear(client, monkeypatch):
    provider(monkeypatch, [[observation(9)], [observation(9)]])
    assert sync(client).json()['created'] == 1
    key = client.get('/api/collection?source=inaturalist').json()['items'][0]['id']
    client.post('/api/collection/discard', json={'ids': [key]}, headers=HEADERS)
    assert sync(client, 'latest').json()['unchanged'] == 1
    assert client.get('/api/collection?source=inaturalist').json()['total'] == 0


def test_first_latest_catches_all_posts_since_history_started(client, monkeypatch):
    calls = provider(monkeypatch, [[observation(5)], [observation(10), observation(9)], [observation(8)]])
    assert sync(client).json()['done']
    assert not sync(client, 'latest').json()['done']
    assert 'created_d1' in calls[-1][1]
    assert sync(client, 'latest').json()['done']
    assert calls[-1][1]['id_below'] == 9 and 'created_d1' in calls[-1][1]
    assert client.get('/api/collection?source=inaturalist').json()['total'] == 4


@pytest.mark.parametrize('changes', [dict(obscured=True), dict(geoprivacy='private'), dict(taxon_geoprivacy='obscured'), dict(geojson=None), dict(geojson={'coordinates': [None, 37]}), dict(geojson={'coordinates': [127, 91]}), dict(taxon={'id': 4, 'ancestor_ids': []})])
def test_excludes_private_invalid_and_non_butterflies(client, monkeypatch, changes):
    item = observation(1)
    item.update(changes)
    provider(monkeypatch, [[item]])
    result = sync(client, 'latest').json()
    assert result['excluded'] == 1 and result['created'] == 0


def test_error_retains_cursor_and_saved_data(client, monkeypatch):
    provider(monkeypatch, [[observation(9), observation(8)]])
    sync(client)
    state = inaturalist.state_path().read_bytes()
    def fail(*args):
        raise IntegrationError('시험 통신 실패', 503)
    monkeypatch.setattr(inaturalist, 'fetch', fail)
    assert sync(client).status_code == 503
    assert inaturalist.state_path().read_bytes() == state
    assert client.get('/api/collection?source=inaturalist').json()['total'] == 2


def test_state_write_failure_replays_without_duplicates(client, monkeypatch):
    provider(monkeypatch, [[observation(9)], [observation(9)]])
    original = inaturalist.write_states
    def fail(*args):
        raise OSError('시험 저장 실패')
    monkeypatch.setattr(inaturalist, 'write_states', fail)
    assert sync(client, 'latest').status_code == 503
    monkeypatch.setattr(inaturalist, 'write_states', original)
    assert sync(client, 'latest').json()['unchanged'] == 1
    assert client.get('/api/collection?source=inaturalist').json()['total'] == 1


def test_validation_corrupt_state_and_non_butterfly_taxon(client, monkeypatch):
    assert client.post('/api/collection/inaturalist/sync', json={'mode': 'latest'}).status_code == 403
    assert sync(client, 'history', taxon_id=None).status_code == 422
    assert sync(client, 'latest', start='2026-05-02', end='2026-05-01').status_code == 422
    monkeypatch.setattr(inaturalist, 'fetch', lambda *args: {'results': [{'id': 123, 'rank': 'species', 'ancestor_ids': []}]})
    assert sync(client).status_code == 422
    inaturalist.state_path().write_text('broken', encoding='utf-8')
    assert sync(client).status_code == 503


def test_search_limits_taxa_and_rejects_foreign_origins(client, monkeypatch):
    calls = []
    def fetch(path, params):
        calls.append((path, params))
        return {'results': [TAXON, {'id': 4, 'name': 'non butterfly', 'ancestor_ids': []}]}
    monkeypatch.setattr(inaturalist, 'fetch', fetch)
    result = client.post('/api/collection/inaturalist/search', json={'query': 'Papilio', 'kind': 'taxa'}, headers=HEADERS)
    assert [r['id'] for r in result.json()] == [123]
    assert calls[0][1]['taxon_id'] == 47224 and calls[0][1]['rank'] == 'species'
    assert client.post('/api/collection/inaturalist/search', json={'query': 'Papilio'}, headers={**HEADERS, 'Origin': 'https://example.com'}).status_code == 403
    assert client.post('/api/collection/inaturalist/search', json={'query': 'Papilio'}, headers={**HEADERS, 'Origin': 'http://127.0.0.1:5174'}).status_code == 200


def test_unknown_species_and_missing_date_are_review_only(client, monkeypatch):
    item = observation(1)
    item['observed_on'] = None
    provider(monkeypatch, [[item]])
    sync(client, 'latest')
    row = client.get('/api/collection?source=inaturalist').json()['items'][0]
    assert not row['eligible']
    response = client.post('/api/collection/register', json={'ids': [row['id']]}, headers=HEADERS).json()
    assert response['results'][0]['status'] == 'skipped'


def test_remote_429_and_daily_limit_stop_without_retry(client, monkeypatch):
    monkeypatch.setattr(inaturalist.time, 'sleep', lambda seconds: None)
    monkeypatch.setattr(inaturalist.urllib.request.OpenerDirector, 'open', lambda *args, **kwargs: (_ for _ in ()).throw(urllib.error.HTTPError('test', 429, 'limit', {}, None)))
    assert sync(client, 'latest').status_code == 429
    with connect_database() as db:
        day = inaturalist.now_kst().date().isoformat()
        assert db.execute("SELECT attempts FROM api_usage WHERE service='inaturalist'").fetchone()[0] == 1
        db.execute("UPDATE api_usage SET attempts=? WHERE service='inaturalist' AND day=?", (inaturalist.DAILY_LIMIT, day))
    assert sync(client, 'latest').status_code == 429
    assert not inaturalist.state_path().exists()


def test_small_batches_preserve_initial_latest_200_and_cursor(client, monkeypatch):
    calls=provider(monkeypatch, [[observation(i) for i in range(high,high-50,-1)] for high in (300,250,200,150)])
    monkeypatch.setattr(inaturalist,'PAGE_SIZE',50)
    monkeypatch.setattr(inaturalist,'INITIAL_LATEST_SIZE',200)
    for i in range(4):
        result=sync(client,'latest').json()
        assert result['done']==(i==3)
        assert result['scanned']==50*(i+1)
    assert result['completed_high']==300
    assert [params.get('id_below') for path,params in calls]==[None,251,201,151]
    assert client.get('/api/collection?source=inaturalist').json()['total']==200


def test_transient_transport_retry_counts_every_attempt(client, monkeypatch):
    monkeypatch.setattr(inaturalist.time,'sleep',lambda seconds:None)
    attempts=[]
    class Response:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def read(self,limit):return json.dumps({'results':[]}).encode()
    def open_request(*args,**kwargs):
        attempts.append(1)
        if len(attempts)==1:raise TimeoutError()
        return Response()
    monkeypatch.setattr(inaturalist.urllib.request.OpenerDirector,'open',open_request)
    assert sync(client,'latest').status_code==200
    assert len(attempts)==2
    with connect_database() as db:
        assert db.execute("SELECT attempts FROM api_usage WHERE service='inaturalist'").fetchone()[0]==2


def test_repeated_transport_failure_stops_without_advancing(client, monkeypatch):
    monkeypatch.setattr(inaturalist.time,'sleep',lambda seconds:None)
    def fail(*args,**kwargs):raise TimeoutError()
    monkeypatch.setattr(inaturalist.urllib.request.OpenerDirector,'open',fail)
    assert sync(client,'latest').status_code==503
    assert not inaturalist.state_path().exists()
    with connect_database() as db:
        assert db.execute("SELECT attempts FROM api_usage WHERE service='inaturalist'").fetchone()[0]==2
