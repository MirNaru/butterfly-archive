"""기존 DB를 백업하고 기록 및 외부 연동 스키마를 순서대로 추가합니다."""
import sqlite3
from datetime import datetime, timezone
from app.database import connect_database, database_path
from app.tags import DEFAULT_TAGS

SCHEMA_VERSION = 18
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


HOLDING_STATEMENTS = (
    '''CREATE TABLE holdings(id INTEGER PRIMARY KEY, species_id INTEGER NOT NULL REFERENCES species(id),
       sex TEXT NOT NULL, possession TEXT NOT NULL, quantity INTEGER CHECK(quantity>0),
       acquisition TEXT NOT NULL, acquired_date TEXT, observation_id INTEGER REFERENCES observations(id),
       source_note TEXT NOT NULL, notes TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)''',
    'CREATE INDEX holdings_observation ON holdings(observation_id)',
    '''CREATE TABLE holding_photos(holding_id INTEGER NOT NULL REFERENCES holdings(id),
       photo_id INTEGER NOT NULL REFERENCES photos(id), PRIMARY KEY(holding_id,photo_id))''',
)

HOLDING_SEX_STATEMENTS = (
    'ALTER TABLE holdings ADD COLUMN male_quantity INTEGER CHECK(male_quantity>0)',
    'ALTER TABLE holdings ADD COLUMN female_quantity INTEGER CHECK(female_quantity>0)',
)

TRASH_STATEMENTS = (
    '''CREATE TABLE record_trash(id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('survey','observation')),
       survey_id INTEGER NOT NULL REFERENCES surveys(id), observation_id INTEGER REFERENCES observations(id),
       deleted_at TEXT NOT NULL, restored_at TEXT,
       CHECK((kind='survey' AND observation_id IS NULL) OR (kind='observation' AND observation_id IS NOT NULL)))''',
    "CREATE UNIQUE INDEX trash_active_survey ON record_trash(survey_id) WHERE kind='survey' AND restored_at IS NULL",
    "CREATE UNIQUE INDEX trash_active_observation ON record_trash(observation_id) WHERE kind='observation' AND restored_at IS NULL",
)


COLLECTION_STATEMENTS = (
    "CREATE TABLE collected_observations(id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL, payload_json TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'pending', first_received_at TEXT NOT NULL, last_received_at TEXT NOT NULL, collected_at TEXT NOT NULL, UNIQUE(source,source_id))",
    "CREATE TABLE collection_revisions(id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES collected_observations(id), payload_json TEXT NOT NULL, replaced_at TEXT NOT NULL)",
    'CREATE TABLE collection_connection(id INTEGER PRIMARY KEY CHECK(id=1),token_hash TEXT NOT NULL)',
)

COLLECTION_IMPORT_STATEMENTS = (
    '''CREATE TABLE collection_imports(item_id INTEGER PRIMARY KEY REFERENCES collected_observations(id),
       observation_id INTEGER NOT NULL UNIQUE REFERENCES observations(id), imported_at TEXT NOT NULL,
       payload_json TEXT NOT NULL, inference_json TEXT NOT NULL)''',
)


PAPER_STATEMENTS = (
    '''CREATE TABLE papers(id INTEGER PRIMARY KEY, identity TEXT NOT NULL UNIQUE,
       payload_json TEXT NOT NULL, received_at TEXT NOT NULL)''',
    '''CREATE TABLE paper_observations(paper_id INTEGER NOT NULL REFERENCES papers(id),
       observation_id INTEGER NOT NULL UNIQUE REFERENCES observations(id),
       evidence TEXT NOT NULL, source_snapshot TEXT NOT NULL, case_key TEXT NOT NULL,
       created_at TEXT NOT NULL, UNIQUE(paper_id,case_key,observation_id))''',
    'CREATE INDEX paper_observations_paper ON paper_observations(paper_id)',
)


