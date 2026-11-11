"""확장 프로그램의 공개 관찰 자료를 인증 후 검토 대기함에 저장합니다."""
import sqlite3
import time
import hashlib
import json
import secrets
from datetime import datetime, timezone
from typing import Annotated, Literal
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.database import connect_database
from app.collection_import import registration_info, import_item, preserve_stage_override, observed_datetime, source_location_note
from app.regions import display_location

router = APIRouter(prefix='/api/collection', tags=['collection'])

class CollectedObservation(BaseModel):
    model_config = ConfigDict(extra='forbid', str_max_length=2000, allow_inf_nan=False)
    source: Literal['naturing']
    source_id: str = Field(pattern=r'^[1-9][0-9]{0,15}$')
    url: str
    korean_name: str = Field(min_length=1, max_length=200)
    scientific_name: str = Field(default='', max_length=200)
    observed_raw: str = ''
    place_raw: str = ''
    manual_capture: bool = Field(default=False, strict=True)
    location_status: Literal['public','private_location','missing_location'] = 'public'
    altitude_raw: str = ''
    weather_raw: str = ''
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    location_accuracy: Literal['unknown'] = 'unknown'
    review_status: Literal['pending'] = 'pending'
    collected_at: datetime

    @model_validator(mode='after')
    def consistent(self):
        if self.url != f'https://www.naturing.net/o/{self.source_id}':
            raise ValueError('출처 주소와 관찰 번호가 일치해야 합니다.')
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError('위도와 경도를 함께 입력해야 합니다.')
        if self.location_status != 'public' and (not self.manual_capture or self.latitude is not None or self.place_raw):
            raise ValueError('위치 없는 수동 자료에는 장소·좌표를 지정하지 않습니다.')
        if self.collected_at.tzinfo is None:
            raise ValueError('수집 시각에는 시간대가 필요합니다.')
        return self

def local_screen(request: Request):
    origin = request.headers.get('origin')
    if origin and origin not in ('http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174'):
        raise HTTPException(403, '앱 화면에서 연결 키를 발급해 주세요.')
    if request.headers.get('x-butterfly-client') != 'app':
        raise HTTPException(403, '앱 화면에서 연결 키를 발급해 주세요.')

@router.post('/connection')
def create_connection(request: Request):
    local_screen(request)
    token = secrets.token_urlsafe(32)
    with connect_database() as db:
        db.execute('INSERT INTO collection_connection(id,token_hash) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash', (hashlib.sha256(token.encode()).hexdigest(),))
    return {'token': token}

def authenticate(request: Request, db):
    authorization = request.headers.get('authorization', '')
    token = authorization.removeprefix('Bearer ') if authorization.startswith('Bearer ') else ''
    row = db.execute('SELECT token_hash FROM collection_connection WHERE id=1').fetchone()
    if not token or not row or not secrets.compare_digest(hashlib.sha256(token.encode()).hexdigest(), row[0]):
        raise HTTPException(401, '연결 키를 확인해 주세요. 앱에서 새로 발급했다면 확장 프로그램에도 다시 입력해야 합니다.')

@router.post('/naturing')
def receive(value: CollectedObservation, request: Request):
    payload = value.model_dump(mode='json', exclude={'collected_at', 'review_status'})
    now = datetime.now(timezone.utc).isoformat()
    with connect_database() as db:
        authenticate(request, db)
        # 잠금을 얻기 전의 실패만 다시 시도합니다. 저장 본문을 반복하지 않습니다.
        db.execute('PRAGMA busy_timeout=3000')
        try:
            db.execute('BEGIN IMMEDIATE')
        except sqlite3.OperationalError as error:
            if getattr(error, 'sqlite_errorcode', 0) & 255 != sqlite3.SQLITE_BUSY:
                raise
            time.sleep(0.25)
            db.execute('BEGIN IMMEDIATE')
        authenticate(request, db)
        old = db.execute('SELECT * FROM collected_observations WHERE source=? AND source_id=?', (value.source, value.source_id)).fetchone()
        encoded = json.dumps(preserve_stage_override(old,payload),ensure_ascii=False,sort_keys=True)
        outcome = 'unchanged' if old and old['payload_json'] == encoded else 'updated' if old else 'created'
        if outcome == 'updated':
            db.execute('INSERT INTO collection_revisions(item_id,payload_json,replaced_at) VALUES(?,?,?)', (old['id'], old['payload_json'], now))
        db.execute('''INSERT INTO collected_observations(source,source_id,payload_json,first_received_at,last_received_at,collected_at)
            VALUES(?,?,?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET payload_json=excluded.payload_json,
            last_received_at=excluded.last_received_at,collected_at=excluded.collected_at''',
            (value.source, value.source_id, encoded, now, now, value.collected_at.isoformat()))
        item_id = db.execute('SELECT id FROM collected_observations WHERE source=? AND source_id=?', (value.source, value.source_id)).fetchone()[0]
    return {'id': item_id, 'outcome': outcome}

