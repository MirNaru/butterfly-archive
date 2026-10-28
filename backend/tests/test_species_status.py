"""보호 지정의 지역 범위와 기존 자료 보존, 미접 연도 계산을 검증합니다."""
import pytest
from test_integrations import client


def protection(kind='regional', **extra):
    return {'kind': kind, 'region': '시험도' if kind == 'regional' else '', 'designation': '',
            'source': '가상 공식 자료', 'checked': '2026-10-27', **extra}


def test_multiple_statuses_roundtrip_and_legacy_update_preserves_new_fields(client):
    sid = client.post('/api/species', json={'korean_name': '상태 시험 종'}).json()['id']
    body = {'protections': [protection(), protection('endangered_i'), protection('monument', designation='시험호')],
            'vagrant': True, 'north_only': True, 'sighting_years': [2008, 2025], 'source': '가상 시트',
            'status_notes': '가상 원문', 'protection_review': '가상 확인 메모', 'domestic_extinct': True, 'extinction_source': '사용자 시험 분류'}
    response = client.put(f'/api/species/{sid}/reference', json=body)
    assert response.status_code == 200, response.text
    doc = response.json()
    assert doc['reference']['protected'] is True
    assert len(doc['reference']['protections']) == 3
    legacy = {'expected_updated_at': doc['updated_at'], 'source': '기존 화면에서 수정한 출처'}
    saved = client.put(f'/api/species/{sid}/reference', json=legacy).json()
    for key in ('protections', 'status_notes', 'protection_review', 'domestic_extinct', 'extinction_source'):
        assert saved['reference'][key] == body[key]
    assert saved['reference']['protected'] is True
    catalog = client.get('/api/species/catalog').json()[0]
    assert catalog['reference'] == saved['reference']
    stale = client.put(f'/api/species/{sid}/reference', json={**body, 'expected_updated_at': doc['updated_at']})
    assert stale.status_code == 409


def test_regional_status_does_not_imply_national_protection_or_permission(client):
    sid = client.post('/api/species', json={'korean_name': '지역 상태 종'}).json()['id']
    doc = client.put(f'/api/species/{sid}/reference', json={'protections': [protection()]}).json()
    assert doc['reference']['protected'] is None
    assert doc['reference']['permission'] == 'unknown'
    row = client.get('/api/exploration?on=2026-10-27&region=시험도').json()[0]
    assert row['reference']['protections'] == [protection()]
    assert row['permission'] == 'unknown'


def test_domestic_extinction_requires_source_and_does_not_infer_protection(client):
    sid = client.post('/api/species', json={'korean_name': '국내 절멸 시험 종'}).json()['id']
    assert client.put(f'/api/species/{sid}/reference', json={'domestic_extinct': True}).status_code == 422
    doc = client.put(f'/api/species/{sid}/reference', json={'domestic_extinct': True, 'extinction_source': '사용자 지정 · 가상 근거'}).json()
    assert doc['reference']['protected'] is None
    assert doc['reference']['domestic_extinct'] is True


@pytest.mark.parametrize('entries', [
    [protection(region='')], [protection('monument', region='시험도')],
    [protection(source='')], [protection(checked='잘못된 날짜')],
    [protection(), protection()], [protection('unsupported')],
])
def test_invalid_designations_do_not_write(client, entries):
    sid = client.post('/api/species', json={'korean_name': '보호 검증 종'}).json()['id']
    assert client.put(f'/api/species/{sid}/reference', json={'protections': entries}).status_code == 422
    assert client.get(f'/api/species/{sid}/reference').json()['updated_at'] is None


def test_known_sighting_years_control_old_vagrant(client):
    sid = client.post('/api/species', json={'korean_name': '미접 시험 종'}).json()['id']
    doc = client.put(f'/api/species/{sid}/reference', json={'vagrant': True, 'source': '가상 사례', 'sighting_years': [2008]}).json()
    assert client.get('/api/exploration?on=2026-10-27').json()[0]['old_vagrant'] is True
    response = client.put(f'/api/species/{sid}/reference', json={**doc['reference'], 'sighting_years': [2008, 2025], 'expected_updated_at': doc['updated_at']})
    assert response.status_code == 200
    assert client.get('/api/exploration?on=2026-10-27').json()[0]['old_vagrant'] is False
