"""공개 나비 관찰의 종별 과거 수집과 전체 신규 수집을 재개 가능한 단위로 처리합니다."""
import hashlib
import json
import math
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from typing import Literal
from fastapi import APIRouter, HTTPException, Request
from pydantic import Field
from app.collection import local_screen
from app.collection_import import preserve_stage_override
from app.database import connect_database, database_path
from app.integration_settings import IntegrationError, NoRedirect
from app.schemas import InputModel
from app.api_usage import now_kst

router = APIRouter(prefix='/api/collection/inaturalist', tags=['collection'])
BUTTERFLIES = 47224  # 공식 taxa 조회로 확인한 Papilionoidea입니다.
KOREA = 6891  # 공식 places 조회로 확인한 South Korea입니다.
PAGE_SIZE = 50
INITIAL_LATEST_SIZE = 200
DAILY_LIMIT = 5000
MAX_LOCATION_UNCERTAINTY = 50_000
LOCATION_POLICY_VERSION = 3
request_lock = threading.Lock()
sync_lock = threading.Lock()
last_request = 0.0


def fetch_once(path, params):
    global last_request
    with request_lock:
        delay = 1.05 - (time.monotonic() - last_request)
        if delay > 0:
            time.sleep(delay)
        day = now_kst().date().isoformat()
        with connect_database() as db:
            db.execute('BEGIN IMMEDIATE')
            count = db.execute("SELECT attempts FROM api_usage WHERE service='inaturalist' AND day=?", (day,)).fetchone()
            if count and count[0] >= DAILY_LIMIT:
                raise IntegrationError('iNaturalist 일일 호출 한도에 도달했습니다. 다음 날 이어서 수집해 주세요.', 429)
            db.execute("INSERT INTO api_usage VALUES('inaturalist',?,1) ON CONFLICT(service,day) DO UPDATE SET attempts=attempts+1", (day,))
        last_request = time.monotonic()
        url = 'https://api.inaturalist.org/v1/' + path + '?' + urllib.parse.urlencode(params)
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'ButterflyArchive/0.3 (public observation reader)', 'Accept': 'application/json'})
            with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
                raw = response.read(12_000_001)
            if len(raw) > 12_000_000:
                raise ValueError()
            result = json.loads(raw)
            if not isinstance(result, dict) or not isinstance(result.get('results'), list):
                raise ValueError()
            return result
        except urllib.error.HTTPError as error:
            raise IntegrationError('iNaturalist 호출 제한으로 중단했습니다. 나중에 이어서 수집해 주세요.' if error.code == 429 else 'iNaturalist 조회에 실패했습니다. 저장된 자료와 진행 위치는 유지됩니다.', 429 if error.code == 429 else 503 if error.code >= 500 else 502) from None
        except (OSError, ValueError, TimeoutError):
            raise IntegrationError('iNaturalist 응답을 읽지 못했습니다. 저장된 자료와 진행 위치는 유지됩니다.', 503) from None


def fetch(path, params):
    # 각 시도는 기존 속도·일일 한도에 포함하며 429는 자동 재시도하지 않습니다.
    for attempt in range(2):
        try:
            return fetch_once(path, params)
        except IntegrationError as error:
            if error.status != 503 or attempt:
                raise
            time.sleep(2)


class SearchInput(InputModel):
    query: str = Field(min_length=2, max_length=200)
    kind: Literal['taxa', 'places'] = 'taxa'


@router.post('/search')
def search(value: SearchInput, request: Request):
    local_screen(request)
    params = {'q': value.query, 'per_page': 20, 'locale': 'ko'}
    if value.kind == 'taxa':
        params['taxon_id'] = BUTTERFLIES
        params['rank'] = 'species'
    rows = fetch('taxa/autocomplete' if value.kind == 'taxa' else 'places/autocomplete', params)['results']
    return [{'id': r['id'], 'name': r.get('preferred_common_name') or r.get('display_name') or r.get('name', ''), 'scientific_name': r.get('name', '') if value.kind == 'taxa' else ''}
            for r in rows if isinstance(r, dict) and isinstance(r.get('id'), int)
            and (value.kind != 'taxa' or r['id'] == BUTTERFLIES or BUTTERFLIES in r.get('ancestor_ids', []))]


class SyncInput(InputModel):
    mode: Literal['history', 'latest']
    taxon_id: int | None = Field(default=None, gt=0, strict=True)
    place_id: int = Field(default=KOREA, gt=0, strict=True)
    start: date | None = None
    end: date | None = None


