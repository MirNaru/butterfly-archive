"""공식 논문 서지 검색·중복 보존과 근거가 있는 간접 관찰 등록을 처리합니다."""
import hashlib
import calendar
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone
from typing import Literal
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import Field
from app.api_usage import now_kst
from app.collection import local_screen
from app.database import connect_database
from app.integration_settings import IntegrationError, NoRedirect
from app.records import create_survey, UnknownSpecies
from app.schemas import InputModel, SurveyInput
from app.trash import ACTIVE_OBSERVATION

router = APIRouter(prefix='/api/papers', tags=['papers'])
ENDPOINTS = {'crossref': 'https://api.crossref.org/works', 'kci': 'https://open.kci.go.kr/po/openapi/openApiSearch.kci'}
TOPICS = {'latest': (), 'new_record': ('미기록', 'first record', 'unrecorded', 'new record'),
          'rearing': ('사육', '기주', '월동', '휴면', '발육', '번식', 'rearing', 'host plant', 'overwinter', 'diapause', 'development', 'breeding', 'survival')}
request_lock = threading.Lock()
last_request = 0.0


def text(value):
    return re.sub(r'<[^>]*>', '', str(value or '')).strip()


def safe_url(value):
    parsed = urllib.parse.urlparse(str(value or ''))
    return str(value) if parsed.scheme in ('http', 'https') and parsed.hostname and not parsed.username else ''


def fetch(provider, params):
    global last_request
    with request_lock:
        delay = 1.05 - (time.monotonic() - last_request)
        if delay > 0:
            time.sleep(delay)
        day = now_kst().date().isoformat()
        with connect_database() as db:
            db.execute('BEGIN IMMEDIATE')
            count = db.execute('SELECT attempts FROM api_usage WHERE service=? AND day=?', ('papers_' + provider, day)).fetchone()
            if count and count[0] >= 1000:
                raise IntegrationError('논문 API의 앱 일일 호출 한도에 도달했습니다.', 429)
            db.execute('INSERT INTO api_usage VALUES(?,?,1) ON CONFLICT(service,day) DO UPDATE SET attempts=attempts+1', ('papers_' + provider, day))
        last_request = time.monotonic()
        req = urllib.request.Request(ENDPOINTS[provider] + '?' + urllib.parse.urlencode(params), headers={'User-Agent': 'ButterflyArchive/0.3 (personal literature search)'})
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
                raw = response.read(4_000_001)
            if len(raw) > 4_000_000:
                raise IntegrationError('논문 API 응답 크기 제한을 초과했습니다.')
            return raw
        except urllib.error.HTTPError as error:
            raise IntegrationError('논문 제공자의 호출 제한으로 중단했습니다.' if error.code == 429 else '논문 API 요청에 실패했습니다. 기존 목록은 유지됩니다.', 429 if error.code == 429 else 502) from None
        except (OSError, TimeoutError):
            raise IntegrationError('논문 API에 연결하지 못했습니다. 기존 목록은 유지됩니다.', 503) from None


class PaperSearch(InputModel):
    provider: Literal['all', 'crossref', 'kci'] = 'crossref'
    topic: Literal['latest', 'new_record', 'rearing'] = 'latest'
    query: str = Field(default='', max_length=200)
    species_id: int | None = Field(default=None, gt=0, strict=True)
    start: date | None = None
    end: date | None = None
    page: int = Field(default=1, ge=1, le=100, strict=True)


def crossref_rows(raw):
    data = json.loads(raw)
    rows = data['message']['items']
    if not isinstance(rows, list):
        raise ValueError()
    result = []
    for row in rows:
        doi = str(row.get('DOI') or '').strip().lower()
        if not doi:
            continue
        published = (row.get('published') or row.get('published-print') or row.get('published-online') or {}).get('date-parts', [[]])[0]
        parts = [str(n).zfill(4 if i == 0 else 2) for i, n in enumerate(published[:3])]
        result.append(dict(provider='crossref', source_id=doi, doi=doi, title=text((row.get('title') or [''])[0]),
                           authors=', '.join(text(' '.join(filter(None, [a.get('given'), a.get('family')]))) for a in row.get('author', [])),
                           journal=text((row.get('container-title') or [''])[0]), published='-'.join(parts),
                           language=row.get('language') or 'unknown', abstract=text(row.get('abstract')),
                           url='https://doi.org/' + urllib.parse.quote(doi, safe='/'), original=row))
    return result


