"""탐사·관찰의 휴지통 이동·복구와 보호 복사본을 남기는 완전 삭제를 처리합니다."""
import sqlite3
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import Field
from app.database import connect_database, database_path
from app.schemas import InputModel

router = APIRouter(prefix='/api')
ACTIVE_SURVEY = "NOT EXISTS(SELECT 1 FROM record_trash t WHERE t.survey_id=s.id AND t.kind='survey' AND t.restored_at IS NULL)"
ACTIVE_OBSERVATION = "NOT EXISTS(SELECT 1 FROM record_trash t WHERE t.restored_at IS NULL AND ((t.kind='survey' AND t.survey_id=o.survey_id) OR (t.kind='observation' AND t.observation_id=o.id)))"


class DeleteInput(InputModel):
    expected_updated_at: str = Field(min_length=1, max_length=100)


class RestoreInput(InputModel):
    expected_deleted_at: str = Field(min_length=1, max_length=100)


def survey_active(db, survey_id):
    return db.execute(f'SELECT 1 FROM surveys s WHERE s.id=? AND {ACTIVE_SURVEY}', (survey_id,)).fetchone() is not None


def observation_active(db, observation_id):
    return db.execute(f'SELECT 1 FROM observations o WHERE o.id=? AND {ACTIVE_OBSERVATION}', (observation_id,)).fetchone() is not None


def move_to_trash(survey_id, value, observation_id=None):
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        survey = db.execute('SELECT * FROM surveys WHERE id=?', (survey_id,)).fetchone()
        if survey is None or not survey_active(db, survey_id):
            raise HTTPException(404, '탐사 기록을 찾을 수 없습니다.')
        if survey['updated_at'] != value.expected_updated_at:
            raise HTTPException(409, '다른 창에서 기록이 변경되었습니다. 목록을 새로고침한 뒤 다시 확인해 주세요.')
        if observation_id is not None:
            observation = db.execute('SELECT id FROM observations WHERE id=? AND survey_id=?', (observation_id, survey_id)).fetchone()
            if observation is None or not observation_active(db, observation_id):
                raise HTTPException(404, '관찰 기록을 찾을 수 없습니다.')
            linked = db.execute('SELECT 1 FROM holdings WHERE observation_id=? LIMIT 1', (observation_id,)).fetchone()
        else:
            linked = db.execute('SELECT 1 FROM holdings h JOIN observations o ON o.id=h.observation_id WHERE o.survey_id=? LIMIT 1', (survey_id,)).fetchone()
        if linked:
            raise HTTPException(409, '소장 기록과 연결된 관찰이 있습니다. 소장 목록에서 관찰 연결을 먼저 해제해 주세요. 직접 채집 근거와 소장 기록은 유지해야 합니다.')
        stamp = datetime.now(timezone.utc).isoformat()
        key = db.execute('INSERT INTO record_trash(kind,survey_id,observation_id,deleted_at) VALUES(?,?,?,?)',
                         ('survey' if observation_id is None else 'observation', survey_id, observation_id, stamp)).lastrowid
        db.execute('UPDATE surveys SET updated_at=? WHERE id=?', (stamp, survey_id))
        return {'id': key, 'deleted_at': stamp, 'survey_id': survey_id, 'observation_id': observation_id}


@router.delete('/surveys/{survey_id}')
def delete_survey(survey_id: int, value: DeleteInput):
    return move_to_trash(survey_id, value)


@router.delete('/surveys/{survey_id}/observations/{observation_id}')
def delete_observation(survey_id: int, observation_id: int, value: DeleteInput):
    return move_to_trash(survey_id, value, observation_id)


@router.get('/trash')
def list_trash():
    with connect_database() as db:
        rows = db.execute('''SELECT t.*,s.survey_date,s.place_name,o.species_id,sp.korean_name AS species_name
            FROM record_trash t JOIN surveys s ON s.id=t.survey_id
            LEFT JOIN observations o ON o.id=t.observation_id LEFT JOIN species sp ON sp.id=o.species_id
            WHERE t.restored_at IS NULL ORDER BY t.deleted_at DESC,t.id DESC''').fetchall()
        return [{**dict(row), 'parent_deleted': not survey_active(db, row['survey_id']) if row['kind'] == 'observation' else False}
                for row in rows]


