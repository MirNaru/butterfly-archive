"""종 참고자료를 보존하고 성충 출현 기간과 탐사 조건을 계산합니다. 외부 호출은 없습니다."""
import calendar
import json
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal, Self
from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator
from app.database import connect_database
from app.schemas import InputModel
from app import regions as administrative_regions

router = APIRouter(prefix='/api')
Slot = Annotated[int, Field(strict=True, ge=1, le=36)]
Year = Annotated[int, Field(strict=True, ge=1800, le=9999)]


class Period(InputModel):
    start: Slot
    end: Slot


class LifePeriod(Period):
    start_day: Annotated[int, Field(strict=True, ge=1, le=366)] | None = None
    end_day: Annotated[int, Field(strict=True, ge=1, le=366)] | None = None
    id: str = Field(min_length=1, max_length=100)
    stage: Literal['egg', 'larva', 'pupa', 'adult']
    source: str = Field(min_length=1, max_length=1000)
    edition: str = Field(default='', max_length=200)
    region: str = Field(default='', max_length=200)
    notes: str = Field(default='', max_length=2000)
    enabled: bool = Field(default=True, strict=True)

    @model_validator(mode='after')
    def exact_pair(self) -> Self:
        if (self.start_day is None) != (self.end_day is None):
            raise ValueError('일 단위 시작과 끝을 함께 입력해 주세요.')
        return self


class Protection(InputModel):
    kind: Literal['endangered_i', 'endangered_ii', 'monument', 'regional']
    region: str = Field(default='', max_length=100)
    designation: str = Field(default='', max_length=100)
    source: str = Field(min_length=1, max_length=2000)
    checked: date

    @model_validator(mode='after')
    def region_scope(self) -> Self:
        if (self.kind == 'regional') != bool(self.region):
            raise ValueError('지역보호에는 지역을 입력하고 국가보호에는 지역을 비워 주세요.')
        return self


class Reference(InputModel):
    region_codes: list[str] = Field(default_factory=list, max_length=500)
    region_search: str = Field(default='', max_length=50000)
    region_unmatched: list[str] = Field(default_factory=list, max_length=1000)
    region_evidence: list['RegionEvidence'] = Field(default_factory=list, max_length=10000)
    domestic_extinct: bool | None = None
    extinction_source: str = Field(default='', max_length=2000)
    protections: list[Protection] = Field(default_factory=list, max_length=100)
    status_notes: str = Field(default='', max_length=5000)
    protection_review: str = Field(default='', max_length=2000)
    identification_points: str = Field(default='', max_length=5000)
    identification_source: str = Field(default='', max_length=2000)
    lifecycle: list[LifePeriod] = Field(default_factory=list, max_length=100)
    habitat: str = Field(default='', max_length=5000)
    habits: str = Field(default='', max_length=5000)
    other_notes: str = Field(default='', max_length=5000)
    ecology_source: str = Field(default='', max_length=2000)
    family: str = Field(default='', max_length=100)
    subfamily: str = Field(default='', max_length=100)
    display_order: Annotated[int, Field(strict=True, ge=1, le=1_000_000)] | None = None
    taxonomy_source: str = Field(default='', max_length=2000)
    host_plants: str = Field(default='', max_length=5000)
    host_plants_source: str = Field(default='', max_length=2000)
    periods: list[Period] = Field(default_factory=list, max_length=36)
    regions: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(default_factory=list, max_length=500)
    north_only: bool | None = None
    vagrant: bool | None = None
    sighting_years: list[Year] = Field(default_factory=list, max_length=200)
    sighting_source: str = Field(default='', max_length=2400)
    protected: bool | None = None
    capture_history: Literal['unknown', 'captured', 'not_captured'] = 'unknown'
    source: str = Field(default='', max_length=2000)
    capture_source: str = Field(default='', max_length=1000)
    protection_source: str = Field(default='', max_length=1000)
    protection_checked: date | None = None
    # 사용자가 확인한 특정 지역·기간의 판단이며 자동 법적 판정이 아닙니다.
    permission: Literal['unknown', 'permitted', 'prohibited'] = 'unknown'
    permission_region: str = Field(default='', max_length=100)
    permission_start: date | None = None
    permission_end: date | None = None
    permission_source: str = Field(default='', max_length=1000)

    @model_validator(mode='after')
    def evidence(self) -> Self:
        if self.sighting_years:
            self.sighting_years = [max(self.sighting_years)]
        if self.domestic_extinct is not None and not self.extinction_source:
            raise ValueError('국내 절멸 분류의 출처를 입력해 주세요.')
        if len({(p.kind, p.region, p.designation) for p in self.protections}) != len(self.protections):
            raise ValueError('같은 보호 지정이 중복되었습니다.')
        national = [p for p in self.protections if p.kind != 'regional']
        if national:
            self.protected = True
            self.protection_source = '\n'.join(dict.fromkeys(p.source for p in national))[:1000]
            self.protection_checked = max(p.checked for p in national)
        if self.identification_points and not self.identification_source:
            raise ValueError('동정 포인트의 출처를 입력해 주세요.')
        if len({p.id for p in self.lifecycle}) != len(self.lifecycle):
            raise ValueError('한살이 기간 항목의 ID가 중복되었습니다.')
        if (self.habitat or self.habits or self.other_notes) and not self.ecology_source:
            raise ValueError('서식지·습성·기타 자료의 출처를 입력해 주세요.')
        if (self.family or self.subfamily or self.display_order is not None) and not self.taxonomy_source:
            raise ValueError('분류·표시 순서의 출처를 입력해 주세요.')
        if self.host_plants and not self.host_plants_source:
            raise ValueError('기주식물 자료의 출처를 입력해 주세요.')
        if (self.periods or (self.regions and not (self.region_codes or self.region_evidence)) or self.vagrant is not None or self.north_only is not None or self.sighting_years) and not self.source:
            raise ValueError('출현·분포·목격 자료의 출처를 입력해 주세요.')
        if self.capture_history != 'unknown' and not self.capture_source:
            raise ValueError('과거 채집 여부의 확인 근거를 입력해 주세요.')
        if self.protected is not None and (not self.protection_source or not self.protection_checked):
            raise ValueError('보호종 정보의 출처와 확인일을 입력해 주세요.')
        if self.permission != 'unknown' and (not self.permission_region or not self.permission_start or not self.permission_end or not self.permission_source):
            raise ValueError('채집 판단의 지역·적용 시작일·종료일·근거를 입력해 주세요.')
        if self.permission_start and self.permission_end and self.permission_start > self.permission_end:
            raise ValueError('적용 종료일은 시작일 이후여야 합니다.')
        return self