PAPER_FILE_STATEMENTS = (
    '''CREATE TABLE paper_files(id INTEGER PRIMARY KEY, paper_id INTEGER NOT NULL REFERENCES papers(id),
       sha256 TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, pages_json TEXT NOT NULL,
       created_at TEXT NOT NULL)''',
    'CREATE INDEX paper_files_paper ON paper_files(paper_id)',
)


MOBILE_STATEMENTS = (
    'CREATE TABLE mobile_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,code_hash TEXT,code_expires REAL NOT NULL DEFAULT 0)',
    'CREATE TABLE mobile_sessions(id INTEGER PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,label TEXT NOT NULL,created_at TEXT NOT NULL,expires REAL NOT NULL)',
    'CREATE TABLE mobile_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,window_end REAL NOT NULL)',
    "CREATE TABLE mobile_photos(id INTEGER PRIMARY KEY,sha256 TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,device_label TEXT NOT NULL,received_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','registered','discarded')),survey_id INTEGER REFERENCES surveys(id))",
    'CREATE INDEX mobile_photos_status ON mobile_photos(status,id)',
)


RESEARCH_STATEMENTS = (
    """CREATE TABLE IF NOT EXISTS paper_organization(
       paper_id INTEGER PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
       favorite INTEGER NOT NULL CHECK(favorite IN (0,1)), tags_json TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS web_sources(
       id INTEGER PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, species_id INTEGER REFERENCES species(id),
       saved_at TEXT NOT NULL)""",
    "CREATE UNIQUE INDEX IF NOT EXISTS web_sources_identity ON web_sources(url, COALESCE(species_id, 0))",
    """CREATE TABLE IF NOT EXISTS web_observations(
       observation_id INTEGER PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
       source_id INTEGER NOT NULL REFERENCES web_sources(id), case_key TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS gemini_daily_usage(day TEXT PRIMARY KEY, calls INTEGER NOT NULL)""",
)


# 원문과 당시 도감 근거는 그대로 두고 읽기 화면에 쓰는 필드만 별도로 유지합니다.
IMPORT_VIEW_PAYLOAD = """json_object(
    'source', json_extract({row}.payload_json,'$.source'),
    'location_accuracy', json(COALESCE({row}.payload_json -> '$.location_accuracy','null')),
    'location_obscured', json_extract({row}.payload_json,'$.location_obscured'),
    'latitude', json(COALESCE({row}.payload_json -> '$.latitude','null')),
    'longitude', json(COALESCE({row}.payload_json -> '$.longitude','null')),
    'place_raw', COALESCE(json_extract({row}.payload_json,'$.place_raw'),''),
    'weather_raw', COALESCE(json_extract({row}.payload_json,'$.weather_raw'),''),
    'observed_raw', json_extract({row}.payload_json,'$.observed_raw'),
    'url', json_extract({row}.payload_json,'$.url'))"""
IMPORT_VIEW_INFERENCE = """json_object(
    'stage', json_extract({row}.inference_json,'$.stage'),
    'manual_stage_override', json_extract({row}.inference_json,'$.manual_stage_override'))"""
IMPORT_VIEW_STATEMENTS = (
    """CREATE TABLE IF NOT EXISTS collection_import_views(
        item_id INTEGER PRIMARY KEY REFERENCES collection_imports(item_id) ON DELETE CASCADE,
        observation_id INTEGER NOT NULL UNIQUE,
        payload_json TEXT NOT NULL, inference_json TEXT NOT NULL)""",
    f"""CREATE TRIGGER IF NOT EXISTS collection_import_view_insert AFTER INSERT ON collection_imports BEGIN
        INSERT INTO collection_import_views VALUES(NEW.item_id, NEW.observation_id,
            {IMPORT_VIEW_PAYLOAD.format(row='NEW')}, {IMPORT_VIEW_INFERENCE.format(row='NEW')}); END""",
    f"""CREATE TRIGGER IF NOT EXISTS collection_import_view_update
        AFTER UPDATE OF payload_json,inference_json,observation_id ON collection_imports BEGIN
        UPDATE collection_import_views SET observation_id=NEW.observation_id,
            payload_json={IMPORT_VIEW_PAYLOAD.format(row='NEW')},
            inference_json={IMPORT_VIEW_INFERENCE.format(row='NEW')}
        WHERE item_id=OLD.item_id; END""",
)