def kci_rows(raw):
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError()
    root = ET.fromstring(raw)
    records = root.findall('.//record')
    if not records and root.find('.//total') is None:
        raise IntegrationError('KCI 응답을 확인하지 못했습니다. 인증키의 승인·사용기간과 검색 조건을 확인해 주세요.', 503)
    result = []
    for row in records:
        info = row.find('articleInfo')
        if info is None:
            continue
        key = info.get('article-id')
        if not key:
            continue
        def get(path):
            return text(''.join(row.find(path).itertext())) if row.find(path) is not None else ''
        titles = info.findall('.//article-title')
        title = next((text(''.join(t.itertext())) for t in titles if t.get('lang') == 'original'), text(''.join(titles[0].itertext())) if titles else '')
        doi = get('articleInfo/doi').lower().removeprefix('https://doi.org/').removeprefix('http://doi.org/')
        year, month = get('journalInfo/pub-year'), get('journalInfo/pub-mon')
        result.append(dict(provider='kci', source_id=key, doi=doi, title=title,
                           authors=', '.join(text(''.join(a.itertext())) for a in info.findall('.//author')),
                           journal=get('journalInfo/journal-name'), published=year + ('-' + month.zfill(2) if month else ''),
                           language=get('articleInfo/article-language') or 'unknown',
                           abstract='\n'.join(text(''.join(a.itertext())) for a in info.findall('.//abstract')),
                           url=safe_url(get('articleInfo/url')) or f'https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId={key}',
                           original=ET.tostring(row, encoding='unicode')))
    return result


def save_paper(db, paper, stamp):
    identity = 'doi:' + paper['doi'] if paper['doi'] else paper['provider'] + ':' + paper['source_id']
    old = db.execute('SELECT * FROM papers WHERE identity=?', (identity,)).fetchone()
    if old:
        previous = json.loads(old['payload_json'])
        sources = previous.get('sources') or [{k: previous[k] for k in ('provider', 'source_id', 'original')}]
        current = {k: paper[k] for k in ('provider', 'source_id', 'original')}
        if current not in sources:
            sources.append(current)
        # 이미 받은 원문도 보존하며 비어 있는 필드만 새 제공자로 보완합니다.
        merged = {**previous, **{k: v for k, v in paper.items() if not previous.get(k) and v}, 'sources': sources}
        db.execute('UPDATE papers SET payload_json=? WHERE id=?', (json.dumps(merged, ensure_ascii=False), old['id']))
        return False
    paper['sources'] = [{k: paper[k] for k in ('provider', 'source_id', 'original')}]
    db.execute('INSERT INTO papers(identity,payload_json,received_at) VALUES(?,?,?)', (identity, json.dumps(paper, ensure_ascii=False), stamp))
    return True


def relevant(paper, topic, species):
    body = (paper['title'] + ' ' + paper['abstract']).lower()
    butterfly = paper.get('butterfly_related', False) or any(term in body for term in ('나비', 'butterfl', 'papilionoid')) or bool(species and ((species['scientific_name'] or '').lower() in body if species['scientific_name'] else species['korean_name'] in body))
    if not butterfly:
        return False
    technical = ('optimization', 'optimisation', 'algorithm', 'auxetic', 'sandwich panel', 'heat exchanger', 'valve', 'robot', 'antenna', 'encryption', 'neural network', 'butterfly effect', 'butterfly network', 'butterfly-coil', 'butterfly coil', 'emat', 'shear wave', 'electromagnetic', 'circuit')
    biological = ('lepidoptera', 'larva', 'host plant', 'species', 'rearing', 'diapause', 'overwinter', 'phylogen', 'taxonom', 'biodiversity', 'conservation', 'insect', '애벌레', '기주', '나비목', '사육', '서식', '보전', '미기록', '번식')
    if any(t in paper['title'].lower() for t in technical) and not any(t in body for t in biological):
        return False
    if topic == 'new_record':
        return any(t in body for t in TOPICS[topic]) and any(t in body for t in ('korea', '한국', '한반도', '국내'))
    return topic == 'latest' or any(t in body for t in TOPICS[topic])


