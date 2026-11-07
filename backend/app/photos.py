"""사진을 로컬에서 검사하고 원본 보관 선택과 기록 연결을 분리합니다. 외부 호출은 없습니다."""
import asyncio
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from io import BytesIO
import json
import math
import os
from pathlib import Path
from typing import Literal
import re
import secrets
import sqlite3
import time
import warnings

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, ExifTags, UnidentifiedImageError
from pydantic import Field
from starlette.concurrency import run_in_threadpool
from app.database import connect_database, database_path
from app.schemas import InputModel

router = APIRouter(prefix='/api/photos')
MAX_BYTES = 32 * 1024 * 1024
MAX_PIXELS = 60_000_000
PREVIEW_KEY = secrets.token_bytes(32)
UPLOAD_SLOTS = asyncio.Semaphore(2)
FORMATS = {'JPEG': '.jpg', 'PNG': '.png'}


def photo_root():
    return Path(os.getenv('BUTTERFLY_PHOTO_DIR', str(database_path().parent / 'photo'))).resolve()


def inspect_image(data: bytes, filename: str):
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, '사진 한 장은 32MB 이하여야 합니다.')
    if not filename or len(filename) > 255 or any(c in filename for c in '/\\\x00'):
        raise HTTPException(422, '사진 파일명을 확인해 주세요.')
    if Path(filename).suffix.lower() not in ('.jpg', '.jpeg', '.png'):
        raise HTTPException(415, 'JPEG·PNG 확장자의 사진을 선택해 주세요.')
    notes = []
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in FORMATS or getattr(image, 'n_frames', 1) != 1:
                    raise HTTPException(415, '현재는 정지 JPEG·PNG 사진을 지원합니다. HEIC·동영상은 지원하지 않습니다.')
                if image.width * image.height > MAX_PIXELS:
                    raise HTTPException(413, '사진 해상도는 6000만 화소 이하여야 합니다.')
                result = {'filename': filename, 'size_bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                          'format': image.format, 'width': image.width, 'height': image.height,
                          'orientation': 1, 'camera': '', 'taken_at_raw': '', 'offset_raw': '',
                          'date_candidate': None, 'time_candidate': None, 'latitude': None, 'longitude': None,
                          'gps_datum': '', 'warnings': notes}
                try:
                    exif = image.getexif()
                    details = exif.get_ifd(ExifTags.IFD.Exif)
                    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
                    result.update(camera=str(exif.get(272, ''))[:200], orientation=int(exif.get(274, 1)),
                                  taken_at_raw=str(details.get(36867, ''))[:100], offset_raw=str(details.get(36881, ''))[:100])
                except (ValueError, TypeError, KeyError, OSError, SyntaxError, ZeroDivisionError):
                    details, gps = {}, {}
                    notes.append('일부 촬영 정보를 읽지 못했습니다.')
                if result['taken_at_raw']:
                    try:
                        taken = datetime.strptime(result['taken_at_raw'], '%Y:%m:%d %H:%M:%S')
                        offset = result['offset_raw']
                        if re.fullmatch(r'[+-](?:0\d|1[0-4]):[0-5]\d', offset):
                            minutes = int(offset[1:3]) * 60 + int(offset[4:6])
                            if minutes > 14 * 60:
                                raise ValueError('offset')
                            taken = taken.replace(tzinfo=timezone(timedelta(minutes=minutes * (-1 if offset[0] == '-' else 1))))
                            taken = taken.astimezone(timezone(timedelta(hours=9)))
                        else:
                            notes.append('촬영 시간대가 없거나 잘못되었습니다. 한국 시각인지 확인한 뒤 적용하세요.')
                        result.update(date_candidate=taken.date().isoformat(), time_candidate=taken.time().replace(tzinfo=None).isoformat())
                    except (ValueError, OverflowError):
                        notes.append('촬영 날짜 또는 시간대 형식이 잘못되어 입력 후보를 만들지 않았습니다.')
                if gps:
                    try:
                        def degrees(key, ref_key, positive, negative, limit):
                            parts = [float(v) for v in gps[key]]
                            if len(parts) != 3 or not all(math.isfinite(v) and v >= 0 for v in parts) or parts[1] >= 60 or parts[2] >= 60:
                                raise ValueError('gps')
                            value = parts[0] + parts[1] / 60 + parts[2] / 3600
                            ref = gps[ref_key]
                            if value > limit or ref not in (positive, negative):
                                raise ValueError('gps')
                            return value if ref == positive else -value
                        datum = str(gps.get(18, ''))[:100]
                        result['gps_datum'] = datum
                        if datum and re.sub(r'[\s-]', '', datum.upper()) not in ('WGS84', 'WGS1984'):
                            raise ValueError('datum')
                        result.update(latitude=degrees(2, 1, 'N', 'S', 90), longitude=degrees(4, 3, 'E', 'W', 180))
                    except (ValueError, TypeError, KeyError, ZeroDivisionError, OverflowError):
                        notes.append('GPS 값 또는 좌표계를 확인할 수 없어 위치 후보를 만들지 않았습니다.')
                # PNG는 EXIF를 읽는 과정에서 파일 위치가 달라지므로 별도 연결로 검사합니다.
                with Image.open(BytesIO(data)) as check:
                    check.verify()
                return result
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(422, '지원하는 사진인지 또는 파일이 손상되었는지 확인해 주세요.') from exc


