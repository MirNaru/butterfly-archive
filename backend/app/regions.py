"""공식 로컬 경계와 종별 지역 근거를 연결합니다. 외부 위치 조회는 하지 않습니다."""
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal
from fastapi import APIRouter

router = APIRouter(prefix='/api/regions')
ASSET = Path(__file__).with_name('assets') / 'admin-regions.geojson'
ALIASES = {'강원특별자치도':'강원도', '전북특별자치도':'전라북도', '제주특별자치도':'제주도',
           '서울특별시':'서울', '부산광역시':'부산', '대구광역시':'대구', '인천광역시':'인천',
           '광주광역시':'광주', '대전광역시':'대전', '울산광역시':'울산', '세종특별자치시':'세종',
           '경기도':'경기', '충청북도':'충북', '충청남도':'충남', '전라남도':'전남',
           '경상북도':'경북', '경상남도':'경남'}


@lru_cache(maxsize=1)
def boundaries():
    return json.loads(ASSET.read_text(encoding='utf-8'))


@lru_cache(maxsize=1)
def index():
    return {f['properties']['code']: f for f in boundaries()['features']}


def metadata():
    return [{**f['properties'], 'label': current_label(c),
             'name': current_label(c) if f['properties']['level']=='sido' or c in ('23010','23020','23080') else f['properties']['name']}
            for c,f in index().items()]


def current_label(code):
    """2025 경계의 공간 범위는 유지하고 확인된 명칭 변경만 표시합니다."""
    p=index()[code]['properties']
    if code.startswith(('24','36')):
        return '전남광주통합특별시 '+(f"(옛 {p['province']} 지역)" if p['level']=='sido' else p['name'])
    if code in ('23010','23080'):
        return f"인천광역시 (옛 {p['name']} 범위)"
    if code=='23020': return '인천광역시 제물포구 (옛 동구 범위)'
    return p['label']


_REGION_UNSET = object()


def display_location(place, lat=None, lng=None, code=_REGION_UNSET):
    """원문은 저장한 그대로 두고 현재 행정명과 확정 가능한 한국어 상세만 표시합니다."""
    if code is _REGION_UNSET:
        code=locate(place,lat,lng)
    if not code: return {'display_place':place,'place_search':place,'location_note':'행정지역 미확인' if place else ''}
    f=index()[code];label=current_label(code)
    original=place.strip()
    if original.startswith('대한민국 '): original=original[5:]
    tail=''
    if f['properties']['level']=='sigungu' and code not in ('23010','23080'):
        for a in sorted(aliases(f),key=len,reverse=True):
            if original==a or original.startswith(a+' '):
                tail=original[len(a):];break
    display=label+tail
    return {'display_place':display,'place_search':' '.join([place,display,*aliases(f)]),'location_note':''}


@lru_cache(maxsize=512)
def administrative_center(code):
    """경계 중심에 가까운 내부 점을 지도 표시용으로 반환합니다."""
    feature = index()[code]
    west, south, east, north = feature['bbox']
    latitude, longitude = (south + north) / 2, (west + east) / 2
    if contains(feature, latitude, longitude):
        return {'latitude': latitude, 'longitude': longitude}
    offsets = sorted(((y, x) for y in range(-16, 17) for x in range(-16, 17)),
                     key=lambda pair: pair[0] ** 2 + pair[1] ** 2)
    for y, x in offsets:
        lat = latitude + y * (north - south) / 32
        lng = longitude + x * (east - west) / 32
        if contains(feature, lat, lng):
            return {'latitude': lat, 'longitude': lng}
    return None


@router.get('')
def list_regions():
    return {'regions': metadata(), 'source': boundaries()['source'], 'source_url': boundaries()['source_url']}


