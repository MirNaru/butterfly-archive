"""모바일 전송 인증·대기함과 로컬 PC의 검수 등록을 분리합니다."""
import hashlib
import json
import secrets
from pathlib import Path
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import Field, model_validator
from app.collection import local_screen
from app.database import connect_database, PROJECT_ROOT
from app.schemas import InputModel, SurveyInput, Survey
from app import records

local_router = APIRouter(prefix='/api/mobile')
remote_router = APIRouter(prefix='/m/api')
COOKIE = '__Host-butterfly-mobile'
# 전송 주소는 집 안 서버 설정에서만 읽습니다. 외부 조회 주소와 공유하지 않습니다.
def lan_configuration():
    import os
    target=Path(os.environ.get('BUTTERFLY_LAN_CONFIG',PROJECT_ROOT/'data/mobile-lan.json'))
    if not target.is_file():return None
    return json.loads(target.read_text(encoding='utf-8-sig'))


def lan_origin():
    config=lan_configuration()
    return config['url'] if config else ''



def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def stamp():
    return datetime.now(timezone.utc).isoformat()


class PhotoMetadata(InputModel):
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    filename: str = Field(min_length=1, max_length=255, pattern=r'^[^/\\\x00]+$')
    size_bytes: int = Field(gt=0, le=32 * 1024 * 1024, strict=True)
    format: Literal['JPEG', 'PNG']
    width: int = Field(default=0,ge=0,le=60000,strict=True)
    height: int = Field(default=0,ge=0,le=60000,strict=True)
    orientation: int = Field(default=1,ge=1,le=8,strict=True)
    camera: str = Field(default='', max_length=200)
    taken_at_raw: str = Field(default='', max_length=100)
    offset_raw: str = Field(default='', max_length=100)
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    gps_datum: str = Field(default='', max_length=100)
    warnings: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=12)

    @model_validator(mode='after')
    def coordinates(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError('위도와 경도는 함께 전송해야 합니다.')
        return self


def metadata_view(value):
    result = dict(value, date_candidate=None, time_candidate=None)
    notes = list(value.get('warnings', []))
    if value.get('taken_at_raw'):
        try:
            taken = datetime.strptime(value['taken_at_raw'], '%Y:%m:%d %H:%M:%S')
            offset = value.get('offset_raw', '')
            import re
            if re.fullmatch(r'[+-](?:0\d|1[0-4]):[0-5]\d', offset):
                minutes = int(offset[1:3]) * 60 + int(offset[4:])
                if minutes > 840:
                    raise ValueError('offset')
                taken = taken.replace(tzinfo=timezone(timedelta(minutes=minutes * (-1 if offset[0] == '-' else 1))))
                taken = taken.astimezone(timezone(timedelta(hours=9)))
            else:
                notes.append('촬영 시간대가 없습니다. 한국 시각인지 확인해 주세요.')
            result.update(date_candidate=taken.date().isoformat(), time_candidate=taken.time().replace(tzinfo=None).isoformat())
        except (ValueError, OverflowError):
            notes.append('촬영 시각 형식을 확인해 주세요.')
    if not result['date_candidate']:
        notes.append('촬영 날짜를 직접 입력해 주세요.')
    if result['latitude'] is None:
        notes.append('촬영 위치를 직접 입력해 주세요.')
    result['warnings'] = notes
    result['provenance'] = '휴대폰에서 추출한 파일 정보 · PC에서 원본 파일을 검증하지 않음'
    return result


def require_session(request, db):
    token = request.cookies.get(COOKIE, '')
    row = db.execute('SELECT * FROM mobile_sessions WHERE token_hash=? AND expires>?', (digest(token), time.time())).fetchone()
    enabled = db.execute('SELECT enabled FROM mobile_settings WHERE id=1').fetchone()
    if not row or not enabled or not enabled[0]:
        raise HTTPException(401, 'PC에서 발급한 연결 코드로 로그인해 주세요.')
    return row


def rate_limit(db, key, maximum, seconds):
    window = int(time.time()) // seconds
    db.execute('DELETE FROM mobile_limits WHERE window_end<?', (time.time(),))
    key = f'{key}:{window}:{seconds}'
    row = db.execute('SELECT count FROM mobile_limits WHERE key=?', (key,)).fetchone()
    if row and row[0] >= maximum:
        raise HTTPException(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.')
    db.execute('INSERT INTO mobile_limits(key,count,window_end) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, (window+1)*seconds))


@local_router.get('/status')
def local_status():
    with connect_database() as db:
        row = db.execute('SELECT enabled FROM mobile_settings WHERE id=1').fetchone()
        sessions = db.execute('SELECT id,label,created_at,expires FROM mobile_sessions WHERE expires>? ORDER BY id DESC', (time.time(),)).fetchall()
        return {'url': lan_origin(), 'enabled': bool(row and row[0]), 'sessions': [dict(r) for r in sessions]}


@local_router.post('/connection')
def new_connection(request: Request):
    local_screen(request)
    if not lan_origin():raise HTTPException(503,'집 안 전송 서버를 먼저 설정해 주세요.')
    code = secrets.token_hex(6).upper()
    with connect_database() as db:
        db.execute('INSERT INTO mobile_settings(id,enabled,code_hash,code_expires) VALUES(1,1,?,?) ON CONFLICT(id) DO UPDATE SET enabled=1,code_hash=excluded.code_hash,code_expires=excluded.code_expires', (digest(code), time.time()+600))
    return {'code': code, 'url': lan_origin(), 'expires_in': 600}


@local_router.post('/disable')
def disable(request: Request):
    local_screen(request)
    with connect_database() as db:
        db.execute('UPDATE mobile_settings SET enabled=0,code_hash=NULL,code_expires=0 WHERE id=1')
        db.execute('DELETE FROM mobile_sessions')
    return {'disabled': True}


class Revoke(InputModel):
    id: int = Field(gt=0)


@local_router.post('/revoke')
def revoke(value: Revoke, request: Request):
    local_screen(request)
    with connect_database() as db:
        db.execute('DELETE FROM mobile_sessions WHERE id=?', (value.id,))
    return {'revoked': value.id}


class Login(InputModel):
    code: str = Field(min_length=12, max_length=12, pattern=r'^[A-Fa-f0-9]+$')
    label: str = Field(default='내 휴대폰', min_length=1, max_length=80)


@remote_router.post('/login')
def login(value: Login, request: Request):
    # 실패 횟수도 별도 트랜잭션으로 남겨 인증 실패 시 되돌아가지 않게 합니다.
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        rate_limit(db, 'login-global', 60, 600)
        rate_limit(db, 'login:'+digest(request.client.host), 12, 600)
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT * FROM mobile_settings WHERE id=1').fetchone()
        if not row or not row['enabled'] or row['code_expires'] < time.time() or not row['code_hash'] or not secrets.compare_digest(row['code_hash'], digest(value.code.upper())):
            raise HTTPException(401, '연결 코드가 없거나 만료되었습니다. PC에서 다시 발급해 주세요.')
        token = secrets.token_urlsafe(32)
        db.execute('DELETE FROM mobile_sessions WHERE expires<?', (time.time(),))
        if db.execute('SELECT count(*) FROM mobile_sessions').fetchone()[0] >= 10:
            raise HTTPException(409, 'PC에서 사용하지 않는 기기의 연결을 해제해 주세요.')
        db.execute('INSERT INTO mobile_sessions(token_hash,label,created_at,expires) VALUES(?,?,?,?)', (digest(token),value.label,stamp(),time.time()+30*86400))
        db.execute('UPDATE mobile_settings SET code_hash=NULL,code_expires=0 WHERE id=1')
    from fastapi.responses import JSONResponse
    response = JSONResponse({'authenticated': True})
    response.set_cookie(COOKIE, token, max_age=30*86400, secure=True, httponly=True, samesite='strict', path='/')
    return response


@remote_router.get('/session')
def session(request: Request):
    with connect_database() as db:
        row = require_session(request, db)
        return {'label': row['label'], 'expires': row['expires']}


@remote_router.post('/logout')
def logout(request: Request):
    with connect_database() as db:
        db.execute('DELETE FROM mobile_sessions WHERE token_hash=?', (digest(request.cookies.get(COOKIE,'')),))
    from fastapi.responses import JSONResponse
    response = JSONResponse({'logged_out': True})
    response.delete_cookie(COOKIE, path='/', secure=True, httponly=True, samesite='strict')
    return response


@remote_router.post('/photos')
def receive_photo(value: PhotoMetadata, request: Request):
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        device = require_session(request, db)
        rate_limit(db, 'upload:'+str(device['id']), 120, 60)
        previous = db.execute('SELECT id,status FROM mobile_photos WHERE sha256=?', (value.sha256,)).fetchone()
        if previous:
            return {'id':previous['id'], 'status':'duplicate', 'existing_status':previous['status']}
        if db.execute("SELECT count(*) FROM mobile_photos WHERE status='pending'").fetchone()[0] >= 50000:
            raise HTTPException(409, 'PC에서 대기 사진을 정리한 뒤 전송해 주세요.')
        cursor = db.execute('INSERT INTO mobile_photos(sha256,payload_json,device_label,received_at,status) VALUES(?,?,?,?,?)', (value.sha256,json.dumps(metadata_view(value.model_dump()),ensure_ascii=False),device['label'],stamp(),'pending'))
        return {'id':cursor.lastrowid,'status':'received'}


@local_router.get('/photos')
def list_photos(offset: int = Query(default=0,ge=0), limit: int = Query(default=25,ge=1,le=50)):
    with connect_database() as db:
        total = db.execute("SELECT count(*) FROM mobile_photos WHERE status='pending'").fetchone()[0]
        rows = db.execute("SELECT * FROM mobile_photos WHERE status='pending' ORDER BY id DESC LIMIT ? OFFSET ?", (limit,offset)).fetchall()
        return {'total':total,'items':[{**dict(r),'metadata':json.loads(r['payload_json'])} for r in rows]}


class Selection(InputModel):
    ids: list[Annotated[int, Field(gt=0, strict=True)]] = Field(min_length=1,max_length=100)


@local_router.post('/discard')
def discard(value: Selection, request: Request):
    local_screen(request)
    with connect_database() as db:
        db.executemany("UPDATE mobile_photos SET status='discarded' WHERE id=? AND status='pending'", [(i,) for i in value.ids])
    return {'ids':value.ids}


class Registration(Selection):
    survey: SurveyInput


@local_router.post('/register', response_model=Survey)
def register(value: Registration, request: Request):
    local_screen(request)
    observations = value.survey.observations
    if observations and (len(observations) != 1 or observations[0].source_type != 'direct' or observations[0].result != 'observed' or not observations[0].species_id):
        raise HTTPException(422, '탐사만 등록하거나 직접 관찰 한 건으로 등록해 주세요.')
    ids = list(dict.fromkeys(value.ids))
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        rows = db.execute('SELECT * FROM mobile_photos WHERE id IN ('+','.join('?' for _ in ids)+')',ids).fetchall()
        if len(rows) != len(ids) or any(r['status'] != 'pending' for r in rows):
            raise HTTPException(409,'이미 등록되었거나 삭제된 사진이 있습니다. 목록을 다시 읽어 주세요.')
        if observations and not db.execute('SELECT 1 FROM species WHERE id=?',(observations[0].species_id,)).fetchone():
            raise HTTPException(422,'선택한 종이 없습니다.')
        target = observations[0] if observations else value.survey
        for row in rows:
            metadata = json.loads(row['payload_json'])
            photo = db.execute('SELECT id FROM photos WHERE sha256=?',(row['sha256'],)).fetchone()
            if photo:
                photo_id = photo[0]
            else:
                photo_id = db.execute('INSERT INTO photos(sha256,metadata_json,created_at) VALUES(?,?,?)',(row['sha256'],json.dumps(metadata,ensure_ascii=False),stamp())).lastrowid
            target.photo_ids.append(photo_id)
        target.photo_ids = list(dict.fromkeys(target.photo_ids))
        try:
            survey = records.create_survey(value.survey, db)
        except records.UnknownSpecies as exc:
            raise HTTPException(422,'선택한 종이 없습니다.') from exc
        db.executemany("UPDATE mobile_photos SET status='registered',survey_id=? WHERE id=?",[(survey['id'],i) for i in ids])
    return survey
