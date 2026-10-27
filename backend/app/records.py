"""종과 조사를 하나의 트랜잭션으로 저장하고 관계를 재조회합니다."""
import sqlite3
import json
from datetime import datetime, timezone
from app.database import connect_database
from app.schemas import SpeciesInput, SurveyInput, SurveyUpdate
from app.tags import names as tag_names, save_links


class UnknownSpecies(ValueError):
    pass


class EditConflict(ValueError):
    pass


class InvalidObservation(ValueError):
    pass


def update_survey(survey_id: int, value: SurveyUpdate) -> dict | None:
    """기존 ID와 기상 연결을 보존하며 조사 전체를 원자적으로 수정합니다."""
    with connect_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        original = read_survey(connection, survey_id)
        if original is None:
            return None
        if original["updated_at"] != value.expected_updated_at:
            raise EditConflict("다른 창에서 수정된 기록입니다. 입력은 유지됩니다. 변경 내용을 별도로 보관한 뒤 취소하고 목록을 새로고침해 주세요.")
        existing = {item["id"] for item in original["observations"]}
        supplied = [item.id for item in value.observations if item.id is not None]
        if len(supplied) != len(set(supplied)) or set(supplied) != existing:
            raise InvalidObservation("기존 종별 기록을 빠짐없이 한 번씩 포함해야 합니다. 삭제는 지원하지 않습니다.")
        for item in value.observations:
            if item.species_id and not connection.execute(
                    "SELECT 1 FROM species WHERE id=?", (item.species_id,)).fetchone():
                raise UnknownSpecies("선택한 종이 없습니다. 종 목록을 새로 확인해 주세요.")
        fields = value.model_dump(mode="json", exclude={"observations", "expected_updated_at", "tags"})
        fields["updated_at"] = datetime.now(timezone.utc).isoformat()
        connection.execute(f"UPDATE surveys SET {', '.join(key + '=?' for key in fields)} WHERE id=?",
                           (*fields.values(), survey_id))
        if 'tags' in value.model_fields_set:
            save_links(connection, 'survey', survey_id, value.tags)
        for item in value.observations:
            fields = item.model_dump(mode="json", exclude={"id", "tags"})
            if item.id is None:
                fields["survey_id"] = survey_id
                cursor = connection.execute(
                    f"INSERT INTO observations ({', '.join(fields)}) VALUES ({', '.join('?' for _ in fields)})",
                    tuple(fields.values()))
                record_id = cursor.lastrowid
            else:
                connection.execute(f"UPDATE observations SET {', '.join(key + '=?' for key in fields)} WHERE id=? AND survey_id=?",
                                   (*fields.values(), item.id, survey_id))
                record_id = item.id
            if item.id is None or 'tags' in item.model_fields_set:
                save_links(connection, 'observation', record_id, item.tags)
        return read_survey(connection, survey_id)


def list_species() -> list[dict]:
    with connect_database() as connection:
        return [{"id": r['id'], "korean_name": r['korean_name'], "scientific_name": r['scientific_name'],
                 "host_plants": json.loads(r['payload_json']).get('host_plants', '') if r['payload_json'] else ''}
                for r in connection.execute(
                    "SELECT s.id, s.korean_name, s.scientific_name, r.payload_json FROM species s "
                    "LEFT JOIN species_references r ON r.species_id=s.id "
                    "ORDER BY json_extract(r.payload_json, '$.display_order') IS NULL, "
                    "json_extract(r.payload_json, '$.display_order'), s.id")]


def create_species(value: SpeciesInput) -> dict:
    with connect_database() as connection:
        cursor = connection.execute(
            "INSERT INTO species(korean_name, scientific_name, created_at) VALUES (?, ?, ?)",
            (value.korean_name, value.scientific_name or None, datetime.now(timezone.utc).isoformat()))
        return {"id": cursor.lastrowid, **value.model_dump()}


def read_survey(connection: sqlite3.Connection, survey_id: int) -> dict | None:
    row = connection.execute("SELECT * FROM surveys WHERE id=?", (survey_id,)).fetchone()
    if row is None:
        return None
    survey = dict(row)
    survey['tags'] = tag_names(connection, 'survey', survey_id)
    observations = []
    for row in connection.execute(
        """SELECT o.*, s.korean_name AS species_name FROM observations o
        LEFT JOIN species s ON s.id=o.species_id WHERE survey_id=? ORDER BY o.id""", (survey_id,)):
        record = dict(row)
        record.pop("survey_id")
        record['tags'] = tag_names(connection, 'observation', record['id'])
        record['effective_tags'] = list(dict.fromkeys([*survey['tags'], *record['tags']]))
        record["count_estimated"] = bool(record["count_estimated"])
        has_location = bool(record["place_name"]) or record["latitude"] is not None
        record.update(
            effective_date=record["observation_date"] or survey["survey_date"],
            effective_place=record["place_name"] if has_location else survey["place_name"],
            effective_latitude=record["latitude"] if has_location else survey["latitude"],
            effective_longitude=record["longitude"] if has_location else survey["longitude"],
        )
        observations.append(record)
    return {**survey, "observations": observations}


def get_survey(survey_id: int) -> dict | None:
    with connect_database() as connection:
        return read_survey(connection, survey_id)


def list_surveys() -> list[dict]:
    with connect_database() as connection:
        ids = [r[0] for r in connection.execute("SELECT id FROM surveys ORDER BY survey_date DESC, id DESC")]
        return [read_survey(connection, key) for key in ids]


def create_survey(value: SurveyInput) -> dict:
    values = value.model_dump(mode="json", exclude={"observations", "tags"})
    now = datetime.now(timezone.utc).isoformat()
    values.update(created_at=now, updated_at=now)
    with connect_database() as connection:
        # 열 이름은 검증된 모델에서만 가져오고 값은 매개변수로 전달합니다.
        columns = ", ".join(values)
        cursor = connection.execute(
            f"INSERT INTO surveys ({columns}) VALUES ({', '.join('?' for _ in values)})", tuple(values.values()))
        survey_id = cursor.lastrowid
        save_links(connection, 'survey', survey_id, value.tags)
        for item in value.observations:
            if item.species_id and not connection.execute(
                    "SELECT 1 FROM species WHERE id=?", (item.species_id,)).fetchone():
                raise UnknownSpecies("선택한 종이 없습니다. 종 목록을 새로 확인해 주세요.")
            fields = {"survey_id": survey_id, **item.model_dump(mode="json", exclude={'tags'})}
            record_cursor = connection.execute(
                f"INSERT INTO observations ({', '.join(fields)}) VALUES ({', '.join('?' for _ in fields)})",
                tuple(fields.values()))
            save_links(connection, 'observation', record_cursor.lastrowid, item.tags)
        return read_survey(connection, survey_id)
