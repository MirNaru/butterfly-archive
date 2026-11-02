"""표시 자료가 위치 판정 원본과 특별지역을 바꾸지 않는지 검사합니다."""
import hashlib
from app.regions import ASSET, boundaries, display_boundaries, get_boundaries
from test_integrations import client


def test_original_and_special_regions_unchanged():
    digest=hashlib.sha256(ASSET.read_bytes()).hexdigest()
    assert digest=='c5ab761c67fad2b67c49cde7384c73f22fa0b967b376e6d89b9b747ad069f714'
    original=boundaries()
    for level in ('coarse','medium','full'):
        data=display_boundaries(level)
        assert len(data['features'])==len(original['features'])
        if level!='full': assert data['original_sha256']==digest
        for f in original['features']:
            actual=next(item for item in data['features'] if item['properties']['code']==f['properties']['code'])
            assert actual['properties']==f['properties']
            assert actual['bbox']==f['bbox']
            assert actual['parts']
            if f['properties']['level']=='special' or level=='full':
                g=f['geometry']
                polygons=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
                assert [p['rings'] for p in actual['parts']]==polygons
            for part in actual['parts']:
                left,bottom,right,top=part['bbox']
                assert all(left<=x<=right and bottom<=y<=top for ring in part['rings'] for x,y in ring)
    counts=[sum(len(f['parts']) for f in display_boundaries(level)['features']) for level in ('coarse','medium','full')]
    assert counts[0]<counts[1]<counts[2]


def test_boundary_api_level_and_legacy_response(client):
    assert get_boundaries()['type']=='FeatureCollection'
    for level in ('coarse','medium','full'):
        response=client.get('/api/regions/boundaries',params={'level':level})
        assert response.status_code==200
        data=response.json()
        assert data['level']==level and len(data['features'])==271
        assert 'parts' in data['features'][0]
    assert client.get('/api/regions/boundaries?level=invalid').status_code==422
