from fastapi.testclient import TestClient
from app.main import app


def test_health_checks_database(tmp_path, monkeypatch):
    target = tmp_path / "test.sqlite3"
    monkeypatch.setenv("BUTTERFLY_DB_PATH", str(target))
    with TestClient(app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}
    assert target.exists()


def test_health_reports_unavailable_database(tmp_path, monkeypatch):
    monkeypatch.setenv("BUTTERFLY_DB_PATH", str(tmp_path))
    with TestClient(app) as client:
        response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}
