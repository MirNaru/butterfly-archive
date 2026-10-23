"""별도 DB에서 기록 검증, 원자적 저장, 재시작과 마이그레이션을 검사합니다."""
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import connect_database
from app.migrations import initialize_database


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BUTTERFLY_DB_PATH", str(tmp_path / "records.sqlite3"))
    with TestClient(app) as client:
        yield client


def species(client):
    response = client.post("/api/species", json={"korean_name": "테스트 나비", "scientific_name": "Test species"})
    assert response.status_code == 201
    return response.json()["id"]


def survey(**extra):
    return {"survey_date": "2026-10-23", "place_name": "테스트 장소", **extra}


def test_create_multi_record_and_restart(client):
    key = species(client)
    response = client.post("/api/surveys", json=survey(latitude=37.2, longitude=127.1, observations=[
        {"species_id": key, "stage": "adult", "count": 3, "capture_status": "captured", "captured_count": 1},
        {"species_id": key, "result": "not_found", "capture_status": "not_captured"},
        {"observation_date": "2026-10-22", "place_name": "다른 장소", "notes": "미확정 기록"},
    ]))
    assert response.status_code == 201, response.text
    saved = response.json()
    assert len(saved["observations"]) == 3
    first, absent, other = saved["observations"]
    assert first["effective_date"] == "2026-10-23"
    assert first["effective_latitude"] == 37.2
    assert first["observation_time"] is None
    assert absent["count"] is None
    assert other["effective_latitude"] is None
    assert other["effective_place"] == "다른 장소"
    with TestClient(app) as restarted:
        assert restarted.get(f'/api/surveys/{saved["id"]}').json() == saved
        assert restarted.get("/api/surveys").json() == [saved]


def test_empty_and_unknown_detail(client):
    assert client.get("/api/surveys").json() == []
    assert client.get("/api/species").json() == []
    assert client.get("/api/surveys/999").status_code == 404
    assert client.post("/api/surveys", json=survey()).json()["observations"] == []


@pytest.mark.parametrize("change", [
    {"survey_date": "2026-02-30"}, {"place_name": "  "}, {"latitude": 35},
    {"latitude": 91, "longitude": 127}, {"latitude": 35, "longitude": 181},
    {"observations": [{"count": 0}]}, {"observations": [{"count": -1}]},
    {"observations": [{"count": 1.5}]}, {"observations": [{"count": True}]},
    {"observations": [{"count_estimated": True}]},
    {"observations": [{"captured_count": 1}]},
    {"observations": [{"count": 1, "capture_status": "captured", "captured_count": 2}]},
    {"observations": [{"result": "not_found", "capture_status": "not_captured"}]},
    {"observations": [{"identification": "user_confirmed"}]},
    {"observations": [{"observation_time": "25:00"}]}, {"extra_field": "not allowed"},
])
def test_invalid_input_has_no_partial_save(client, change):
    response = client.post("/api/surveys", json=survey(**change))
    assert response.status_code == 422
    assert client.get("/api/surveys").json() == []


def test_absence_rejects_observed_stage(client):
    key = species(client)
    response = client.post("/api/surveys", json=survey(observations=[{
        "species_id": key, "result": "not_found", "capture_status": "not_captured", "stage": "adult"}]))
    assert response.status_code == 422


def test_unknown_species_rolls_back_entire_survey(client):
    response = client.post("/api/surveys", json=survey(observations=[{}, {"species_id": 999}]))
    assert response.status_code == 422
    with connect_database() as connection:
        assert connection.execute("SELECT COUNT(*) FROM surveys").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM observations").fetchone()[0] == 0


def test_species_duplicate_and_sql_text(client):
    species(client)
    assert client.post("/api/species", json={"korean_name": " 테스트 나비 "}).status_code == 409
    value = "장소'); DROP TABLE surveys; --"
    response = client.post("/api/surveys", json=survey(place_name=value))
    assert response.status_code == 201
    assert client.get("/api/surveys").json()[0]["place_name"] == value


def test_db_failure_is_reported(client, monkeypatch, tmp_path):
    monkeypatch.setenv("BUTTERFLY_DB_PATH", str(tmp_path))
    assert client.post("/api/surveys", json=survey()).status_code == 503


def test_migration_backup_preserves_existing_data(tmp_path, monkeypatch):
    path = tmp_path / "old.sqlite3"
    monkeypatch.setenv("BUTTERFLY_DB_PATH", str(path))
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE original (value TEXT)")
        connection.execute("INSERT INTO original VALUES ('preserve')")
    initialize_database()
    backups = list(tmp_path.glob("*.bak"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as connection:
        assert connection.execute("SELECT value FROM original").fetchone()[0] == "preserve"
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 0
    with connect_database() as connection:
        assert connection.execute("SELECT value FROM original").fetchone()[0] == "preserve"
    initialize_database()
    assert len(list(tmp_path.glob("*.bak"))) == 1


def test_migration_collision_does_not_change_database(tmp_path, monkeypatch):
    path = tmp_path / "collision.sqlite3"
    monkeypatch.setenv("BUTTERFLY_DB_PATH", str(path))
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE surveys (value TEXT)")
        connection.execute("INSERT INTO surveys VALUES ('preserve')")
    with pytest.raises(RuntimeError):
        initialize_database()
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT value FROM surveys").fetchone()[0] == "preserve"
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 0


def test_failed_migration_rolls_back_new_tables(tmp_path, monkeypatch):
    from app import migrations
    path = tmp_path / "failed.sqlite3"
    monkeypatch.setenv("BUTTERFLY_DB_PATH", str(path))
    monkeypatch.setattr(migrations, "STATEMENTS", (migrations.STATEMENTS[0], "INVALID SQL"))
    with pytest.raises(sqlite3.Error):
        initialize_database()
    with sqlite3.connect(path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 0
        assert connection.execute("SELECT name FROM sqlite_master WHERE name='species'").fetchone() is None
