"""기존 DB를 백업하고 기록 및 외부 연동 스키마를 순서대로 추가합니다."""
import sqlite3
from datetime import datetime, timezone
from app.database import connect_database, database_path
from app.tags import DEFAULT_TAGS

SCHEMA_VERSION = 6
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

INTEGRATION_STATEMENTS = (
    """CREATE TABLE api_usage (
        service TEXT NOT NULL, day TEXT NOT NULL, attempts INTEGER NOT NULL CHECK(attempts >= 0),
        PRIMARY KEY(service, day))""",
    """CREATE TABLE weather_stations (
        as_of TEXT PRIMARY KEY, stations_json TEXT NOT NULL, fetched_at TEXT NOT NULL)""",
    """CREATE TABLE weather_samples (
        id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL, kind TEXT NOT NULL,
        target_time TEXT NOT NULL, payload_json TEXT NOT NULL, fetched_at TEXT NOT NULL)""",
    "CREATE INDEX weather_sample_lookup ON weather_samples(station_id, kind, target_time, id)",
    """CREATE TABLE weather_links (
        id INTEGER PRIMARY KEY, survey_id INTEGER REFERENCES surveys(id),
        observation_id INTEGER REFERENCES observations(id),
        sample_id INTEGER NOT NULL REFERENCES weather_samples(id),
        context_json TEXT NOT NULL, station_json TEXT NOT NULL, distance_km REAL,
        CHECK ((survey_id IS NULL) != (observation_id IS NULL)),
        UNIQUE(survey_id), UNIQUE(observation_id))""",
)


REFERENCE_STATEMENTS = (
    """CREATE TABLE species_references (
        species_id INTEGER PRIMARY KEY REFERENCES species(id),
        payload_json TEXT NOT NULL, updated_at TEXT NOT NULL)""",
)

SOURCE_STATEMENTS = (
    "ALTER TABLE observations ADD COLUMN source_type TEXT NOT NULL DEFAULT 'direct' CHECK(source_type IN ('direct','indirect'))",
    "ALTER TABLE observations ADD COLUMN source_note TEXT NOT NULL DEFAULT ''",
)

TAG_STATEMENTS = (
    'CREATE TABLE tags(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 60))',
    'CREATE TABLE survey_tags(survey_id INTEGER NOT NULL REFERENCES surveys(id), tag_id INTEGER NOT NULL REFERENCES tags(id), PRIMARY KEY(survey_id,tag_id))',
    'CREATE TABLE observation_tags(observation_id INTEGER NOT NULL REFERENCES observations(id), tag_id INTEGER NOT NULL REFERENCES tags(id), PRIMARY KEY(observation_id,tag_id))',
    'CREATE INDEX survey_tags_tag ON survey_tags(tag_id)',
    'CREATE INDEX observation_tags_tag ON observation_tags(tag_id)',
)


PHOTO_STATEMENTS = (
    '''CREATE TABLE photos(id INTEGER PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE,
       metadata_json TEXT NOT NULL, original_path TEXT, thumbnail_path TEXT, created_at TEXT NOT NULL)''',
    '''CREATE TABLE photo_links(photo_id INTEGER NOT NULL REFERENCES photos(id),
       survey_id INTEGER REFERENCES surveys(id), observation_id INTEGER REFERENCES observations(id),
       CHECK((survey_id IS NULL) != (observation_id IS NULL)),
       UNIQUE(photo_id,survey_id), UNIQUE(photo_id,observation_id))''',
    'CREATE INDEX photo_links_survey ON photo_links(survey_id)',
    'CREATE INDEX photo_links_observation ON photo_links(observation_id)',
)


def initialize_database() -> None:
    target = database_path()
    had_content = target.is_file() and target.stat().st_size > 0
    with connect_database() as connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version == SCHEMA_VERSION:
            return
        if version not in (0, 1, 2, 3, 4, 5):
            raise RuntimeError("지원하지 않는 DB 버전입니다. 기존 파일을 보존하고 실행을 중단합니다.")
        existing = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        expected_new = {"species_references"} if version < 3 else set()
        if version < 5:
            expected_new.update({'tags', 'survey_tags', 'observation_tags'})
        expected_new.update({'photos', 'photo_links'})
        if version < 2:
            expected_new.update({"api_usage", "weather_stations", "weather_samples", "weather_links"})
        if version == 0:
            expected_new.update({"species", "surveys", "observations"})
        if existing.intersection(expected_new):
            raise RuntimeError("기존 테이블과 충돌합니다. 자동 변경을 중단합니다.")
        if had_content:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            backup = target.with_name(f"{target.name}.before-v{SCHEMA_VERSION}-{stamp}.bak")
            with sqlite3.connect(backup) as destination:
                connection.backup(destination)
        connection.execute("BEGIN IMMEDIATE")
        # 다른 시작 프로세스가 먼저 변경한 경우 중복 적용하지 않습니다.
        current = connection.execute("PRAGMA user_version").fetchone()[0]
        if current == SCHEMA_VERSION:
            return
        if current != version:
            raise RuntimeError("DB 버전이 변경되었습니다. 다시 시작해 주세요.")
        for statement in ((STATEMENTS if version == 0 else ()) + (INTEGRATION_STATEMENTS if version < 2 else ()) + (REFERENCE_STATEMENTS if version < 3 else ()) + (SOURCE_STATEMENTS if version < 4 else ()) + (TAG_STATEMENTS if version < 5 else ()) + PHOTO_STATEMENTS):
            connection.execute(statement)
        if version < 5:
            connection.executemany('INSERT INTO tags(name) VALUES(?)', [(name,) for name in DEFAULT_TAGS])
        connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
