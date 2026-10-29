"""소장·취득 경로를 관리하고 개인 관찰과의 연결 근거를 검증합니다."""
from datetime import date, datetime, timezone
from typing import Annotated, Literal, Self
from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator, field_validator
from app.database import connect_database
from app.schemas import InputModel, Count
from app.trash import observation_active

router = APIRouter(prefix='/api/holdings')


class HoldingInput(InputModel):
    species_id: Count
    sex: Literal['unknown', 'male', 'female', 'mixed'] = 'unknown'
    possession: Literal['owned', 'not_owned', 'unknown'] = 'unknown'
    quantity: Count | None = None
    male_quantity: Count | None = None
    female_quantity: Count | None = None
    acquisition: Literal['own_capture', 'purchase', 'other', 'unknown'] = 'unknown'
    acquired_date: date | None = None
    observation_id: Count | None = None
    source_note: str = Field(default='', max_length=2000)
    notes: str = Field(default='', max_length=5000)
    photo_ids: list[Annotated[int, Field(strict=True, gt=0)]] = Field(default_factory=list, max_length=2000)

    @field_validator('photo_ids')
    @classmethod
    def unique_photos(cls, values):
        return list(dict.fromkeys(values))

    @model_validator(mode='after')
    def coherent(self) -> Self:
        if self.sex == 'mixed':
            if self.quantity is None or self.quantity < 2:
                raise ValueError('수컷과 암컷을 모두 선택하면 총 소장 개체 수를 2개체 이상 입력해 주세요.')
            if (self.male_quantity is None) != (self.female_quantity is None):
                raise ValueError('성별 수량은 수컷과 암컷을 함께 입력하거나 모두 비워 주세요.')
            if self.male_quantity is not None and self.male_quantity + self.female_quantity != self.quantity:
                raise ValueError('수컷과 암컷 개체 수의 합계가 총 소장 개체 수와 같아야 합니다.')
        elif self.male_quantity is not None or self.female_quantity is not None:
            raise ValueError('성별 세부 수량은 수컷과 암컷을 모두 선택한 기록에만 입력해 주세요.')
        if self.possession != 'owned' and self.quantity is not None:
            raise ValueError('현재 소지함으로 확인한 기록에만 소장 수량을 입력해 주세요.')
        if self.observation_id is not None and self.acquisition != 'own_capture':
            raise ValueError('개인 관찰 연결은 직접 채집한 소장 기록에만 사용할 수 있습니다.')
        if self.acquisition == 'own_capture' and self.observation_id is None and not self.source_note:
            raise ValueError('직접 채집은 연결된 관찰 또는 표본 라벨·본인 확인 등의 근거를 입력해 주세요.')
        return self


class HoldingUpdate(HoldingInput):
    expected_updated_at: str = Field(min_length=1, max_length=100)


def validate_observation_links(db, observation_id):
    holdings = db.execute('SELECT * FROM holdings WHERE observation_id=?', (observation_id,)).fetchall()
    if not holdings:
        return
    observation = db.execute('SELECT * FROM observations WHERE id=?', (observation_id,)).fetchone()
    if not observation or not observation_active(db, observation_id) or observation['source_type'] != 'direct' or observation['result'] != 'observed' or observation['capture_status'] != 'captured':
        raise HTTPException(422, '연결할 관찰은 직접 관찰·채집함 기록이어야 합니다. 기존 소장 연결이 있다면 먼저 연결을 수정해 주세요.')
    if any(row['species_id'] != observation['species_id'] for row in holdings):
        raise HTTPException(422, '소장 종과 연결된 관찰 종이 다릅니다. 소장 연결을 먼저 확인해 주세요.')
    known = sum(row['quantity'] or 0 for row in holdings if row['possession'] == 'owned')
    if observation['captured_count'] is not None and known > observation['captured_count']:
        raise HTTPException(422, '연결된 소장 기록의 알려진 수량 합계가 관찰의 채집 개체 수보다 많습니다.')


def read_holding(db, holding_id):
    row = db.execute('SELECT h.*,s.korean_name,s.scientific_name FROM holdings h JOIN species s ON s.id=h.species_id WHERE h.id=?', (holding_id,)).fetchone()
    if not row:
        raise HTTPException(404, '소장 기록을 찾을 수 없습니다.')
    return {**dict(row), 'photo_ids': [r[0] for r in db.execute('SELECT photo_id FROM holding_photos WHERE holding_id=? ORDER BY photo_id', (holding_id,))]}


def save_holding(db, value, holding_id=None):
    if not db.execute('SELECT 1 FROM species WHERE id=?', (value.species_id,)).fetchone():
        raise HTTPException(422, '선택한 종이 없습니다. 종 목록을 다시 확인해 주세요.')
    if value.observation_id is not None and not db.execute('SELECT 1 FROM observations WHERE id=?', (value.observation_id,)).fetchone():
        raise HTTPException(422, '연결할 관찰 기록이 없습니다.')
    fields = value.model_dump(mode='json', exclude={'expected_updated_at', 'photo_ids'})
    fields['updated_at'] = datetime.now(timezone.utc).isoformat()
    if holding_id is None:
        fields['created_at'] = fields['updated_at']
        holding_id = db.execute(f"INSERT INTO holdings({','.join(fields)}) VALUES({','.join('?' for _ in fields)})", tuple(fields.values())).lastrowid
    else:
        db.execute(f"UPDATE holdings SET {','.join(key+'=?' for key in fields)} WHERE id=?", (*fields.values(), holding_id))
    for photo_id in value.photo_ids:
        if not db.execute('SELECT 1 FROM photos WHERE id=?', (photo_id,)).fetchone():
            raise HTTPException(422, '연결할 사진 자료가 없습니다.')
    db.execute('DELETE FROM holding_photos WHERE holding_id=?', (holding_id,))
    db.executemany('INSERT INTO holding_photos(holding_id,photo_id) VALUES(?,?)', [(holding_id, photo_id) for photo_id in value.photo_ids])
    if value.observation_id is not None:
        validate_observation_links(db, value.observation_id)
    return read_holding(db, holding_id)


@router.get('')
def list_holdings():
    with connect_database() as db:
        ids = [row[0] for row in db.execute("SELECT h.id FROM holdings h LEFT JOIN species_references r ON r.species_id=h.species_id ORDER BY json_extract(r.payload_json,'$.display_order') IS NULL,json_extract(r.payload_json,'$.display_order'),h.species_id,h.id")]
        return [read_holding(db, key) for key in ids]


@router.post('', status_code=201)
def create_holding(value: HoldingInput):
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        return save_holding(db, value)


@router.get('/{holding_id}')
def get_holding(holding_id: int):
    with connect_database() as db:
        return read_holding(db, holding_id)


@router.put('/{holding_id}')
def update_holding(holding_id: int, value: HoldingUpdate):
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        old = read_holding(db, holding_id)
        if old['updated_at'] != value.expected_updated_at:
            raise HTTPException(409, '다른 창에서 소장 기록이 수정되었습니다. 입력을 보관한 뒤 목록을 다시 열어 주세요.')
        if 'photo_ids' not in value.model_fields_set:
            value.photo_ids = old['photo_ids']
        # 이전 클라이언트의 부분 필드 생략으로 저장된 성별 세부 수량을 지우지 않습니다.
        for key in ('male_quantity', 'female_quantity'):
            if key not in value.model_fields_set:
                setattr(value, key, old[key])
        try:
            value.coherent()
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        return save_holding(db, value, holding_id)
