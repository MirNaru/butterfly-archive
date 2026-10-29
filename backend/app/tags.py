"""외부 환경 태그 목록과 탐사·종별 연결을 로컬 DB에서 관리합니다."""
from typing import Literal
from fastapi import APIRouter
from pydantic import Field
from app.database import connect_database
from app.schemas import InputModel

DEFAULT_TAGS = ('강풍', '안개', '지면 젖음', '태풍', '관찰 전 강우', '관찰 후 강우', '하천 범람',
                '벌초', '예초', '농약 살포', '공사', '벌목', '탐방객 많음', '차량 통행 많음')
router = APIRouter(prefix='/api/tags')


class TagInput(InputModel):
    name: str = Field(min_length=1, max_length=60)


def names(db, kind: Literal['survey', 'observation'], target_id: int) -> list[str]:
    table, column = ('survey_tags', 'survey_id') if kind == 'survey' else ('observation_tags', 'observation_id')
    return [row[0] for row in db.execute(f'SELECT t.name FROM tags t JOIN {table} x ON x.tag_id=t.id WHERE x.{column}=? ORDER BY t.id', (target_id,))]


def save_links(db, kind: Literal['survey', 'observation'], target_id: int, values: list[str]) -> None:
    table, column = ('survey_tags', 'survey_id') if kind == 'survey' else ('observation_tags', 'observation_id')
    db.execute(f'DELETE FROM {table} WHERE {column}=?', (target_id,))
    for name in values:
        db.execute('INSERT INTO tags(name) VALUES(?) ON CONFLICT(name) DO NOTHING', (name,))
        db.execute(f'INSERT INTO {table}({column},tag_id) SELECT ?,id FROM tags WHERE name=?', (target_id, name))


@router.get('')
def list_tags():
    with connect_database() as db:
        return [dict(row) for row in db.execute('''SELECT t.id,t.name,
            (SELECT COUNT(*) FROM survey_tags s WHERE s.tag_id=t.id) +
            (SELECT COUNT(*) FROM observation_tags o WHERE o.tag_id=t.id) AS usage
            FROM tags t ORDER BY usage DESC,t.id''')]


@router.post('', status_code=201)
def create_tag(value: TagInput):
    with connect_database() as db:
        db.execute('INSERT INTO tags(name) VALUES(?) ON CONFLICT(name) DO NOTHING', (value.name,))
        row = db.execute('SELECT id,name FROM tags WHERE name=?', (value.name,)).fetchone()
        return dict(row)