@router.get('/status')
def status():
    return {'kci_ready': bool(os.getenv('KCI_API_KEY', '').strip())}


@router.post('/refresh')
def refresh(value: PaperSearch, request: Request):
    local_screen(request)
    if value.start and value.end and value.start > value.end:
        raise HTTPException(422, '시작일은 종료일 이전이어야 합니다.')
    with connect_database() as db:
        species = db.execute('SELECT * FROM species WHERE id=?', (value.species_id,)).fetchone() if value.species_id else None
    if value.species_id and not species:
        raise HTTPException(422, '선택한 종을 찾지 못했습니다.')
    warnings, counts = [], {'received': 0, 'created': 0, 'duplicate': 0, 'excluded': 0}
    for provider in (('crossref', 'kci') if value.provider == 'all' else (value.provider,)):
        if provider == 'kci' and not os.getenv('KCI_API_KEY', '').strip():
            warnings.append('KCI 인증키가 없어 KCI 조회를 생략했습니다. .env의 KCI_API_KEY를 설정해 주세요.')
            continue
        try:
            if provider == 'crossref':
                phrase = species['scientific_name'] if species and species['scientific_name'] else 'butterfly'
                phrase += ' ' + value.query
                if value.topic == 'new_record':
                    phrase += ' Korea first record'
                elif value.topic == 'rearing':
                    phrase += ' rearing host plant diapause'
                filters = ['type:journal-article']
                if value.start:
                    filters.append('from-pub-date:' + value.start.isoformat())
                if value.end:
                    filters.append('until-pub-date:' + value.end.isoformat())
                rows = crossref_rows(fetch(provider, {'query': phrase.strip(), 'sort': 'published', 'order': 'desc', 'rows': 50, 'offset': (value.page - 1) * 50, 'filter': ','.join(filters)}))
            else:
                params = {'apiCode': 'articleSearch', 'key': os.environ['KCI_API_KEY'].strip(), 'title': species['korean_name'] if species else '나비', 'page': value.page, 'displayCount': 50, 'sortNm': 'pubiYr'}
                if value.query:
                    params['keyword'] = value.query
                if value.start:
                    params['dateFrom'] = value.start.strftime('%Y%m')
                if value.end:
                    params['dateTo'] = value.end.strftime('%Y%m')
                rows = kci_rows(fetch(provider, params))
            with connect_database() as db:
                db.execute('BEGIN IMMEDIATE')
                for paper in rows:
                    counts['received'] += 1
                    if not relevant(paper, value.topic, species):
                        counts['excluded'] += 1
                        continue
                    paper['butterfly_related'] = True
                    counts['created' if save_paper(db, paper, datetime.now(timezone.utc).isoformat()) else 'duplicate'] += 1
        except (IntegrationError, ValueError, KeyError, TypeError, ET.ParseError):
            warnings.append(f'{provider} 조회에 실패했습니다. 기존 자료는 유지합니다. 인증 설정·호출 제한·응답 상태를 확인해 주세요.')
    return {**counts, 'warnings': warnings}