class ReferenceUpdate(Reference):
    expected_updated_at: str | None = Field(default=None, max_length=100)


class RegionEvidence(InputModel):
    code: str = Field(min_length=2, max_length=20)
    origin: Literal['excel', 'manual', 'observation']
    detail: str = Field(max_length=2400)


Reference.model_rebuild()
ReferenceUpdate.model_rebuild()


def normalized_reference(payload):
    return Reference.model_validate({k: v for k, v in payload.items() if k not in ('_lifecycle_history', '_vagrant_year_managed', '_region_exclusions')}).model_dump(mode='json')


def life_snapshot(reference, timestamp):
    return {'at': timestamp, 'lifecycle': reference['lifecycle'], 'adult_periods': reference['periods'], 'adult_source': reference['source']}


@router.get('/species/catalog')
def catalog():
    with connect_database() as db:
        result = []
        observed_regions = administrative_regions.observation_regions(db)
        for row in db.execute("SELECT s.id,s.korean_name,s.scientific_name,r.payload_json FROM species s LEFT JOIN species_references r ON r.species_id=s.id ORDER BY json_extract(r.payload_json,'$.display_order') IS NULL,json_extract(r.payload_json,'$.display_order'),s.id"):
            raw = json.loads(row['payload_json']) if row['payload_json'] else {}
            ref = administrative_regions.for_species(db,row['id'],normalized_reference(raw),observed_regions,raw)
            result.append({'id': row['id'], 'korean_name': row['korean_name'], 'scientific_name': row['scientific_name'], 'host_plants': ref['host_plants'], 'reference': ref})
        return result


def reference_row(connection, species_id):
    if not connection.execute('SELECT 1 FROM species WHERE id=?', (species_id,)).fetchone():
        raise HTTPException(404, '종을 찾을 수 없습니다.')
    row = connection.execute('SELECT * FROM species_references WHERE species_id=?', (species_id,)).fetchone()
    raw = json.loads(row['payload_json']) if row else {}
    return {'reference': administrative_regions.for_species(connection,species_id,normalized_reference(raw),raw=raw), 'lifecycle_history': raw.get('_lifecycle_history', []),
            'updated_at': row['updated_at'] if row else None}


@router.get('/species/{species_id}/reference')
def get_reference(species_id: int):
    with connect_database() as db:
        return reference_row(db, species_id)


@router.put('/species/{species_id}/reference')
def save_reference(species_id: int, value: ReferenceUpdate):
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        old = reference_row(db, species_id)
        if old['updated_at'] != value.expected_updated_at:
            raise HTTPException(409, '다른 창에서 참고자료를 수정했습니다. 입력을 보관한 뒤 다시 열어 주세요.')
        payload = value.model_dump(mode='json', exclude={'expected_updated_at'})
        # 기존 화면이 새 항목을 생략해도 상태 자료와 원문은 보존합니다.
        for key in ('protections', 'status_notes', 'protection_review', 'domestic_extinct', 'extinction_source'):
            if key not in value.model_fields_set:
                payload[key] = old['reference'][key]
        payload = normalized_reference(payload)
        try:
            payload = administrative_regions.prepare_save(db,species_id,payload,value.region_codes if 'region_codes' in value.model_fields_set else None)
        except ValueError as error:
            raise HTTPException(422,str(error)) from None
        stamp = datetime.now(timezone.utc).isoformat()
        history = old['lifecycle_history']
        snapshot = life_snapshot(payload, stamp)
        previous = life_snapshot(old['reference'], old['updated_at'])
        if any(snapshot[k] != previous[k] for k in ('lifecycle', 'adult_periods', 'adult_source')):
            if not history:
                history = [previous]
            history = [*history, snapshot]
        payload['_lifecycle_history'] = history
        existing = db.execute('SELECT payload_json FROM species_references WHERE species_id=?', (species_id,)).fetchone()
        if existing and json.loads(existing[0]).get('_vagrant_year_managed'):
            payload['_vagrant_year_managed'] = True
        db.execute('INSERT INTO species_references VALUES (?, ?, ?) ON CONFLICT(species_id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at',
                   (species_id, json.dumps(payload, ensure_ascii=False), stamp))
        from app.vagrant_years import sync_vagrant_years
        sync_vagrant_years(db)
        return reference_row(db, species_id)