@router.get('')
def list_collected(offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100), source: Literal['naturing', 'inaturalist'] = 'naturing', sort: Literal['default','asc','desc'] = 'default'):
    with connect_database() as db:
        pending = "source=? AND review_status!='discarded' AND NOT EXISTS (SELECT 1 FROM collection_imports i WHERE i.item_id=collected_observations.id)"
        total = db.execute(f'SELECT count(*) FROM collected_observations WHERE {pending}', (source,)).fetchone()[0]
        ordering = 'CAST(source_id AS INTEGER) DESC' if source == 'inaturalist' else 'last_received_at DESC,id DESC'
        if sort != 'default':
            def observed_key(encoded):
                payload = json.loads(encoded)
                try:
                    if payload.get('source') == 'inaturalist':
                        from datetime import date, time
                        day = date.fromisoformat(payload.get('observed_date') or '')
                        clock = time.fromisoformat(payload['observed_time']) if payload.get('observed_time') else None
                    else:
                        day, clock = observed_datetime(payload.get('observed_raw', ''))
                    return day.isoformat() + 'T' + (clock.isoformat() if clock else '00:00:00')
                except (ValueError, TypeError):
                    return None
            db.create_function('collection_observed_key', 1, observed_key)
            direction = 'ASC' if sort == 'asc' else 'DESC'
            ordering = f'collection_observed_key(payload_json) IS NULL, collection_observed_key(payload_json) {direction}, id {direction}'
        rows = db.execute(f'SELECT * FROM collected_observations WHERE {pending} ORDER BY {ordering} LIMIT ? OFFSET ?', (source, limit, offset)).fetchall()
        items = []
        for row in rows:
            payload = json.loads(row['payload_json'])
            info = registration_info(db, payload)
            location = display_location(payload.get('place_raw',''),payload.get('latitude'),payload.get('longitude'))
            location['location_note'] = ' · '.join(filter(None, [location.get('location_note'), source_location_note(payload)]))
            if payload.get('source') == 'inaturalist' and payload.get('location_obscured'):
                location = dict(display_place=payload.get('place_raw',''), place_search=payload.get('place_raw',''), location_note=source_location_note(payload))
            if info['species_id']:
                species = db.execute('SELECT korean_name,scientific_name FROM species WHERE id=?', (info['species_id'],)).fetchone()
                payload = {**payload, 'korean_name':species['korean_name'], 'scientific_name':species['scientific_name'] or ''}
            imported = db.execute('SELECT observation_id,payload_json,inference_json FROM collection_imports WHERE item_id=?', (row['id'],)).fetchone()
            items.append({**payload, **location, 'id':row['id'], 'review_status':row['review_status'], 'last_received_at':row['last_received_at'],
                          'eligible':info['eligible'], 'reason':info['reason'], 'exempt':info['exempt'], 'inferred_stage':json.loads(imported['inference_json'])['stage'] if imported else info['inference']['stage'],
                          'species_id':info['species_id'], 'stage_manual':bool(info['inference'].get('manual_stage_override')), 'version':hashlib.sha256(row['payload_json'].encode()).hexdigest(),
                          'observation_id':imported['observation_id'] if imported else None,
                          'source_changed':bool(imported and imported['payload_json'] != row['payload_json'])})
        return {'total': total, 'items': items}

class CollectionSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ids: list[Annotated[int, Field(strict=True, gt=0)]] = Field(min_length=1, max_length=100)


CollectionStage = Literal['unknown', 'egg', 'larva', 'pupa', 'adult']


class StageEdit(BaseModel):
    model_config=ConfigDict(extra='forbid')
    stage: CollectionStage
    species_id: Annotated[int, Field(strict=True, gt=0)] | None = None
    expected_version: str = Field(pattern=r'^[a-f0-9]{64}$')