def state_path():
    return database_path().with_name(database_path().name + '.inat-sync.json')


def read_states():
    try:
        value = json.loads(state_path().read_text(encoding='utf-8'))
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        raise HTTPException(503, '수집 진행 파일을 읽지 못했습니다. 파일을 보존하고 상태를 확인해 주세요.') from None


def write_states(states):
    path = state_path()
    temporary = path.with_suffix('.writing')
    temporary.write_text(json.dumps(states, ensure_ascii=False), encoding='utf-8')
    temporary.replace(path)


def normalized(row):
    taxon = row.get('taxon') or {}
    if taxon.get('id') != BUTTERFLIES and BUTTERFLIES not in taxon.get('ancestor_ids', []):
        return None
    if any(row.get(field) not in (None, '', 'open', 'obscured') for field in ('geoprivacy', 'taxon_geoprivacy')):
        return None
    obscured = bool(row.get('obscured') or row.get('geoprivacy') == 'obscured' or row.get('taxon_geoprivacy') == 'obscured')
    accuracy = row.get('public_positional_accuracy')
    accuracy_basis = 'public_positional_accuracy'
    if accuracy is None and not obscured:
        accuracy, accuracy_basis = row.get('positional_accuracy'), 'positional_accuracy'
    if accuracy is None:
        accuracy_basis = 'unknown'
    elif isinstance(accuracy, bool) or not isinstance(accuracy, (int, float)) or not math.isfinite(accuracy) or not 0 <= accuracy <= MAX_LOCATION_UNCERTAINTY:
        return None
    coordinates = (row.get('geojson') or {}).get('coordinates')
    if not isinstance(coordinates, list) or len(coordinates) != 2:
        return None
    lng, lat = coordinates
    if any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in (lat, lng)) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
        return None
    observed = row.get('observed_on')
    try:
        date.fromisoformat(observed)
    except (ValueError, TypeError):
        observed = None
    scientific = taxon.get('name', '')
    clock = None
    try:
        timestamp = datetime.fromisoformat(row.get('time_observed_at') or '')
        offset = row.get('time_zone_offset') or ''
        if observed and offset and timestamp.tzinfo and timestamp.date().isoformat() == observed and timestamp.strftime('%z') == offset.replace(':', ''):
            clock = timestamp.time().isoformat()
    except (ValueError, TypeError):
        pass  # 원문에 현지 시각과 일치하는 시간대가 없으면 시각을 추측하지 않습니다.
    return dict(source='inaturalist', source_id=str(row['id']), url=f"https://www.inaturalist.org/observations/{row['id']}",
                korean_name=taxon.get('preferred_common_name') or scientific or '종 미확인', scientific_name=scientific,
                observed_raw=row.get('observed_on_string') or observed or '', observed_date=observed, observed_time=clock,
                place_raw=row.get('place_guess') or '', latitude=lat, longitude=lng,
                weather_raw='', location_accuracy=accuracy, location_obscured=obscured, accuracy_basis=accuracy_basis,
                original=row)


def save_payload(db, payload, stamp):
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    old = db.execute("SELECT * FROM collected_observations WHERE source='inaturalist' AND source_id=?", (payload['source_id'],)).fetchone()
    encoded = json.dumps(preserve_stage_override(old,payload),ensure_ascii=False,sort_keys=True)
    status = 'created' if old is None else 'unchanged' if old['payload_json'] == encoded else 'updated'
    if status == 'updated':
        db.execute('INSERT INTO collection_revisions(item_id,payload_json,replaced_at) VALUES(?,?,?)', (old['id'], old['payload_json'], stamp))
    db.execute("""INSERT INTO collected_observations(source,source_id,payload_json,first_received_at,last_received_at,collected_at)
        VALUES('inaturalist',?,?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET payload_json=excluded.payload_json,
        last_received_at=excluded.last_received_at,collected_at=excluded.collected_at""", (payload['source_id'], encoded, stamp, stamp, stamp))
    return status