@lru_cache(maxsize=3)
def display_boundaries(level):
    """지도 표시 전용입니다. 위치 판정은 계속 원본 boundaries/index를 사용합니다."""
    if level != 'full':
        return json.loads(ASSET.with_name(f'admin-regions-{level}.json').read_text(encoding='utf-8'))
    data = boundaries()
    features = []
    for f in data['features']:
        g = f['geometry']
        polygons = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        parts = []
        for i, rings in enumerate(polygons):
            points = [p for ring in rings for p in ring]
            parts.append({'id': i, 'rings': rings, 'bbox': [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]})
        features.append({'properties': f['properties'], 'bbox': f['bbox'], 'parts': parts})
    return {'level': level, 'features': features, 'source': data['source'], 'source_url': data['source_url']}


@router.get('/boundaries')
def get_boundaries(level: Literal['coarse', 'medium', 'full'] | None = None):
    if level:
        data = display_boundaries(level)
        return {**data, 'features': [{**f, 'properties': {**f['properties'], 'label': current_label(f['properties']['code'])}} for f in data['features']]}
    data=boundaries()
    return {**data,'features':[{**f,'properties':{**f['properties'],'label':current_label(c)}} for c,f in index().items()]}


def aliases(feature):
    p = feature['properties']
    province, name = p['province'], p['name']
    short = re.sub(r'(시|군|구)$', '', name)
    variants = list(dict.fromkeys([province, ALIASES.get(province, province),
        *{'강원특별자치도':['강원'],'전북특별자치도':['전북'],'제주특별자치도':['제주']}.get(province,[])]))
    values=[p['label'], *variants] if p['level']=='sido' else [f'{v} {n}' for v in variants for n in (name,short)]
    if province in ('광주광역시','전라남도'):
        values.extend([current_label(p['code']), '전남광주통합특별시' if p['level']=='sido' else f'전남광주통합특별시 {name}'])
    return values


def resolve_name(text, province=''):
    """엑셀 열의 도와 이름이 일치하는 경우만 연결하며 동명 지역은 추정하지 않습니다."""
    text = text.strip()
    if text in ('한라','한라산'): return ['special-hallasan']
    if text == '마라도': return ['special-marado']
    for prefix, full in (('경남','경상남도'),('강원','강원도'),('경기','경기도')):
        if text.startswith(prefix) and text[len(prefix):] in ('고성','광주'):
            province,text=full,text[len(prefix):]
    explicit = {'서울':'11','인천':'23','부산':'21','대구':'22','대전':'25','광주광역시':'24','울산':'26','세종':'29'}
    if text in explicit: return [explicit[text]]
    if text == '경기광주': province, text = '경기도', '광주'
    if text == '광주' and province != '경기도': return ['24']
    matches = []
    for code, f in index().items():
        p = f['properties']
        if text in aliases(f) and (not province or p['level']!='sido' or province in (p['province'],ALIASES.get(p['province']))): matches.append(code); continue
        if province and province not in (p['province'], ALIASES.get(p['province'])): continue
        if p['level']=='sigungu' and text in (p['name'], re.sub(r'(시|군|구)$','',p['name'])):
            matches.append(code)
        elif p['level']=='sigungu' and p['name'].startswith(text+'시 '):
            matches.append(code)  # 수원시 등의 비자치구는 해당 시 전체를 선택합니다.
    if not matches:
        unique=[c for c,f in index().items() if f['properties']['level']=='sigungu' and text in (f['properties']['name'],re.sub(r'(시|군|구)$','',f['properties']['name']))]
        if len(unique)==1:matches=unique
    return list(dict.fromkeys(matches))


def ring_contains(ring, x, y):
    inside = False
    for i, a in enumerate(ring):
        b = ring[(i + 1) % len(ring)]
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            inside = not inside
    return inside