def stage_payload(db, item_id, expected_version, stage):
    row = db.execute('SELECT * FROM collected_observations WHERE id=?', (item_id,)).fetchone()
    if not row:
        raise HTTPException(404, '수집 자료가 없습니다.')
    if row['review_status'] == 'discarded' or db.execute('SELECT 1 FROM collection_imports WHERE item_id=?', (item_id,)).fetchone():
        raise HTTPException(409, '삭제되었거나 이미 등록한 자료입니다. 목록을 새로고침해 주세요.')
    if hashlib.sha256(row['payload_json'].encode()).hexdigest() != expected_version:
        raise HTTPException(409, '다른 창에서 수정되거나 재수집한 자료입니다. 창을 닫고 목록을 새로고침해 주세요.')
    payload = json.loads(row['payload_json'])
    payload['_stage_override'] = stage
    return payload


def write_stage_payload(db, item_id, payload):
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    db.execute('UPDATE collected_observations SET payload_json=? WHERE id=?', (encoded, item_id))
    return hashlib.sha256(encoded.encode()).hexdigest()


class StageTarget(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: Annotated[int, Field(strict=True, gt=0)]
    expected_version: str = Field(pattern=r'^[a-f0-9]{64}$')


class BatchStageEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    stage: CollectionStage
    items: list[StageTarget] = Field(min_length=1, max_length=25)


@router.put('/batch/stage')
def edit_stage_batch(value: BatchStageEdit, request: Request):
    local_screen(request)
    ids = [item.id for item in value.items]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, '중복된 수집 자료가 있습니다.')
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        for item in value.items:
            payload = stage_payload(db, item.id, item.expected_version, value.stage)
            write_stage_payload(db, item.id, payload)
    return {'ids': ids}


@router.put('/{item_id}/stage')
def edit_stage(item_id: int, value: StageEdit, request: Request):
    local_screen(request)
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        payload = stage_payload(db, item_id, value.expected_version, value.stage)
        if value.species_id is not None:
            if not db.execute('SELECT 1 FROM species WHERE id=?', (value.species_id,)).fetchone():
                raise HTTPException(422, '도감에서 종을 선택해 주세요.')
            payload['_species_override'] = value.species_id
        version = write_stage_payload(db, item_id, payload)
        return {'id': item_id, 'stage': value.stage, 'version': version}


@router.post('/register')
def register_selected(value: CollectionSelection, request: Request):
    local_screen(request)
    results = []
    registered_species = set()
    taxon_matches = {}
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        for item_id in dict.fromkeys(value.ids):
            row = db.execute('SELECT * FROM collected_observations WHERE id=?', (item_id,)).fetchone()
            if not row:
                results.append({'id':item_id, 'status':'skipped', 'reason':'수집 자료 없음'})
                continue
            if row['review_status'] == 'discarded':
                results.append({'id':item_id, 'status':'skipped', 'reason':'수집 목록에서 삭제한 자료'})
                continue
            imported = db.execute('SELECT observation_id FROM collection_imports WHERE item_id=?', (item_id,)).fetchone()
            if imported:
                results.append({'id':item_id, 'status':'already_registered', 'observation_id':imported[0]})
                continue
            payload = json.loads(row['payload_json'])
            info = registration_info(db, payload, taxon_matches)
            if not info['eligible']:
                results.append({'id':item_id, 'status':'skipped', 'reason':info['reason']})
                continue
            observation_id = import_item(db, row, info, payload)
            registered_species.add(info['species_id'])
            results.append({'id':item_id, 'status':'registered', 'observation_id':observation_id})
        from app.vagrant_years import sync_vagrant_years
        sync_vagrant_years(db, registered_species)
        from app.records import read_survey
        ids = [r['observation_id'] for r in results if r.get('observation_id')]
        surveys = []
        if ids:
            marks = ','.join('?' for _ in ids)
            for row in db.execute(f'SELECT DISTINCT survey_id FROM observations WHERE id IN ({marks})', ids):
                survey = read_survey(db, row[0])
                if survey is not None:
                    surveys.append(survey)
    return {'results':results, 'surveys':surveys}

@router.post('/discard')
def discard_selected(value: CollectionSelection, request: Request):
    """수집함에서만 숨기며 원문·연결 관찰·중복 방지 키를 보존합니다."""
    return change_visibility(value, request, 'discarded')

@router.post('/restore')
def restore_selected(value: CollectionSelection, request: Request):
    return change_visibility(value, request, 'pending')

def change_visibility(value: CollectionSelection, request: Request, status: str):
    local_screen(request)
    changed = []
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        for item_id in dict.fromkeys(value.ids):
            cursor = db.execute('UPDATE collected_observations SET review_status=? WHERE id=? AND review_status!=?', (status,item_id,status))
            if cursor.rowcount:
                changed.append(item_id)
    return {'ids':changed}
