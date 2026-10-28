"""사진 원본 보존, 정보만 보관, 촬영 정보 후보와 실패 시 원자성을 검증합니다."""
from io import BytesIO
import json
from pathlib import Path
import sqlite3
from unittest.mock import patch
import pytest
from PIL import Image
from app import migrations, photos
from app.database import connect_database
from test_integrations import client


def picture(**changes):
    exif = Image.Exif()
    exif[272] = 'Test camera'
    exif[274] = changes.pop('orientation', 6)
    exif[34665] = {36867: changes.pop('taken', '2026:06:15 23:20:59'), 36881: changes.pop('offset', '+00:00')}
    exif[34853] = changes.pop('gps', {1: 'N', 2: (37.0, 30.0, 0.0), 3: 'E', 4: (127.0, 0.0, 0.0)})
    output = BytesIO()
    with Image.new('RGB', (80, 40), '#b0b0a0') as image:
        image.save(output, format='JPEG', exif=exif)
    return output.getvalue()


def inspect(client, data=None):
    response = client.post('/api/photos/inspect?filename=test.jpg', content=picture() if data is None else data)
    assert response.status_code == 200, response.text
    return response.json()


def register(client):
    return client.post('/api/photos/metadata', json={'ticket': inspect(client)['ticket']}).json()


def test_inspection_preserves_raw_time_and_makes_korean_candidate_without_storage(client, tmp_path, monkeypatch):
    root = tmp_path / 'pictures'
    monkeypatch.setenv('BUTTERFLY_PHOTO_DIR', str(root))
    result = inspect(client)['metadata']
    assert result['taken_at_raw'] == '2026:06:15 23:20:59'
    assert result['date_candidate'] == '2026-06-16'
    assert result['time_candidate'] == '08:20:59'
    assert result['latitude'] == 37.5 and result['longitude'] == 127
    assert result['orientation'] == 6
    assert not root.exists()
    with connect_database() as db:
        assert db.execute('SELECT COUNT(*) FROM photos').fetchone()[0] == 0


def test_metadata_only_duplicate_upgrade_and_original_bytes(client, tmp_path, monkeypatch):
    root = tmp_path / 'pictures'
    monkeypatch.setenv('BUTTERFLY_PHOTO_DIR', str(root))
    photo = register(client)
    assert photo['original_stored'] is False and photo['thumbnail_url'] is None
    assert not root.exists()
    assert register(client)['id'] == photo['id']
    assert client.get(f"/api/photos/{photo['id']}/original").status_code == 404
    data = picture()
    upgraded = client.post('/api/photos/original?filename=same-renamed.jpg', content=data)
    assert upgraded.status_code == 200, upgraded.text
    upgraded = upgraded.json()
    assert upgraded['id'] == photo['id'] and upgraded['original_stored'] is True
    assert upgraded['filename'] == 'test.jpg'
    assert client.get(f"/api/photos/{photo['id']}/original").content == data
    assert 'attachment' in client.get(f"/api/photos/{photo['id']}/original").headers['content-disposition']
    thumb = client.get(upgraded['thumbnail_url'])
    assert thumb.headers['cache-control'] == 'private, no-store'
    with Image.open(BytesIO(thumb.content)) as image:
        assert image.height > image.width
        assert not image.getexif()
    with connect_database() as db:
        assert db.execute('SELECT COUNT(*) FROM photos').fetchone()[0] == 1
    assert len(list(root.rglob('*.jpg'))) == 2


def test_photo_links_save_reload_omission_and_explicit_detach_preserve_asset(client):
    photo = register(client)
    body = {'survey_date': '2026-06-16', 'place_name': '가상 장소', 'photo_ids': [photo['id'], photo['id']],
            'observations': [{'photo_ids': [photo['id']]}]}
    saved = client.post('/api/surveys', json=body).json()
    assert saved['photo_ids'] == [photo['id']]
    assert saved['observations'][0]['photo_ids'] == [photo['id']]
    assert saved['observations'][0]['observation_time'] is None
    assert saved['latitude'] is None
    update = {'survey_date': saved['survey_date'], 'place_name': '가상 수정', 'expected_updated_at': saved['updated_at'],
              'observations': [{'id': saved['observations'][0]['id']}]}
    response = client.put(f"/api/surveys/{saved['id']}", json=update)
    assert response.status_code == 200, response.text
    changed = response.json()
    assert changed['photo_ids'] == saved['photo_ids']
    assert changed['observations'][0]['photo_ids'] == saved['observations'][0]['photo_ids']
    update.update(expected_updated_at=changed['updated_at'], photo_ids=[], observations=[{'id': changed['observations'][0]['id'], 'photo_ids': []}])
    detached = client.put(f"/api/surveys/{saved['id']}", json=update)
    assert detached.status_code == 200
    assert detached.json()['photo_ids'] == []
    assert client.get(f"/api/surveys/{saved['id']}").json()['observations'][0]['photo_ids'] == []
    assert len(client.post('/api/photos/lookup', json={'ids': [photo['id']]}).json()) == 1
    library = client.get('/api/photos/library?offset=0&limit=12').json()
    assert library['total'] == 1 and library['items'][0]['id'] == photo['id']
    assert client.get('/api/photos/library?offset=12&limit=12').json()['items'] == []
    assert client.get('/api/photos/library?limit=25').status_code == 422