def prepare_ring(ring):
    """수평 띠별 경계 후보를 준비하며 최종 교차 판정식과 원본 좌표는 보존합니다."""
    bottom = min(p[1] for p in ring)
    top = max(p[1] for p in ring)
    count = min(128, max(1, len(ring) // 16))
    scale = count / (top - bottom) if top != bottom else 0
    bands = [[] for _ in range(count)]
    for i, a in enumerate(ring):
        b = ring[(i + 1) % len(ring)]
        if a[1] == b[1]:
            continue
        edge = (a, b)
        first = max(0, min(count - 1, int((min(a[1], b[1]) - bottom) * scale)))
        last = max(0, min(count - 1, int((max(a[1], b[1]) - bottom) * scale)))
        for band in range(first, last + 1):
            bands[band].append(edge)
    return bottom, top, scale, bands


def prepared_ring_contains(prepared, x, y):
    bottom, top, scale, bands = prepared
    if y < bottom or y > top:
        return False
    band = max(0, min(len(bands) - 1, int((y - bottom) * scale)))
    inside = False
    for a, b in bands[band]:
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            inside = not inside
    return inside


@lru_cache(maxsize=512)
def prepared_polygons(code):
    geometry = index()[code]['geometry']
    polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    return [[prepare_ring(ring) for ring in polygon] for polygon in polygons]


def contains(feature, lat, lng):
    left, bottom, right, top = feature['bbox']
    if not left <= lng <= right or not bottom <= lat <= top: return False
    code = feature.get('properties', {}).get('code')
    if code and index().get(code) is feature:
        return any(prepared_ring_contains(p[0],lng,lat) and not any(prepared_ring_contains(h,lng,lat) for h in p[1:])
                   for p in prepared_polygons(code))
    geometry = feature['geometry']
    polygons = [geometry['coordinates']] if geometry['type']=='Polygon' else geometry['coordinates']
    return any(ring_contains(p[0],lng,lat) and not any(ring_contains(h,lng,lat) for h in p[1:]) for p in polygons)


# 서버 실행 중 경계는 고정됩니다. 관찰이나 종별 근거가 아닌 위치 판정만 재사용합니다.
@lru_cache(maxsize=8192)
def locate(place, lat=None, lng=None):
    if lat is not None and lng is not None:
        return locate_point(lat, lng)
    place = place.strip()
    if place.startswith('대한민국 '): place = place[5:]
    found = []
    for code,f in index().items():
        if f['properties']['level']=='special': continue
        if any(place==a or place.startswith(a+' ') for a in aliases(f)): found.append(code)
    children = [c for c in found if len(c)>2]
    return children[0] if len(children)==1 else found[0] if len(found)==1 else None


@lru_cache(maxsize=65536)
def locate_point(lat, lng):
    """같은 좌표의 지역 판정을 원문 주소와 별개로 재사용합니다."""
    found = [code for code,f in index().items() if f['properties']['level']=='sigungu' and contains(f,lat,lng)]
    return found[0] if len(found)==1 else None


def observation_area_codes(code):
    """관찰 근거를 시·군 또는 특별시·광역시 전체의 표시 범위로 확장합니다."""
    if not code or code not in index():
        return []
    p = index()[code]['properties']
    if p['level'] == 'special':
        return [code]
    province = code[:2]
    if province in {'11', '21', '22', '23', '24', '25', '26', '29'}:
        return [province]
    city = p['name'].split(' ')[0]
    if p['level'] == 'sigungu' and city.endswith('시'):
        return [c for c, f in index().items() if c[:2] == province
                and f['properties']['level'] == 'sigungu'
                and f['properties']['name'].split(' ')[0] == city]
    return [code]


def observation_regions(db):
    # 후보·미발견·휴지통은 제외하고 실제 관찰 날짜와 원문 출처를 근거로 연결합니다.
    result = {}
    for r in db.execute("""SELECT o.*,s.place_name AS sp,s.latitude AS slat,s.longitude AS slng,
        COALESCE(o.observation_date,s.survey_date) AS day FROM observations o JOIN surveys s ON s.id=o.survey_id
        WHERE o.species_id IS NOT NULL AND o.identification='user_confirmed' AND o.result='observed'
        AND NOT EXISTS(SELECT 1 FROM collection_import_views ci WHERE ci.observation_id=o.id
            AND json_extract(ci.payload_json,'$.location_obscured')=1)
        AND NOT EXISTS(SELECT 1 FROM record_trash t WHERE t.restored_at IS NULL AND
        ((t.kind='survey' AND t.survey_id=o.survey_id) OR (t.kind='observation' AND t.observation_id=o.id)))"""):
        own = bool(r['place_name']) or r['latitude'] is not None
        code = locate(r['place_name'] if own else r['sp'],r['latitude'] if own else r['slat'],r['longitude'] if own else r['slng'])
        place=r['place_name'] if own else r['sp']
        codes=observation_area_codes(code)
        for name,special in [('한라산','special-hallasan'),('마라도','special-marado')]:
            lat,lng=(r['latitude'],r['longitude']) if own else (r['slat'],r['slng'])
            if special in index() and (contains(index()[special],lat,lng) if lat is not None and lng is not None else name in place):codes.append(special)
        for code in codes:
            result.setdefault(r['species_id'], []).append({'code':code,'origin':'observation',
                'detail':f"관찰 #{r['id']} · {r['day']} · {'직접 관찰' if r['source_type']=='direct' else r['source_note']}"[:2400]})
    return result


def enrich(reference, observed):
    excluded = set(reference.pop('_region_exclusions', []))
    evidence = [e for e in [*reference.get('region_evidence', []), *observed] if e['code'] not in excluded]
    codes = list(dict.fromkeys(e['code'] for e in evidence))
    reference['region_evidence'] = evidence
    reference['region_codes'] = codes
    reference['region_search'] = ' '.join(' '.join([*aliases(index()[c]),index()[c]['properties']['group']]) for c in codes if c in index())
    reference['regions'] = list(dict.fromkeys([*[display_location(n)['display_place'] for n in reference['regions']], *[current_label(c) for c in codes if c in index()]]))
    return reference


def for_species(db, sid, reference, observed=None, raw=None):
    if raw is None:
        row = db.execute('SELECT payload_json FROM species_references WHERE species_id=?',(sid,)).fetchone()
        raw = json.loads(row[0]) if row else {}
    reference['_region_exclusions'] = raw.get('_region_exclusions', [])
    return enrich(reference,(observation_regions(db) if observed is None else observed).get(sid,[]))


def prepare_save(db, sid, payload, selected):
    payload.pop('region_search',None)
    row = db.execute('SELECT payload_json FROM species_references WHERE species_id=?',(sid,)).fetchone()
    old = json.loads(row[0]) if row else {}
    payload['region_unmatched'] = old.get('region_unmatched',[])
    entries = old.get('region_evidence', [])
    if selected is None:
        payload.update(region_evidence=entries,region_codes=old.get('region_codes',[]))
        payload['_region_exclusions'] = old.get('_region_exclusions',[])
    else:
        if any(c not in index() for c in selected): raise ValueError('알 수 없는 행정지역입니다.')
        known = {e['code'] for e in entries} | {e['code'] for e in observation_regions(db).get(sid,[])}
        entries = [*entries,*[{'code':c,'origin':'manual','detail':'사용자 기본 정보 지정'} for c in selected if c not in known]]
        payload.update(region_evidence=entries,region_codes=list(selected))
        payload['_region_exclusions'] = sorted((known | set(old.get('_region_exclusions',[]))) - set(selected))
    # 화면의 합산 문자열을 수동 원문에 다시 저장하지 않습니다.
    if selected is not None: payload['regions'] = old.get('regions',[])
    return payload


def matches_region(reference, query):
    query = query.strip().casefold()
    return not query or any(query in ' '.join([*aliases(index()[c]),index()[c]['properties']['group']]).casefold()
                           for c in reference.get('region_codes',[]) if c in index()) or any(query in n.casefold() for n in reference['regions'])
