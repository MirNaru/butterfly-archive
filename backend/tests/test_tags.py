"""태그 목록·공통 상속·수정 원자성과 버전 4 자료 보존을 확인합니다."""
import sqlite3
import pytest
from app import migrations
from app.tags import DEFAULT_TAGS
from app.database import connect_database
from test_integrations import client, upstream, record, query
from test_updates import payload


def test_defaults_custom_and_duplicate_names(client):
    names = [t['name'] for t in client.get('/api/tags').json()]
    assert names == list(DEFAULT_TAGS)
    assert not {'흡밀','산란'} & set(names)
    first = client.post('/api/tags', json={'name': '  시험 환경  '}).json()
    second = client.post('/api/tags', json={'name': '시험 환경'}).json()
    assert first == second
    for invalid in ['', ' ', 'x'*61]:
        assert client.post('/api/tags', json={'name': invalid}).status_code == 422


def test_scope_inheritance_and_removing_selection_preserves_catalog(client):
    response = client.post('/api/surveys', json={'survey_date':'2026-10-27','place_name':'가상 지역',
        'tags':[' 태풍 ', '태풍','관찰 전 강우'], 'observations':[{'tags':['하천 범람']}, {}]})
    assert response.status_code == 201, response.text
    saved = response.json()
    assert set(saved['tags']) == {'태풍','관찰 전 강우'}
    assert set(saved['observations'][0]['effective_tags']) == {'태풍','관찰 전 강우','하천 범람'}
    assert saved['observations'][1]['tags'] == []
    body = payload(saved)
    body['tags']=['새 공통 조건']
    body['observations'][0]['tags']=[]
    changed=client.put(f"/api/surveys/{saved['id']}",json=body)
    assert changed.status_code==200,changed.text
    assert all(o['effective_tags']==['새 공통 조건'] for o in changed.json()['observations'])
    assert client.get(f"/api/surveys/{saved['id']}").json()==changed.json()
    options={t['name']:t['usage'] for t in client.get('/api/tags').json()}
    assert options['하천 범람']==0 and options['새 공통 조건']==1
    assert client.put(f"/api/surveys/{saved['id']}",json=body).status_code==409


@pytest.mark.parametrize('tags', [[''], [' '], ['x'*61], list(map(str,range(61))), [1], '태풍'])
def test_invalid_tags_rejected_without_save(client,tags):
    response=client.post('/api/surveys',json={'survey_date':'2026-10-27','place_name':'시험','tags':tags})
    assert response.status_code==422
    assert client.get('/api/surveys').json()==[]


def test_failed_record_does_not_leave_tags_or_links(client):
    response=client.post('/api/surveys',json={'survey_date':'2026-10-27','place_name':'시험','tags':['실패 태그'],
        'observations':[{'species_id':99999,'tags':['실패 개별 태그']}]})
    assert response.status_code==422
    assert client.get('/api/surveys').json()==[]
    assert '실패 태그' not in [t['name'] for t in client.get('/api/tags').json()]


def test_omitted_tags_and_weather_are_preserved(client,upstream):
    saved=record(client,tags=['태풍'],observations=[{'tags':['하천 범람']}])
    assert query(client,saved['id']).status_code==200
    before=client.get(f"/api/weather/survey/{saved['id']}").json()
    calls=len(upstream)
    body=payload(saved)
    body.pop('tags')
    body['observations'][0].pop('tags')
    body['notes']='태그 생략 API 호환 시험'
    changed=client.put(f"/api/surveys/{saved['id']}",json=body)
    assert changed.status_code==200,changed.text
    assert changed.json()['tags']==['태풍']
    assert changed.json()['observations'][0]['tags']==['하천 범람']
    assert client.get(f"/api/weather/survey/{saved['id']}").json()==before
    assert len(upstream)==calls


def test_v4_upgrade_backup_and_rollback(tmp_path,monkeypatch):
    path=tmp_path/'v4.sqlite3'
    monkeypatch.setenv('BUTTERFLY_DB_PATH',str(path))
    with sqlite3.connect(path) as db:
        for sql in migrations.STATEMENTS+migrations.INTEGRATION_STATEMENTS+migrations.REFERENCE_STATEMENTS+migrations.SOURCE_STATEMENTS: db.execute(sql)
        db.execute("INSERT INTO surveys VALUES(1,'2026-10-27','기존 장소',NULL,NULL,'unknown','general','원본 메모','before','before')")
        db.execute('PRAGMA user_version=4')
        before=db.execute('SELECT * FROM surveys').fetchall()
    with monkeypatch.context() as patch:
        patch.setattr(migrations,'TAG_STATEMENTS',migrations.TAG_STATEMENTS+('INVALID SQL',))
        with pytest.raises(sqlite3.Error): migrations.initialize_database()
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==4
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='tags'").fetchone()
        assert db.execute('SELECT * FROM surveys').fetchall()==before
    migrations.initialize_database()
    migrations.initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==5
        assert [tuple(r) for r in db.execute('SELECT * FROM surveys')]==before
        assert db.execute('SELECT COUNT(*) FROM tags').fetchone()[0]==len(DEFAULT_TAGS)
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    for backup in tmp_path.glob('*.before-v5-*.bak'):
        with sqlite3.connect(backup) as db:
            assert db.execute('PRAGMA user_version').fetchone()[0]==4
            assert db.execute('SELECT * FROM surveys').fetchall()==before