def test_invalid_photo_reference_rolls_back_entire_survey(client):
    photo = register(client)
    response = client.post('/api/surveys', json={'survey_date': '2026-06-16', 'place_name': '가상', 'photo_ids': [photo['id']], 'observations': [{'photo_ids': [9999]}]})
    assert response.status_code == 422
    assert client.get('/api/surveys').json() == []
    with connect_database() as db:
        assert db.execute('SELECT COUNT(*) FROM photo_links').fetchone()[0] == 0


@pytest.mark.parametrize('path,data,status', [
    ('inspect?filename=../secret.jpg', b'x', 422), ('inspect?filename=test.jpg', b'not an image', 422),
    ('inspect?filename=test.jpg', b'', 413),
])
def test_rejected_files_do_not_store(client, path, data, status):
    assert client.post('/api/photos/' + path, content=data).status_code == status
    with connect_database() as db:
        assert db.execute('SELECT COUNT(*) FROM photos').fetchone()[0] == 0


def test_size_pixel_format_and_lookup_limits(client, monkeypatch):
    monkeypatch.setattr(photos, 'MAX_BYTES', 100)
    assert client.post('/api/photos/inspect?filename=test.jpg', content=b'x' * 101).status_code == 413
    monkeypatch.setattr(photos, 'MAX_BYTES', 1024 * 1024)
    monkeypatch.setattr(photos, 'MAX_PIXELS', 100)
    assert client.post('/api/photos/inspect?filename=test.jpg', content=picture()).status_code == 413
    output = BytesIO()
    Image.new('RGB', (1, 1)).save(output, format='GIF')
    assert client.post('/api/photos/inspect?filename=test.gif', content=output.getvalue()).status_code == 415
    assert client.post('/api/photos/lookup', json={'ids': list(range(25))}).status_code == 422


def test_tampered_and_expired_preview_do_not_register(client, monkeypatch):
    ticket = inspect(client)['ticket']
    assert client.post('/api/photos/metadata', json={'ticket': ticket + 'x'}).status_code == 422
    monkeypatch.setattr(photos.time, 'time', lambda: 10**12)
    assert client.post('/api/photos/metadata', json={'ticket': ticket}).status_code == 422


def test_missing_or_invalid_exif_does_not_guess_time_or_gps(client):
    result = inspect(client, picture(taken='broken', gps={1: 'N', 2: (90.0, 1.0, 0.0)}))['metadata']
    assert result['date_candidate'] is None and result['latitude'] is None
    assert len(result['warnings']) == 2
    output = BytesIO()
    Image.new('RGB', (10, 10)).save(output, format='PNG')
    result = inspect(client, output.getvalue())['metadata']
    assert result['date_candidate'] is None and result['latitude'] is None
    assert result['format'] == 'PNG'
    result = inspect(client, picture(offset=''))['metadata']
    assert result['time_candidate'] == '23:20:59' and result['warnings']
    result = inspect(client, picture(taken='9999:12:31 23:59:59'))['metadata']
    assert result['date_candidate'] is None and result['warnings']


def test_storage_failure_cleans_only_new_copies_and_preserves_metadata(client, tmp_path, monkeypatch):
    root = tmp_path / 'pictures'
    monkeypatch.setenv('BUTTERFLY_PHOTO_DIR', str(root))
    photo = register(client)
    original_open = Path.open
    def failing_open(path, *args, **kwargs):
        if 'thumbnails' in path.parts and args and args[0] == 'xb':
            raise OSError('simulated disk full')
        return original_open(path, *args, **kwargs)
    with patch.object(Path, 'open', failing_open):
        response = client.post('/api/photos/original?filename=test.jpg', content=picture())
    assert response.status_code == 503
    assert not list(root.rglob('*.jpg'))
    assert client.post('/api/photos/lookup', json={'ids': [photo['id']]}).json()[0]['original_stored'] is False


def test_v5_upgrade_backup_rollback_and_existing_rows(tmp_path, monkeypatch):
    path = tmp_path / 'v5.sqlite3'
    monkeypatch.setenv('BUTTERFLY_DB_PATH', str(path))
    with sqlite3.connect(path) as db:
        for sql in migrations.STATEMENTS + migrations.INTEGRATION_STATEMENTS + migrations.REFERENCE_STATEMENTS + migrations.SOURCE_STATEMENTS + migrations.TAG_STATEMENTS:
            db.execute(sql)
        db.execute("INSERT INTO species VALUES(1,'가상 기존 종',NULL,'before')")
        db.execute('PRAGMA user_version=5')
    with monkeypatch.context() as context:
        context.setattr(migrations, 'PHOTO_STATEMENTS', migrations.PHOTO_STATEMENTS + ('INVALID SQL',))
        with pytest.raises(sqlite3.Error): migrations.initialize_database()
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 5
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='photos'").fetchone()
    migrations.initialize_database()
    migrations.initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 6
        assert db.execute('SELECT korean_name FROM species').fetchone()[0] == '가상 기존 종'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    backups = list(tmp_path.glob('*.before-v6-*.bak'))
    assert backups
    for backup in backups:
        with sqlite3.connect(backup) as db:
            assert db.execute('PRAGMA user_version').fetchone()[0] == 5