@router.post('/trash/{trash_id}/restore')
def restore(trash_id: int, value: RestoreInput):
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT * FROM record_trash WHERE id=?', (trash_id,)).fetchone()
        if row is None:
            raise HTTPException(404, '휴지통 항목을 찾을 수 없습니다.')
        if row['restored_at'] is not None or row['deleted_at'] != value.expected_deleted_at:
            raise HTTPException(409, '이미 복구되었거나 휴지통 상태가 변경되었습니다. 목록을 새로고침해 주세요.')
        if row['kind'] == 'observation' and not survey_active(db, row['survey_id']):
            raise HTTPException(409, '탐사가 휴지통에 있습니다. 탐사 전체를 먼저 복구해 주세요.')
        stamp = datetime.now(timezone.utc).isoformat()
        db.execute('UPDATE record_trash SET restored_at=? WHERE id=?', (stamp, trash_id))
        db.execute('UPDATE surveys SET updated_at=? WHERE id=?', (stamp, row['survey_id']))
        return {'survey_id': row['survey_id'], 'observation_id': row['observation_id']}


def protect_before_purge():
    target = database_path()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = target.with_name(f'{target.name}.before-purge-{stamp}.bak')
    # 삭제 연결의 쓰기 잠금 안에서 별도 읽기 연결로 삭제 직전의 확정된 DB를 복사합니다.
    with connect_database() as source, sqlite3.connect(backup) as destination:
        source.backup(destination)
        if destination.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise sqlite3.DatabaseError('보호 복사본 무결성 검사 실패')


@router.delete('/trash/{trash_id}')
def purge(trash_id: int, value: RestoreInput):
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT * FROM record_trash WHERE id=?', (trash_id,)).fetchone()
        if row is None:
            raise HTTPException(404, '휴지통 항목을 찾을 수 없습니다.')
        if row['restored_at'] is not None or row['deleted_at'] != value.expected_deleted_at:
            raise HTTPException(409, '휴지통 상태가 변경되었습니다. 목록을 다시 읽어 주세요.')
        ids = [r[0] for r in db.execute('SELECT id FROM observations WHERE survey_id=?', (row['survey_id'],))] if row['kind'] == 'survey' else [row['observation_id']]
        for oid in ids:
            if db.execute('SELECT 1 FROM holdings WHERE observation_id=?', (oid,)).fetchone():
                raise HTTPException(409, '소장 기록과 연결되어 완전 삭제할 수 없습니다. 소장 목록에서 관찰 연결을 먼저 해제해 주세요.')
        try:
            protect_before_purge()
        except (OSError, sqlite3.Error) as error:
            raise HTTPException(503, 'DB 보호 복사본을 만들지 못해 삭제를 중단했습니다. 저장 공간과 파일 접근 권한을 확인해 주세요.') from error
        for oid in ids:
            db.execute("UPDATE collected_observations SET review_status='discarded' WHERE id IN (SELECT item_id FROM collection_imports WHERE observation_id=?)", (oid,))
            for table in ('collection_imports', 'weather_links', 'observation_tags', 'photo_links', 'record_trash'):
                db.execute(f'DELETE FROM {table} WHERE observation_id=?', (oid,))
            db.execute('DELETE FROM observations WHERE id=?', (oid,))
        if row['kind'] == 'survey':
            for table in ('weather_links', 'survey_tags', 'photo_links', 'record_trash'):
                db.execute(f'DELETE FROM {table} WHERE survey_id=?', (row['survey_id'],))
            db.execute('DELETE FROM surveys WHERE id=?', (row['survey_id'],))
        else:
            db.execute('UPDATE surveys SET updated_at=? WHERE id=?', (datetime.now(timezone.utc).isoformat(), row['survey_id']))
        return {'survey_id': row['survey_id'], 'observation_id': row['observation_id']}