def preview_ticket(metadata):
    payload = json.dumps({'expires': int(time.time()) + 86400, 'metadata': metadata}, ensure_ascii=False).encode()
    return base64.urlsafe_b64encode(payload).decode() + '.' + hmac.new(PREVIEW_KEY, payload, hashlib.sha256).hexdigest()


def verified_ticket(ticket):
    try:
        encoded, signature = ticket.split('.')
        payload = base64.b64decode(encoded, altchars=b'-_', validate=True)
        if not hmac.compare_digest(signature, hmac.new(PREVIEW_KEY, payload, hashlib.sha256).hexdigest()):
            raise ValueError('signature')
        value = json.loads(payload)
        if value['expires'] < time.time():
            raise ValueError('expired')
        return value['metadata']
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, '사진 정보의 유효 시간이 지났거나 서버가 재시작되었습니다. 사진 정보를 다시 읽어 주세요.') from exc


def public_photo(row):
    return {'id': row['id'], **json.loads(row['metadata_json']), 'original_stored': bool(row['original_path']),
            'thumbnail_url': f"/api/photos/{row['id']}/thumbnail" if row['thumbnail_path'] else None}


def make_thumbnail(data):
    try:
        with Image.open(BytesIO(data)) as image:
            image.draft('RGB', (640, 640))
            image.load()
            with ImageOps.exif_transpose(image) as upright:
                upright.thumbnail((640, 640))
                # 새 이미지로 만들어 GPS·기기 정보가 미리보기에 복사되지 않게 합니다.
                clean = Image.new('RGB', upright.size, 'white')
                if 'A' in upright.getbands():
                    clean.paste(upright, mask=upright.getchannel('A'))
                else:
                    clean.paste(upright.convert('RGB'))
                output = BytesIO()
                clean.save(output, format='JPEG', quality=80)
                clean.close()
                return output.getvalue()
    except (OSError, ValueError, SyntaxError) as exc:
        raise HTTPException(422, '사진을 끝까지 읽지 못했습니다. 원본을 확인해 주세요.') from exc


def store_photo(metadata, data=None):
    created = []
    try:
        with connect_database() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM photos WHERE sha256=?', (metadata['sha256'],)).fetchone()
            if row and (data is None or row['original_path']):
                return public_photo(row)
            original = thumbnail = None
            if data is not None:
                thumb_data = make_thumbnail(data)
                root = photo_root()
                original = f"originals/{metadata['sha256']}{FORMATS[metadata['format']]}"
                thumbnail = f"thumbnails/{metadata['sha256']}.jpg"
                for relative, content in ((original, data), (thumbnail, thumb_data)):
                    target = (root / relative).resolve()
                    if not target.is_relative_to(root):
                        raise OSError('invalid storage path')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if target.exists():
                        if target.read_bytes() != content:
                            raise OSError('existing file conflict')
                    else:
                        # 생성 중 실패한 미완성 복사본만 정리하며 사용자 원본은 건드리지 않습니다.
                        with target.open('xb') as handle:
                            created.append(target)
                            handle.write(content)
            if row:
                db.execute('UPDATE photos SET original_path=?,thumbnail_path=? WHERE id=?', (original, thumbnail, row['id']))
                photo_id = row['id']
            else:
                photo_id = db.execute('INSERT INTO photos(sha256,metadata_json,original_path,thumbnail_path,created_at) VALUES(?,?,?,?,?)',
                                     (metadata['sha256'], json.dumps(metadata, ensure_ascii=False), original, thumbnail, datetime.now(timezone.utc).isoformat())).lastrowid
            result = public_photo(db.execute('SELECT * FROM photos WHERE id=?', (photo_id,)).fetchone())
        return result
    except (OSError, sqlite3.Error) as exc:
        for target in created:
            target.unlink(missing_ok=True)
        raise HTTPException(503, '사진 저장 실패. 저장 공간과 폴더 권한을 확인한 뒤 재시도해 주세요.') from exc


async def read_image(request):
    chunks = bytearray()
    async for chunk in request.stream():
        if len(chunks) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, '사진 한 장은 32MB 이하여야 합니다.')
        chunks.extend(chunk)
    return bytes(chunks)


