"""Android 전송 형식·제한·저장 실패 복구를 개인 DB가 아닌 시험 DB에서 확인합니다."""
import sqlite3
import time
from test_integrations import client
from test_mobile import remote, authenticate, photo, HEADERS
from app.database import connect_database


def test_android_metadata_contract_and_invalid_payloads(client, remote):
    authenticate(client, remote)
    assert client.get('/api/mobile/photos').json()['items'] == []
    value = {**photo(), 'width': 4000, 'height': 2252, 'orientation': 1, 'camera': 'SM-S918N', 'gps_datum': '', 'warnings': []}
    assert remote.post('/m/api/photos', json=value, headers=HEADERS).status_code == 200
    saved = client.get('/api/mobile/photos').json()['items'][0]['metadata']
    for key, original in value.items():
        assert saved[key] == original
    for invalid in ({**value, 'latitude': None}, {**value, 'latitude': 91}, {**value, 'uri': 'content://test'}, {**value, 'format': 'HEIC'}):
        assert remote.post('/m/api/photos', json=invalid, headers=HEADERS).status_code == 422
    assert client.get('/api/mobile/photos').json()['total'] == 1
    assert client.get('/api/surveys').json() == []


def test_upload_limit_and_expired_session_preserve_pending(client, remote):
    authenticate(client, remote)
    for index in range(120):
        assert remote.post('/m/api/photos', json=photo(f'{index:064x}'), headers=HEADERS).status_code == 200
    assert remote.post('/m/api/photos', json=photo('f'*64), headers=HEADERS).status_code == 429
    assert client.get('/api/mobile/photos').json()['total'] == 120
    with connect_database() as db:
        db.execute('UPDATE mobile_sessions SET expires=?', (time.time()-1,))
    assert remote.post('/m/api/photos', json=photo('f'*64), headers=HEADERS).status_code == 401
    assert client.get('/api/mobile/photos').json()['total'] == 120


def test_failed_save_rolls_back_and_retry_does_not_duplicate(client, remote, monkeypatch):
    from app import mobile
    authenticate(client, remote)
    def failed(_):
        raise sqlite3.OperationalError('synthetic save failure')
    with monkeypatch.context() as patch:
        patch.setattr(mobile, 'metadata_view', failed)
        assert remote.post('/m/api/photos', json=photo(), headers=HEADERS).status_code == 503
    assert client.get('/api/mobile/photos').json()['total'] == 0
    first = remote.post('/m/api/photos', json=photo(), headers=HEADERS).json()
    again = remote.post('/m/api/photos', json=photo(), headers=HEADERS).json()
    assert first['id'] == again['id'] and again['status'] == 'duplicate'
    assert client.get('/api/mobile/photos').json()['total'] == 1
