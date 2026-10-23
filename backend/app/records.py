"""종과 조사를 하나의 트랜잭션으로 저장하고 관계를 재조회합니다."""
import sqlite3
from datetime import datetime, timezone
from app.database import connect_database
from app.schemas import SpeciesInput, SurveyInput


class UnknownSpecies(ValueError):
    pass


def list_species() -> list[dict]:
    with connect_database() as connection:
        return [dict(r) for r in connection.execute(
            "SELECT id, korean_name, scientific_name FROM species ORDER BY korean_name")]


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
    observations = []
    for row in connection.execute(
        """SELECT o.*, s.korean_name AS species_name FROM observations o
        LEFT JOIN species s ON s.id=o.species_id WHERE survey_id=? ORDER BY o.id""", (survey_id,)):
        record = dict(row)
        record.pop("survey_id")
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
    values = value.model_dump(mode="json", exclude={"observations"})
    now = datetime.now(timezone.utc).isoformat()
    values.update(created_at=now, updated_at=now)
    with connect_database() as connection:
        # 열 이름은 검증된 모델에서만 가져오고 값은 매개변수로 전달합니다.
        columns = ", ".join(values)
        cursor = connection.execute(
            f"INSERT INTO surveys ({columns}) VALUES ({', '.join('?' for _ in values)})", tuple(values.values()))
        survey_id = cursor.lastrowid
        for item in value.observations:
            if item.species_id and not connection.execute(
                    "SELECT 1 FROM species WHERE id=?", (item.species_id,)).fetchone():
                raise UnknownSpecies("선택한 종이 없습니다. 종 목록을 새로 확인해 주세요.")
            fields = {"survey_id": survey_id, **item.model_dump(mode="json")}
            connection.execute(
                f"INSERT INTO observations ({', '.join(fields)}) VALUES ({', '.join('?' for _ in fields)})",
                tuple(fields.values()))
        return read_survey(connection, survey_id)
