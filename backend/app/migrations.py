"""기존 DB를 백업하고 최초 기록 스키마만 추가합니다."""
import sqlite3
from datetime import datetime, timezone
from app.database import connect_database, database_path

SCHEMA_VERSION = 1
STATEMENTS = (
    """CREATE TABLE species (
        id INTEGER PRIMARY KEY, korean_name TEXT NOT NULL UNIQUE,
        scientific_name TEXT, created_at TEXT NOT NULL)""",
    """CREATE TABLE surveys (
        id INTEGER PRIMARY KEY, survey_date TEXT NOT NULL, place_name TEXT NOT NULL,
        latitude REAL, longitude REAL, location_method TEXT NOT NULL,
        purpose TEXT NOT NULL, notes TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL)""",
    """CREATE TABLE observations (
        id INTEGER PRIMARY KEY, survey_id INTEGER NOT NULL REFERENCES surveys(id),
        species_id INTEGER REFERENCES species(id), result TEXT NOT NULL,
        observation_date TEXT, observation_time TEXT, place_name TEXT NOT NULL,
        latitude REAL, longitude REAL, location_method TEXT NOT NULL,
        stage TEXT NOT NULL, sex TEXT NOT NULL, count INTEGER CHECK(count > 0),
        count_estimated INTEGER NOT NULL, identification TEXT NOT NULL,
        capture_status TEXT NOT NULL, captured_count INTEGER CHECK(captured_count > 0),
        notes TEXT NOT NULL)""",
    "CREATE INDEX observations_survey ON observations(survey_id)",
)


def initialize_database() -> None:
    target = database_path()
    had_content = target.is_file() and target.stat().st_size > 0
    with connect_database() as connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version == SCHEMA_VERSION:
            return
        if version != 0:
            raise RuntimeError("지원하지 않는 DB 버전입니다. 기존 파일을 보존하고 실행을 중단합니다.")
        existing = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if existing.intersection({"species", "surveys", "observations"}):
            raise RuntimeError("기존 테이블과 충돌합니다. 자동 변경을 중단합니다.")
        if had_content:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            backup = target.with_name(f"{target.name}.before-v1-{stamp}.bak")
            with sqlite3.connect(backup) as destination:
                connection.backup(destination)
        connection.execute("BEGIN IMMEDIATE")
        for statement in STATEMENTS:
            connection.execute(statement)
        connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