@router.post('/sync')
def sync(value: SyncInput, request: Request):
    local_screen(request)
    if value.start and value.end and value.start > value.end:
        raise HTTPException(422, '관찰 시작일은 종료일 이전이어야 합니다.')
    if value.mode == 'history' and not value.taxon_id:
        raise HTTPException(422, '과거 수집할 종을 검색 결과에서 선택해 주세요.')
    if value.mode == 'latest' and value.taxon_id:
        raise HTTPException(422, '최신 수집은 종과 관계없이 나비 전체를 조회합니다.')
    if not sync_lock.acquire(blocking=False):
        raise HTTPException(409, '다른 수집 요청이 진행 중입니다. 완료 후 다시 실행해 주세요.')
    try:
        states = read_states()
        key = hashlib.sha256(value.model_dump_json().encode()).hexdigest()
        state = states.get(key, {})
        # 과거 조건은 사용자가 다시 실행할 때 새 위치 기준으로 재검사합니다.
        if value.mode == 'history' and state and state.get('location_policy_version') != LOCATION_POLICY_VERSION:
            state = {}
        started_at = state.get('started_at') or datetime.now(timezone.utc).isoformat()
        since = state.get('since')
        if value.mode == 'latest' and not state:
            starts = [s['started_at'] for s in states.values() if s.get('query', {}).get('mode') == 'history'
                      and s['query'].get('place_id') == value.place_id and s.get('started_at')]
            since = min(starts) if starts else None
        if value.mode == 'history' and state.get('done'):
            return {**state, 'created': 0, 'updated': 0, 'unchanged': 0, 'excluded': 0}
        if value.mode == 'history' and not state:
            taxa = fetch(f'taxa/{value.taxon_id}', {})['results']
            if len(taxa) != 1 or taxa[0].get('id') != value.taxon_id or taxa[0].get('rank') != 'species' or BUTTERFLIES not in taxa[0].get('ancestor_ids', []):
                raise HTTPException(422, '나비 종만 과거 수집 대상으로 선택할 수 있습니다.')
        params = dict(taxon_id=value.taxon_id or BUTTERFLIES, place_id=value.place_id, per_page=PAGE_SIZE,
                      order_by='id', order='desc', locale='ko')
        if value.start:
            params['d1'] = value.start.isoformat()
        if value.end:
            params['d2'] = value.end.isoformat()
        if state.get('cursor'):
            params['id_below'] = state['cursor']
        if since and not state.get('completed_high'):
            params['created_d1'] = since
        if value.mode == 'latest' and state.get('completed_high'):
            params['id_above'] = state['completed_high']
        rows = fetch('observations', params)['results']
        ids = [r.get('id') for r in rows if isinstance(r, dict)]
        if len(ids) != len(rows) or any(type(i) is not int or i <= 0 for i in ids) or ids != sorted(set(ids), reverse=True) or (ids and state.get('cursor') and ids[0] >= state['cursor']) or (ids and state.get('completed_high') and ids[-1] <= state['completed_high']):
            raise IntegrationError('응답의 진행 순서가 올바르지 않아 수집을 중단했습니다.')
        counts = dict(created=0, updated=0, unchanged=0, excluded=0)
        stamp = datetime.now(timezone.utc).isoformat()
        with connect_database() as db:
            db.execute('BEGIN IMMEDIATE')
            # 최초 반입 전에 확정된 전체 DB 보호 복사본을 남깁니다.
            if not states:
                backup = database_path().with_name(database_path().name + '.before-inaturalist-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.bak')
                with connect_database() as source, sqlite3.connect(backup) as destination:
                    source.backup(destination)
            for row in rows:
                payload = normalized(row)
                if payload is None:
                    counts['excluded'] += 1
                else:
                    counts[save_payload(db, payload, stamp)] += 1
        high = max(state.get('pending_high', 0), max(ids, default=0))
        # 과거 수집 중 새로 게시된 자료도 전체 최신 조회에서 빠짐없이 이어갑니다.
        done = len(rows) < PAGE_SIZE or (value.mode == 'latest' and not state.get('completed_high') and not since and state.get('scanned', 0) + len(rows) >= INITIAL_LATEST_SIZE)
        next_state = dict(state, done=done, cursor=ids[-1] if ids and not done else None,
                          pending_high=high, scanned=state.get('scanned', 0) + len(rows), updated_at=stamp,
                          started_at=started_at, since=since, query=value.model_dump(mode='json'), location_policy_version=LOCATION_POLICY_VERSION)
        if value.mode == 'latest' and done:
            next_state.update(completed_high=max(state.get('completed_high', 0), high), pending_high=0)
        states[key] = next_state
        try:
            write_states(states)
        except OSError:
            raise HTTPException(503, '자료는 저장했지만 진행 위치를 저장하지 못했습니다. 다시 실행하면 중복 없이 이어갑니다.') from None
        return {**next_state, **counts}
    finally:
        sync_lock.release()
