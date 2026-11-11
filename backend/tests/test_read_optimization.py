"""조회 요약의 원문 보존·동기화·복구와 경계 계산의 동등성을 검증합니다."""
import json
import random
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from app import migrations, records, regions
from app.database import connect_database, database_path
from test_integrations import client, record


def imported(client):
    lat, lng = 37.5666123456789, 126.9784123456789
    survey = record(client, latitude=lat, longitude=lng, observations=[{
        'stage': 'adult', 'source_type': 'indirect', 'source_note': '공개 시험 원문'}])
    oid = survey['observations'][0]['id']
    payload = json.dumps(dict(source='naturing', latitude=lat, longitude=lng,
        location_accuracy=1.2345678901234567, place_raw='공개 시험 장소',
        observed_raw='2025년 10월 22일', weather_raw='맑음', url='https://example.test/o/1',
        original={'keep': 'x' * 20000}), ensure_ascii=False)
    inference = json.dumps(dict(stage='adult', manual_stage_override=False,
        reference_snapshot={'keep': 'y' * 20000}), ensure_ascii=False)
    with connect_database() as db:
        item = db.execute("""INSERT INTO collected_observations
            (source,source_id,payload_json,first_received_at,last_received_at,collected_at)
            VALUES('naturing','1',?,'test','test','test')""", (payload,)).lastrowid
        db.execute('INSERT INTO collection_imports VALUES(?,?,?, ?,?)',
                   (item, oid, 'test', payload, inference))
    return survey, item, payload, inference


def test_compact_view_equals_original_and_preserves_numeric_precision(client):
    survey, item, payload, inference = imported(client)
    with connect_database() as db:
        original = db.execute("""SELECT o.*,NULL AS species_name,
            ci.payload_json AS imported_payload,ci.inference_json AS imported_inference
            FROM observations o JOIN collection_imports ci ON ci.observation_id=o.id
            WHERE ci.item_id=?""", (item,)).fetchone()
        expected = records.observation_view(original, survey, [], [])
        view = db.execute('SELECT * FROM collection_import_views WHERE item_id=?', (item,)).fetchone()
        assert len(view['payload_json']) + len(view['inference_json']) < 1000
        compact = json.loads(view['payload_json'])
        raw = json.loads(payload)
        assert all(compact[k] == raw[k] for k in ('latitude', 'longitude', 'location_accuracy'))
        assert db.execute('SELECT payload_json,inference_json FROM collection_imports WHERE item_id=?',
                          (item,)).fetchone()[:] == (payload, inference)
    actual = client.get('/api/surveys').json()[0]['observations'][0]
    assert actual == expected
    assert actual['source_weather']['stale'] is False
    assert actual['stage_inferred'] is True


def test_view_tracks_registered_snapshot_not_current_inbox_and_rolls_back(client):
    _, item, payload, inference = imported(client)
    with connect_database() as db:
        before = tuple(db.execute('SELECT * FROM collection_import_views WHERE item_id=?', (item,)).fetchone())
        db.execute('UPDATE collected_observations SET payload_json=? WHERE id=?', ('{}', item))
        assert tuple(db.execute('SELECT * FROM collection_import_views WHERE item_id=?', (item,)).fetchone()) == before
    with pytest.raises(RuntimeError):
        with connect_database() as db:
            changed = json.dumps({**json.loads(inference), 'manual_stage_override': True})
            db.execute('UPDATE collection_imports SET inference_json=? WHERE item_id=?', (changed, item))
            assert json.loads(db.execute('SELECT inference_json FROM collection_import_views').fetchone()[0])['manual_stage_override']
            raise RuntimeError('시험 취소')
    with connect_database() as db:
        assert tuple(db.execute('SELECT * FROM collection_import_views WHERE item_id=?', (item,)).fetchone()) == before
        assert db.execute('SELECT payload_json FROM collection_imports').fetchone()[0] == payload
        db.execute('UPDATE collection_imports SET inference_json=? WHERE item_id=?',
                   (json.dumps({'stage': 'adult', 'manual_stage_override': True}), item))
    assert client.get('/api/surveys').json()[0]['observations'][0]['stage_inferred'] is False
    with connect_database() as db:
        db.execute('DELETE FROM collection_imports WHERE item_id=?', (item,))
        assert not db.execute('SELECT * FROM collection_import_views').fetchall()
        assert not db.execute('PRAGMA foreign_key_check').fetchall()


