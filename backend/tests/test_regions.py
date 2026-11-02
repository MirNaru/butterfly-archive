"""행정지역의 좌표·동명·근거·수동 해제·휴지통 연동을 임시 DB에서 검사합니다."""
import json
import pytest
from app.database import connect_database
from app.regions import resolve_name,locate,contains,index,display_location,current_label
from test_integrations import client,record
from test_updates import payload


def species(client):
    return client.post('/api/species',json={'korean_name':'지역 시험 종'}).json()['id']


def reference(client,sid):
    return client.get(f'/api/species/{sid}/reference').json()


def save(client,sid,codes):
    doc=reference(client,sid)
    return client.put(f'/api/species/{sid}/reference',json={**doc['reference'],'region_codes':codes,'expected_updated_at':doc['updated_at']})


def test_official_asset_and_names():
    assert len([f for f in index().values() if f['properties']['level']!='special'])==269
    assert resolve_name('경기광주','경기도')==resolve_name('광주','경기도')
    assert resolve_name('광주','전라남도')==['24']
    assert resolve_name('강화','경기도')==resolve_name('강화','인천')
    assert resolve_name('군위','경상북도')
    assert resolve_name('경남고성','경상남도')!=resolve_name('고성','강원도')
    assert resolve_name('한라','제주도')==['special-hallasan']
    assert resolve_name('마라도','제주도')==['special-marado']
    assert locate('강원 정선군 고한읍')==resolve_name('정선','강원도')[0]
    assert locate('Tokyo',35.68,139.69) is None
    assert locate('',37.5666,126.9784)


def test_polygon_hole_and_multipart():
    f={'bbox':[0,0,10,10],'geometry':{'type':'Polygon','coordinates':[
        [[0,0],[10,0],[10,10],[0,10],[0,0]],[[4,4],[6,4],[6,6],[4,6],[4,4]]]}}
    assert contains(f,2,2) and not contains(f,5,5) and not contains(f,20,20)
    hallasan=index()['special-hallasan']
    assert hallasan['properties']['altitude_min_m']==1000
    assert hallasan['properties']['grid_size']==3601
    assert contains(hallasan,33.3614,126.5359)
    assert not contains(hallasan,33.25,126.53)


def test_current_display_preserves_original_and_english_is_coordinate_based(client):
    assert display_location('강원 정선군 고한읍')['display_place']=='강원특별자치도 정선군 고한읍'
    assert display_location('강원도 정선군 고한읍')['display_place']=='강원특별자치도 정선군 고한읍'
    assert display_location('Jeju, South Korea',33.3614,126.5359)['display_place'].startswith('제주특별자치도 ')
    assert display_location('Unknown English location')['display_place']=='Unknown English location'
    assert display_location('Tokyo',35.68,139.69)['display_place']=='Tokyo'
    assert '개편지역 확인 필요' in current_label('23010')
    assert current_label('36010').startswith('전남광주통합특별시 ')
    original='강원도 정선군 고한읍'
    saved=record(client,place_name=original,latitude=None,longitude=None,observations=[{}])
    assert saved['place_name']==original and saved['observations'][0]['effective_place']==original
    assert saved['display_place']=='강원특별자치도 정선군 고한읍'
    assert '강원도 정선군' in saved['observations'][0]['place_search']
    loaded=next(s for s in client.get('/api/surveys').json() if s['id']==saved['id'])
    assert loaded==saved
    edited=client.put(f"/api/surveys/{saved['id']}",json=payload(saved))
    assert edited.status_code==200 and edited.json()['place_name']==original


def test_manual_save_search_and_conflict(client):
    sid=species(client);code=resolve_name('정선','강원도')[0]
    original=reference(client,sid)
    response=save(client,sid,[code])
    assert response.status_code==200,response.text
    ref=response.json()['reference']
    assert '강원도' in ref['region_search'] and '정선군' in ref['regions'][0]
    assert client.get('/api/exploration?on=2026-11-02&region=정선').json()[0]['region_match']
    assert not client.get('/api/exploration?on=2026-11-02&region=거제').json()[0]['region_match']
    assert client.put(f'/api/species/{sid}/reference',json={**original['reference'],'region_codes':[code]}).status_code==409
    assert save(client,sid,['invalid']).status_code==422
    assert reference(client,sid)['reference']['region_codes']==[code]
    assert save(client,sid,[]).json()['reference']['region_codes']==[]


def test_confirmed_observation_adds_region_without_overwriting_excel_and_delete_removes_only_observation(client):
    sid=species(client);base=resolve_name('거제','경상남도')[0];extra=resolve_name('정선','강원도')[0]
    with connect_database() as db:
        db.execute('INSERT INTO species_references VALUES(?,?,?)',(sid,json.dumps({'region_evidence':[{'code':base,'origin':'excel','detail':'원문 셀'}],'habits':'원래 습성','ecology_source':'시험 자료'}),'original'))
    saved=record(client,place_name='강원도 정선군 고한읍',latitude=None,longitude=None,observations=[{'species_id':sid,'identification':'candidate'}])
    assert reference(client,sid)['reference']['region_codes']==[base]
    body=payload(saved);body['observations'][0]['identification']='user_confirmed'
    response=client.put(f"/api/surveys/{saved['id']}",json=body)
    assert response.status_code==200
    assert set(reference(client,sid)['reference']['region_codes'])=={base,extra}
    moved=client.request('DELETE',f"/api/surveys/{saved['id']}",json={'expected_updated_at':response.json()['updated_at']}).json()
    assert reference(client,sid)['reference']['region_codes']==[base]
    assert client.post(f"/api/trash/{moved['id']}/restore",json={'expected_deleted_at':moved['deleted_at']}).status_code==200
    assert extra in reference(client,sid)['reference']['region_codes']
    assert save(client,sid,[base]).status_code==200
    assert reference(client,sid)['reference']['region_codes']==[base]
    assert reference(client,sid)['reference']['habits']=='원래 습성'
    assert extra in save(client,sid,[base,extra]).json()['reference']['region_codes']


def test_duplicate_evidence_and_withdrawal(client):
    sid=species(client);code=resolve_name('정선','강원도')[0]
    first=record(client,place_name='강원도 정선군',latitude=None,longitude=None,observations=[{'species_id':sid,'identification':'user_confirmed'}])
    second=record(client,place_name='강원도 정선군',latitude=None,longitude=None,observations=[{'species_id':sid,'identification':'user_confirmed'}])
    assert reference(client,sid)['reference']['region_codes']==[code]
    for saved in [first,second]:
        body=payload(saved);body['observations'][0]['identification']='candidate'
        assert client.put(f"/api/surveys/{saved['id']}",json=body).status_code==200
    assert reference(client,sid)['reference']['region_codes']==[]
    assert client.get('/api/regions').status_code==200
    assert client.get('/api/regions/boundaries').json()['type']=='FeatureCollection'