def initialize_database() -> None:
    target = database_path()
    had_content = target.is_file() and target.stat().st_size > 0
    with connect_database() as connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version == SCHEMA_VERSION:
            return
        if version not in range(SCHEMA_VERSION):
            raise RuntimeError("지원하지 않는 DB 버전입니다. 기존 파일을 보존하고 실행을 중단합니다.")
        existing = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        expected_new = {"species_references"} if version < 3 else set()
        if version < 5:
            expected_new.update({'tags', 'survey_tags', 'observation_tags'})
        if version < 6:
            expected_new.update({'photos', 'photo_links'})
        if version < 7:
            expected_new.update({'holdings', 'holding_photos'})
        if version < 9:
            expected_new.add('record_trash')
        if version < 10:
            expected_new.update({'collected_observations', 'collection_revisions', 'collection_connection'})
        if version < 11:
            expected_new.add('collection_imports')
        if version < 12:
            expected_new.update({'papers', 'paper_observations'})
        if version < 13:
            expected_new.add('paper_files')
        if version < 14:
            expected_new.update({'mobile_settings','mobile_sessions','mobile_limits','mobile_photos'})
        if version < 18:
            expected_new.add('map_lookup_cache')
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
        for statement in ((STATEMENTS if version == 0 else ()) + (INTEGRATION_STATEMENTS if version < 2 else ()) + (REFERENCE_STATEMENTS if version < 3 else ()) + (SOURCE_STATEMENTS if version < 4 else ()) + (TAG_STATEMENTS if version < 5 else ()) + (PHOTO_STATEMENTS if version < 6 else ()) + (HOLDING_STATEMENTS if version < 7 else ()) + (HOLDING_SEX_STATEMENTS if version < 8 else ()) + (TRASH_STATEMENTS if version < 9 else ()) + (COLLECTION_STATEMENTS if version < 10 else ()) + (COLLECTION_IMPORT_STATEMENTS if version < 11 else ()) + (PAPER_STATEMENTS if version < 12 else ()) + (PAPER_FILE_STATEMENTS if version < 13 else ()) + (MOBILE_STATEMENTS if version < 14 else ()) + (("ALTER TABLE tags ADD COLUMN category TEXT NOT NULL DEFAULT 'environment' CHECK(category IN ('environment','individual'))", "UPDATE tags SET category='individual' WHERE name IN ('사육','돌연변이','사육 개체','사육개체')") if version < 15 else ()) + (RESEARCH_STATEMENTS if version < 16 else ())):
            connection.execute(statement)
        if version == 0:
            connection.execute("INSERT INTO tags(name,category) VALUES('사육','individual') ON CONFLICT(name) DO NOTHING")
        if version < 5:
            connection.executemany('INSERT INTO tags(name) VALUES(?)', [(name,) for name in DEFAULT_TAGS])
        if version < 17:
            for statement in IMPORT_VIEW_STATEMENTS:
                connection.execute(statement)
            # 원문은 변경하지 않으며 실패하면 스키마와 요약 생성을 함께 되돌립니다.
            connection.execute('DELETE FROM collection_import_views')
            connection.execute(f"""INSERT INTO collection_import_views
                SELECT ci.item_id,ci.observation_id,{IMPORT_VIEW_PAYLOAD.format(row='ci')},
                    {IMPORT_VIEW_INFERENCE.format(row='ci')} FROM collection_imports ci""")
        if version < 18:
            connection.execute("""CREATE TABLE map_lookup_cache (
                service TEXT NOT NULL, lookup_key TEXT NOT NULL, response_json TEXT NOT NULL,
                PRIMARY KEY(service, lookup_key))""")
        connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
