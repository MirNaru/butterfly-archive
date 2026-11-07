"""도감 사진 역할·태그 분류와 이전 화면의 자료 보존을 시험 DB에서 확인합니다."""
from io import BytesIO
from PIL import Image
from app.database import connect_database, database_path
from app.migrations import initialize_database, SCHEMA_VERSION
from test_integrations import client
from test_photos import picture


def test_reference_media_preserved_by_old_client_and_validated(client):
    species=client.post('/api/species',json={'korean_name':'시험 나비'}).json()['id']
    photo=client.post('/api/photos/original?filename=test.jpg',content=picture()).json()['id']
    doc=client.get(f'/api/species/{species}/reference').json()
    body={**doc['reference'],'expected_updated_at':doc['updated_at'],'representative_photo_id':photo,
          'stage_identification':[{'stage':'egg','points':'시험 특징','source':'사용자 시험 근거','photo_ids':[photo]}]}
    response=client.put(f'/api/species/{species}/reference',json=body)
    assert response.status_code==200,response.text
    doc=response.json()
    body={**doc['reference'],'expected_updated_at':doc['updated_at']}
    body.pop('representative_photo_id');body.pop('stage_identification')
    saved=client.put(f'/api/species/{species}/reference',json=body).json()
    assert saved['reference']['representative_photo_id']==photo
    assert saved['reference']['stage_identification'][0]['points']=='시험 특징'
    result=client.get(f'/api/species/{species}/photos').json()
    assert result['total']==1 and result['items'][0]['id']==photo
    body={**saved['reference'],'expected_updated_at':saved['updated_at'],'representative_photo_id':99999}
    assert client.put(f'/api/species/{species}/reference',json=body).status_code==422
    assert client.get(f'/api/species/{species}/reference').json()['reference']['representative_photo_id']==photo
    small=client.get(f'/api/photos/{photo}/display?size=small')
    assert small.status_code==200 and small.headers['content-type']=='image/webp'
    with Image.open(BytesIO(small.content)) as image:
        assert max(image.size)<=320 and not image.getexif()


def test_tag_category_move_keeps_links_and_requires_explicit_category(client):
    tag=client.post('/api/tags',json={'name':'시험 개체 특징','category':'individual'}).json()
    survey=client.post('/api/surveys',json={'survey_date':'2026-01-01','place_name':'시험 장소','tags':[tag['name']]}).json()
    moved=client.put(f"/api/tags/{tag['id']}/category",json={'category':'environment'})
    assert moved.status_code==200
    assert client.get(f"/api/surveys/{survey['id']}").json()['tags']==[tag['name']]
    assert client.post('/api/tags',json={'name':tag['name'],'category':'individual'}).status_code==409
    assert client.put(f"/api/tags/{tag['id']}/category",json={'category':'invalid'}).status_code==422


def test_version_fourteen_tag_migration_preserves_ids_links_and_has_backup(client):
    tag=client.post('/api/tags',json={'name':'돌연변이'}).json()
    survey=client.post('/api/surveys',json={'survey_date':'2026-01-01','place_name':'시험 장소','tags':['돌연변이']}).json()
    with connect_database() as db:
        before=[tuple(r) for r in db.execute('SELECT * FROM survey_tags')]
        db.execute('ALTER TABLE tags DROP COLUMN category')
        db.execute('PRAGMA user_version=14')
    initialize_database();initialize_database()
    with connect_database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
        assert db.execute('SELECT category FROM tags WHERE id=?',(tag['id'],)).fetchone()[0]=='individual'
        assert [tuple(r) for r in db.execute('SELECT * FROM survey_tags')]==before
    assert client.get(f"/api/surveys/{survey['id']}").json()['tags']==['돌연변이']
    assert list(database_path().parent.glob(f'*.before-v{SCHEMA_VERSION}-*.bak'))
