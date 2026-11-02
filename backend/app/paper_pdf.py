"""PDF 원본을 로컬에 보관하고 쪽별 텍스트와 논문 출처를 연결합니다."""
import hashlib
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from pypdf import PdfReader
from pypdf.errors import PyPdfError
from app.collection import local_screen
from app.database import connect_database, database_path
from app.papers import save_paper

router = APIRouter(prefix='/api/papers/pdf', tags=['papers'])
MAX_BYTES = 20 * 1024 * 1024


def import_pdf(raw: bytes, filename: str, metadata: dict | None = None):
    """동일 파일·DOI를 중복 등록하지 않습니다. 관찰 사례는 자동 생성하지 않습니다."""
    if not raw.startswith(b'%PDF-') or len(raw) > MAX_BYTES:
        raise HTTPException(422, '20MB 이하의 PDF 파일을 선택해 주세요.')
    filename = Path(filename.replace('\\', '/')).name
    if not filename.lower().endswith('.pdf'):
        raise HTTPException(422, 'PDF 파일을 선택해 주세요.')
    digest = hashlib.sha256(raw).hexdigest()
    with connect_database() as db:
        old = db.execute('SELECT id,paper_id FROM paper_files WHERE sha256=?', (digest,)).fetchone()
        if old:
            return {**dict(old), 'duplicate': True}
    try:
        reader = PdfReader(io.BytesIO(raw), strict=False)
        if reader.is_encrypted:
            raise HTTPException(422, '암호화된 PDF는 암호를 해제한 파일로 추가해 주세요.')
        if not 1 <= len(reader.pages) <= 200:
            raise HTTPException(422, 'PDF는 1~200쪽까지 추가할 수 있습니다.')
        pages, length = [], 0
        for page in reader.pages:
            value = (page.extract_text() or '').replace('\x00', '')
            length += len(value)
            if length > 500_000:
                raise HTTPException(422, '추출 텍스트가 50만 자를 초과합니다.')
            pages.append(value)
    except (PyPdfError, ValueError, KeyError, TypeError, RecursionError):
        raise HTTPException(422, 'PDF를 읽지 못했습니다. 손상 여부를 확인해 주세요.') from None
    # 참고문헌의 DOI를 논문 자체의 DOI로 잘못 연결하지 않도록 첫 쪽만 확인합니다.
    match = re.search(r'10\.\d{4,9}/[A-Za-z0-9._;()/:-]+', pages[0])
    doi = match.group(0).rstrip('.,;)').lower() if match else ''
    paper = dict(provider='pdf', source_id=digest, doi=doi, title=Path(filename).stem,
                 authors='', journal='', published='', language='unknown', abstract='',
                 url='', original={'filename': filename, 'sha256': digest}, butterfly_related=True)
    if metadata:
        paper['original']['metadata_origin'] = 'manual_pdf_review'
        paper['original']['reviewed_metadata'] = metadata
        for key in ('title', 'authors', 'journal', 'published', 'language', 'abstract', 'doi'):
            if key in metadata:
                paper[key] = metadata[key]
    if paper['doi']:
        paper['url'] = 'https://doi.org/' + paper['doi']
    stamp = datetime.now(timezone.utc).isoformat()
    directory = database_path().parent / 'papers'
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (digest + '.pdf')
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        old = db.execute('SELECT id,paper_id FROM paper_files WHERE sha256=?', (digest,)).fetchone()
        if old:
            return {**dict(old), 'duplicate': True}
        # 저장된 파일이 있는 경우에도 내용을 확인하고 손상 파일을 덮어쓰지 않습니다.
        if target.exists():
            if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                raise HTTPException(409, '보관 PDF의 내용이 다릅니다. 저장 상태를 확인해 주세요.')
        else:
            with target.open('xb') as output:
                output.write(raw)
        save_paper(db, paper, stamp)
        identity = 'doi:' + paper['doi'] if paper['doi'] else 'pdf:' + digest
        row = db.execute('SELECT id,payload_json FROM papers WHERE identity=?', (identity,)).fetchone()
        cursor = db.execute('INSERT INTO paper_files(paper_id,sha256,original_name,pages_json,created_at) VALUES(?,?,?,?,?)',
                            (row['id'], digest, filename, json.dumps(pages, ensure_ascii=False), stamp))
        fid = cursor.lastrowid
        payload = json.loads(row['payload_json'])
        if not payload['url']:
            payload['url'] = f'/api/papers/pdf/{fid}'
            db.execute('UPDATE papers SET payload_json=? WHERE id=?', (json.dumps(payload, ensure_ascii=False), row['id']))
    return {'id': fid, 'paper_id': row['id'], 'duplicate': False,
            'warning': '텍스트가 없는 스캔 PDF입니다. 원문을 직접 확인해 주세요.' if not any(p.strip() for p in pages) else ''}


@router.post('')
async def upload(request: Request, filename: str = Query(min_length=1, max_length=255)):
    local_screen(request)
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_BYTES:
            raise HTTPException(413, 'PDF 파일 크기는 20MB 이하로 제한됩니다.')
    return await run_in_threadpool(import_pdf, bytes(raw), filename)


@router.get('/{file_id}/text')
def extracted_text(file_id: int):
    with connect_database() as db:
        row = db.execute('SELECT pages_json FROM paper_files WHERE id=?', (file_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'PDF를 찾지 못했습니다.')
    return {'pages': json.loads(row[0])}


@router.get('/{file_id}')
def original(file_id: int):
    with connect_database() as db:
        row = db.execute('SELECT sha256,original_name FROM paper_files WHERE id=?', (file_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'PDF를 찾지 못했습니다.')
    target = database_path().parent / 'papers' / (row['sha256'] + '.pdf')
    if not target.is_file():
        raise HTTPException(404, '보관 PDF 파일을 찾지 못했습니다.')
    return FileResponse(target, media_type='application/pdf', filename=row['original_name'],
                        content_disposition_type='inline', headers={'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff'})