def season(periods: list[dict], on: date) -> dict:
    if not periods:
        return {'active': None, 'days_left': None, 'next_period': False, 'year_round': False}
    if any(p.get('start_day') is not None for p in periods):
        days = set()
        for p in periods:
            start_month, end_month = (p['start']-1)//3+1, (p['end']-1)//3+1
            start = p.get('start_day') or (date(2000,start_month,(p['start']-1)%3*10+1)-date(2000,1,1)).days+1
            end = p.get('end_day') or (date(2000,end_month,[10,20,calendar.monthrange(2000,end_month)[1]][(p['end']-1)%3])-date(2000,1,1)).days+1
            days.update((d-1)%366+1 for d in range(start,end+1 if end>=start else end+367))
        def ordinal(d): return (date(2000,d.month,d.day)-date(2000,1,1)).days+1
        point=ordinal(on)
        if point not in days:
            return {'active':False,'days_left':None,'next_period':any(d>point for d in days),'year_round':False}
        if len(days)==366:
            return {'active':True,'days_left':None,'next_period':False,'year_round':True}
        end_date=on
        while ordinal(end_date+timedelta(days=1)) in days:
            end_date+=timedelta(days=1)
        return {'active':True,'days_left':(end_date-on).days,'next_period':end_date.year==on.year and any(d>ordinal(end_date) for d in days),'year_round':False}
    slots = set()
    for p in periods:
        start, end = p['start'], p['end']
        slots.update(range(start, end + 1) if start <= end else [*range(start, 37), *range(1, end + 1)])
    slot = (on.month - 1) * 3 + min((on.day - 1) // 10, 2) + 1
    if slot not in slots:
        return {'active': False, 'days_left': None, 'next_period': any(n > slot for n in slots), 'year_round': False}
    if len(slots) == 36:
        return {'active': True, 'days_left': None, 'next_period': False, 'year_round': True}
    end = slot
    while end % 36 + 1 in slots:
        end += 1
    end_slot = (end - 1) % 36 + 1
    year = on.year + (end - 1) // 36
    month = (end_slot - 1) // 3 + 1
    day = [10, 20, calendar.monthrange(year, month)[1]][(end_slot - 1) % 3]
    return {'active': True, 'days_left': (date(year, month, day) - on).days,
            'next_period': any(n > end for n in slots), 'year_round': False}


@router.get('/exploration')
def exploration(on: date, region: str = ''):
    region = region.strip()
    with connect_database() as db:
        from app.trash import ACTIVE_OBSERVATION
        captured = {r[0] for r in db.execute(f"SELECT DISTINCT o.species_id FROM observations o WHERE o.result='observed' AND o.capture_status='captured' AND o.source_type='direct' AND o.species_id IS NOT NULL AND {ACTIVE_OBSERVATION}")}
        captured.update(row[0] for row in db.execute("SELECT DISTINCT species_id FROM holdings WHERE acquisition='own_capture'"))
        result = []
        observed_regions = administrative_regions.observation_regions(db)
        for row in db.execute('SELECT s.id,s.korean_name,s.scientific_name,r.payload_json FROM species s LEFT JOIN species_references r ON r.species_id=s.id ORDER BY s.korean_name'):
            raw = json.loads(row['payload_json']) if row['payload_json'] else {}
            ref = administrative_regions.for_species(db,row['id'],normalized_reference(raw),observed_regions,raw)
            permission = 'unknown'
            if region and region.casefold() == ref['permission_region'].casefold() and ref['permission_start'] and ref['permission_end'] and ref['permission_start'] <= on.isoformat() <= ref['permission_end']:
                permission = ref['permission']
            adult = [p for p in ref['lifecycle'] if p['enabled'] and p['stage'] == 'adult']
            periods = [p for p in adult if not region or not p['region'] or region.casefold() in p['region'].casefold()] if adult else ref['periods']
            result.append({'id': row['id'], 'korean_name': row['korean_name'], 'scientific_name': row['scientific_name'],
                'host_plants': ref['host_plants'], **season(periods, on), 'reference': ref,
                'old_vagrant': ref['vagrant'] is True and bool(ref['sighting_years']) and max(ref['sighting_years']) < 2010,
                'capture_history': 'captured' if row['id'] in captured else ref['capture_history'], 'permission': permission,
                'region_match': administrative_regions.matches_region(ref,region)})
        return result