@router.post('/inspect')
async def inspect_photo(request: Request, filename: str = Query(min_length=1, max_length=255)):
    async with UPLOAD_SLOTS:
        data = await read_image(request)
        metadata = await run_in_threadpool(inspect_image, data, filename)
        return {'metadata': metadata, 'ticket': preview_ticket(metadata)}


class MetadataRegistration(InputModel):
    ticket: str = Field(min_length=1, max_length=20000)


@router.post('/metadata')
def register_metadata(value: MetadataRegistration):
    return store_photo(verified_ticket(value.ticket))


@router.post('/original')
async def register_original(request: Request, filename: str = Query(min_length=1, max_length=255)):
    async with UPLOAD_SLOTS:
        data = await read_image(request)
        metadata = await run_in_threadpool(inspect_image, data, filename)
        return await run_in_threadpool(store_photo, metadata, data)


class PhotoLookup(InputModel):
    ids: list[int] = Field(max_length=24)


@router.get('/library')
def library(offset: int = Query(default=0, ge=0), limit: int = Query(default=12, ge=1, le=24)):
    with connect_database() as db:
        total = db.execute('SELECT COUNT(*) FROM photos').fetchone()[0]
        return {'total': total, 'items': [public_photo(row) for row in db.execute('SELECT * FROM photos ORDER BY id DESC LIMIT ? OFFSET ?', (limit, offset))]}


@router.post('/lookup')
def lookup(value: PhotoLookup):
    with connect_database() as db:
        return [public_photo(row) for key in dict.fromkeys(value.ids) if (row := db.execute('SELECT * FROM photos WHERE id=?', (key,)).fetchone())]


@router.get('/{photo_id}/{kind}')
def image_file(photo_id: int, kind: str, size: Literal['full','small'] = 'full'):
    if kind not in ('thumbnail', 'original', 'display'):
        raise HTTPException(404, '사진 파일이 없습니다.')
    with connect_database() as db:
        row = db.execute('SELECT * FROM photos WHERE id=?', (photo_id,)).fetchone()
    column = 'original_path' if kind == 'display' else f'{kind}_path'
    if not row or not row[column]:
        raise HTTPException(404, '보관된 사진 파일이 없습니다. 정보만 등록한 사진은 원본을 다시 선택해 주세요.')
    target = (photo_root() / row[column]).resolve()
    if not target.is_relative_to(photo_root()) or not target.is_file():
        raise HTTPException(404, '사진 파일을 찾을 수 없습니다. 보관 폴더를 확인해 주세요.')
    if kind == 'display':
        display = photo_root() / 'display' / f"{row['sha256']}{'-small' if size == 'small' else ''}.webp"
        if not display.exists():
            temporary = display.with_name(display.name + '.' + secrets.token_hex(8) + '.tmp')
            try:
                display.parent.mkdir(parents=True, exist_ok=True)
                with Image.open(target) as source, ImageOps.exif_transpose(source) as upright:
                    upright.thumbnail((320,320) if size == 'small' else (1920,1920))
                    clean = Image.new('RGB', upright.size, 'white')
                    try:
                        clean.paste(upright, mask=upright.getchannel('A')) if 'A' in upright.getbands() else clean.paste(upright.convert('RGB'))
                        clean.save(temporary, format='WEBP', quality=90)
                    finally:
                        clean.close()
                os.replace(temporary, display)
            except (OSError, ValueError) as exc:
                temporary.unlink(missing_ok=True)
                raise HTTPException(503, '표시용 WebP 사진을 만들지 못했습니다.') from exc
        return FileResponse(display,media_type='image/webp',headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
    metadata = json.loads(row['metadata_json'])
    return FileResponse(target, media_type='image/jpeg' if kind == 'thumbnail' or metadata['format'] == 'JPEG' else 'image/png',
                        filename=metadata['filename'] if kind == 'original' else None,
                        headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})


def linked_ids(db, kind, target_id):
    column = 'survey_id' if kind == 'survey' else 'observation_id'
    return [row[0] for row in db.execute(f'SELECT photo_id FROM photo_links WHERE {column}=? ORDER BY photo_id', (target_id,))]


def save_photo_links(db, kind, target_id, ids):
    if kind == 'survey' and len(set(ids)) > 3:
        existing = set(linked_ids(db,kind,target_id))
        if not set(ids).issubset(existing):
            raise HTTPException(422, '탐사 사진은 최대 3장까지 연결할 수 있습니다. 기존 사진은 보존됩니다.')
    column = 'survey_id' if kind == 'survey' else 'observation_id'
    for key in ids:
        if not db.execute('SELECT 1 FROM photos WHERE id=?', (key,)).fetchone():
            raise HTTPException(422, '선택한 사진 정보가 없습니다. 사진 목록을 다시 확인해 주세요.')
    db.execute(f'DELETE FROM photo_links WHERE {column}=?', (target_id,))
    db.executemany(f'INSERT INTO photo_links(photo_id,{column}) VALUES(?,?)', [(key, target_id) for key in ids])