def downgrade_to_sixteen():
    with connect_database() as db:
        db.execute('DROP TRIGGER collection_import_view_insert')
        db.execute('DROP TRIGGER collection_import_view_update')
        db.execute('DROP TABLE collection_import_views')
        db.execute('DROP TABLE map_lookup_cache')
        db.execute('PRAGMA user_version=16')


def test_migration_backfills_and_keeps_original_backup(client):
    _, item, payload, inference = imported(client)
    downgrade_to_sixteen()
    migrations.initialize_database()
    migrations.initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == migrations.SCHEMA_VERSION
        assert db.execute('SELECT payload_json,inference_json FROM collection_imports').fetchone()[:] == (payload, inference)
        assert db.execute('SELECT item_id FROM collection_import_views').fetchone()[0] == item
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    backup = next(database_path().parent.glob(f'*.before-v{migrations.SCHEMA_VERSION}-*.bak'))
    with sqlite3.connect(backup) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 16
        assert db.execute('SELECT payload_json,inference_json FROM collection_imports').fetchone() == (payload, inference)


def test_failed_projection_migration_keeps_version_and_original(client, monkeypatch):
    _, _, payload, inference = imported(client)
    downgrade_to_sixteen()
    monkeypatch.setattr(migrations, 'IMPORT_VIEW_STATEMENTS', (*migrations.IMPORT_VIEW_STATEMENTS, 'INVALID SQL'))
    with pytest.raises(sqlite3.Error):
        migrations.initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 16
        assert db.execute('SELECT payload_json,inference_json FROM collection_imports').fetchone()[:] == (payload, inference)
        assert not db.execute("SELECT name FROM sqlite_master WHERE name='collection_import_views'").fetchall()


def test_prepared_boundaries_equal_original_edges_holes_and_random_points():
    rng = random.Random(17)
    tested = 0
    for feature in regions.index().values():
        geometry = feature['geometry']
        polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
        for polygon in polygons:
            for ring in polygon:
                prepared = regions.prepare_ring(ring)
                left, right = min(p[0] for p in ring), max(p[0] for p in ring)
                bottom, top = min(p[1] for p in ring), max(p[1] for p in ring)
                points = [ring[0], ring[len(ring)//2], ring[-1],
                          *[(rng.uniform(left, right), rng.uniform(bottom, top)) for _ in range(4)]]
                for x, y in points:
                    # 개선 전과 같은 모든 변 순회 식을 독립적으로 사용합니다.
                    original = False
                    for a, b in zip(ring, [*ring[1:], ring[0]]):
                        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
                            original = not original
                    assert regions.prepared_ring_contains(prepared, x, y) == original
                    tested += 1
    assert tested > 1000


def test_coordinates_share_cache_and_known_missing_region_is_not_recalculated(monkeypatch):
    regions.locate_point.cache_clear()
    first = regions.locate('서로 다른 원문 주소 A', 37.5666, 126.9784)
    second = regions.locate('서로 다른 원문 주소 B', 37.5666, 126.9784)
    assert first == second
    assert regions.locate_point.cache_info().misses == 1
    assert regions.locate_point.cache_info().hits == 1
    def forbidden(*args):
        pytest.fail('확인된 미확정 지역을 다시 계산했습니다.')
    monkeypatch.setattr(regions, 'locate', forbidden)
    assert regions.display_location('미확정 장소', code=None)['display_place'] == '미확정 장소'


def test_slow_response_conversion_does_not_hold_read_lock(client, monkeypatch):
    imported(client)
    converting, release = Event(), Event()
    original = records.observation_view
    def slow(*args):
        converting.set()
        assert release.wait(5)
        return original(*args)
    monkeypatch.setattr(records, 'observation_view', slow)
    with ThreadPoolExecutor(max_workers=2) as pool:
        reader = pool.submit(records.list_surveys)
        assert converting.wait(5)
        try:
            # 변환이 끝나지 않은 동안에도 별도 연결의 저장 완료가 가능해야 합니다.
            with sqlite3.connect(database_path(), timeout=0.1) as db:
                db.execute("INSERT INTO api_usage VALUES('map','2026-11-11',1)")
        finally:
            release.set()
        assert reader.result()[0]['observations']
