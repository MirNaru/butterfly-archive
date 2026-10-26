"""종 참고자료를 보존하고 성충 출현 기간과 탐사 조건을 계산합니다. 외부 호출은 없습니다."""
import calendar
import json
from datetime import date, datetime, timezone
from typing import Annotated, Literal, Self
from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator
from app.database import connect_database
from app.schemas import InputModel

router = APIRouter(prefix='/api')
Slot = Annotated[int, Field(strict=True, ge=1, le=36)]
Year = Annotated[int, Field(strict=True, ge=1800, le=9999)]


class Period(InputModel):
    start: Slot
    end: Slot


class Reference(InputModel):
    periods: list[Period] = Field(default_factory=list, max_length=36)
    regions: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(default_factory=list, max_length=100)
    north_only: bool | None = None
    vagrant: bool | None = None
    sighting_years: list[Year] = Field(default_factory=list, max_length=200)
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
        if (self.periods or self.regions or self.vagrant is not None or self.north_only is not None or self.sighting_years) and not self.source:
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


def reference_row(connection, species_id):
    if not connection.execute('SELECT 1 FROM species WHERE id=?', (species_id,)).fetchone():
        raise HTTPException(404, '종을 찾을 수 없습니다.')
    row = connection.execute('SELECT * FROM species_references WHERE species_id=?', (species_id,)).fetchone()
    return {'reference': json.loads(row['payload_json']) if row else Reference().model_dump(mode='json'),
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
        db.execute('INSERT INTO species_references VALUES (?, ?, ?) ON CONFLICT(species_id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at',
                   (species_id, json.dumps(payload, ensure_ascii=False), datetime.now(timezone.utc).isoformat()))
        return reference_row(db, species_id)


def season(periods: list[dict], on: date) -> dict:
    if not periods:
        return {'active': None, 'days_left': None, 'next_period': False, 'year_round': False}
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
        captured = {r[0] for r in db.execute("SELECT DISTINCT species_id FROM observations WHERE result='observed' AND capture_status='captured' AND species_id IS NOT NULL")}
        result = []
        for row in db.execute('SELECT s.id,s.korean_name,s.scientific_name,r.payload_json FROM species s LEFT JOIN species_references r ON r.species_id=s.id ORDER BY s.korean_name'):
            ref = json.loads(row['payload_json']) if row['payload_json'] else Reference().model_dump(mode='json')
            permission = 'unknown'
            if region and region.casefold() == ref['permission_region'].casefold() and ref['permission_start'] and ref['permission_end'] and ref['permission_start'] <= on.isoformat() <= ref['permission_end']:
                permission = ref['permission']
            result.append({'id': row['id'], 'korean_name': row['korean_name'], 'scientific_name': row['scientific_name'],
                **season(ref['periods'], on), 'reference': ref,
                'old_vagrant': ref['vagrant'] is True and bool(ref['sighting_years']) and max(ref['sighting_years']) < 2010,
                'capture_history': 'captured' if row['id'] in captured else ref['capture_history'], 'permission': permission,
                'region_match': not region or any(region.casefold() in item.casefold() for item in ref['regions'])})
        return result