@router.get('')
def list_papers(offset: int = Query(0, ge=0), query: str = Query('', max_length=200), topic: Literal['latest', 'new_record', 'rearing'] = 'latest', language: Literal['preferred', 'all', 'ko', 'en'] = 'preferred', species_id: int | None = Query(None, gt=0), start: date | None = None, end: date | None = None, provider: Literal['all', 'crossref', 'kci', 'pdf'] = 'all', favorite: bool = False, tag: str = Query('', max_length=60)):
    with connect_database() as db:
        species = db.execute('SELECT * FROM species WHERE id=?', (species_id,)).fetchone() if species_id else None
        if species_id and not species:
            raise HTTPException(422, '선택한 종을 찾지 못했습니다.')
        if start and end and start > end:
            raise HTTPException(422, '시작일은 종료일 이전이어야 합니다.')
        items = []
        for row in db.execute('SELECT p.*,o.favorite,o.tags_json FROM papers p LEFT JOIN paper_organization o ON p.id=o.paper_id'):
            tags = json.loads(row['tags_json']) if row['tags_json'] else []
            if favorite and not row['favorite'] or tag.strip() and not any(tag.strip().casefold() in t.casefold() for t in tags):
                continue
            payload = json.loads(row['payload_json'])
            lang = payload.get('language', 'unknown').lower()
            lang = 'ko' if lang in ('kor', 'korean', '한국어') else 'en' if lang in ('eng', 'english', '영어') else lang
            if language == 'preferred' and lang not in ('ko', 'en', 'unknown') or language in ('ko', 'en') and lang != language:
                continue
            body = (payload['title'] + ' ' + payload['abstract'] + ' ' + payload['authors']).lower()
            providers = list(dict.fromkeys(s['provider'] for s in payload.get('sources', [payload])))
            if provider != 'all' and provider not in providers:
                continue
            if species and not any(n and n.lower() in body for n in (species['korean_name'], species['scientific_name'])):
                continue
            if start or end:
                try:
                    parts = [int(p) for p in payload['published'].split('-')]
                    first = date(parts[0], parts[1] if len(parts) > 1 else 1, parts[2] if len(parts) > 2 else 1)
                    month = parts[1] if len(parts) > 1 else 12
                    last = date(parts[0], month, parts[2] if len(parts) > 2 else calendar.monthrange(parts[0], month)[1])
                    if start and last < start or end and first > end:
                        continue
                except (ValueError, TypeError, IndexError):
                    continue
            if query.lower() not in body or not relevant(payload, topic, None):
                continue
            links = [dict(r) for r in db.execute(f'SELECT o.id,o.survey_id,l.evidence FROM paper_observations l JOIN observations o ON o.id=l.observation_id WHERE l.paper_id=? AND {ACTIVE_OBSERVATION}', (row['id'],))]
            files = [dict(r) for r in db.execute('SELECT id,original_name FROM paper_files WHERE paper_id=? ORDER BY id', (row['id'],))]
            items.append({k: v for k, v in payload.items() if k not in ('original', 'sources')} | {'id': row['id'], 'language': lang, 'providers': providers, 'received_at': row['received_at'], 'observations': links, 'files': files, 'favorite': bool(row['favorite']), 'tags': tags})
    items.sort(key=lambda p: (p['published'], p['id']), reverse=True)
    return {'total': len(items), 'items': items[offset:offset + 25]}


class PaperObservation(InputModel):
    evidence: str = Field(min_length=1, max_length=1000)
    survey: SurveyInput


@router.post('/{paper_id}/observations')
def register_observation(paper_id: int, value: PaperObservation, request: Request):
    local_screen(request)
    evidence = value.evidence.strip()
    if not evidence or not value.survey.observations:
        raise HTTPException(422, '근거 페이지·표·그림 번호와 관찰 사례를 입력해 주세요.')
    if any(o.source_type != 'indirect' or not o.species_id for o in value.survey.observations):
        raise HTTPException(422, '논문 관찰은 종을 선택한 간접 관찰로 등록해 주세요.')
    case_key = hashlib.sha256((evidence + value.survey.model_dump_json()).encode()).hexdigest()
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT * FROM papers WHERE id=?', (paper_id,)).fetchone()
        if not row:
            raise HTTPException(404, '논문을 찾지 못했습니다.')
        if db.execute('SELECT 1 FROM paper_observations WHERE paper_id=? AND case_key=?', (paper_id, case_key)).fetchone():
            raise HTTPException(409, '같은 내용과 근거의 사례가 이미 등록되어 있습니다. 기존 기록과 휴지통을 확인해 주세요.')
        paper = json.loads(row['payload_json'])
        source_note = f"{paper['url']}\n{paper['title'][:500]}\n근거: {evidence}"
        if len(source_note) > 2000:
            raise HTTPException(422, '출처와 근거 설명이 너무 깁니다. 근거 설명을 줄여 주세요.')
        survey = value.survey.model_copy(update={'observations': [o.model_copy(update={'source_type': 'indirect', 'source_note': source_note}) for o in value.survey.observations]})
        try:
            saved = create_survey(survey, db)
        except UnknownSpecies as error:
            raise HTTPException(422, str(error)) from None
        for observation in saved['observations']:
            db.execute('INSERT INTO paper_observations VALUES(?,?,?,?,?,?)', (paper_id, observation['id'], evidence, row['payload_json'], case_key, datetime.now(timezone.utc).isoformat()))
        return saved
