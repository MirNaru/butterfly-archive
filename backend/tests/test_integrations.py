"""실제 외부 호출 없이 비용 차단, 자료 보존, 역사 시점과 오류 처리를 검사합니다."""
import json
import sqlite3
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Event

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import api_usage, integration_settings, migrations, naver_maps, weather, weather_store
from app.database import connect_database


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BUTTERFLY_DB_PATH", str(tmp_path / "integration.sqlite3"))
    for key, value in {"MAPS_ENABLED": "true", "MAPS_FREE_TIER_CONFIRMED": "true",
                       "NAVER_MAPS_CLIENT_ID": "public-test-id", "NAVER_MAPS_CLIENT_SECRET": "private-test-secret",
                       "KMA_ENABLED": "true", "KMA_API_PROVIDER": "apihub", "KMA_API_KEY": "private-test-key"}.items():
        monkeypatch.setenv(key, value)
    def blocked(*args, **kwargs):
        pytest.fail("테스트에서 실제 외부 호출을 시도했습니다.")
    monkeypatch.setattr(urllib.request.OpenerDirector, "open", blocked)
    with TestClient(app) as result:
        yield result


STATIONS = "# STN_KO\n108 126.966 37.571 1 86 87 1 10 1 108 서울 SEOUL\n#7777END"


def sample(kind="daily", target="20251022", temperature=13.1):
    codes = ["TM", "STN", *[field[0] for field in weather.FIELDS[kind]]]
    values = [target, 108, *[temperature if code.startswith("TA") else -9 if code == "RN_DAY" else 50
                            for code in codes[2:]]]
    sep = "," if kind == "daily" else " "
    return "\n".join([*[f"  # {i}. {code} : test" for i, code in enumerate(codes, 1)],
                      sep.join(map(str, values)), "#7777END"])


@pytest.fixture
def upstream(monkeypatch):
    calls = []
    def fetch(endpoint, params):
        calls.append((endpoint, params))
        if endpoint == "stn_inf.php":
            return STATIONS
        return sample("hourly" if endpoint == "kma_sfctm2.php" else "daily", params["tm"])
    monkeypatch.setattr(weather, "fetch_text", fetch)
    return calls


def record(client, **changes):
    response = client.post("/api/surveys", json={"survey_date": "2025-10-22", "place_name": "공개 시험 장소",
                          "latitude": 37.5666, "longitude": 126.9784, **changes})
    assert response.status_code == 201, response.text
    return response.json()


def query(client, target_id, **changes):
    return client.post("/api/weather/query", json={"target_type": "survey", "target_id": target_id,
                                                 "station_id": 108, **changes})


def test_automatic_weather_waits_outside_registration_and_shares_one_response(client, upstream, monkeypatch):
    from app import weather_queue
    original = weather.fetch_text
    entered, release, done = Event(), Event(), Event()

    def delayed(endpoint, params):
        if endpoint == "kma_sfcdd.php":
            entered.set()
            assert release.wait(5)
        return original(endpoint, params)

    run = weather_queue.run
    def tracked(limit):
        try:
            run(limit)
        finally:
            done.set()

    monkeypatch.setattr(weather, "fetch_text", delayed)
    monkeypatch.setattr(weather_queue, "run", tracked)
    first = record(client, observations=[{}])["observations"][0]["id"]
    second = record(client, observations=[{}])["observations"][0]["id"]
    assert upstream == []
    try:
        result = client.post("/api/weather-queue", json={}, headers={"X-Butterfly-Client": "app"})
        assert result.json()["running"]
        assert entered.wait(5)
        record(client, observations=[{}])
        assert client.get("/api/weather-queue").json()["running"]
    finally:
        release.set()
        assert done.wait(5)
    assert weather_queue.status()["saved"] == 2
    assert len(upstream) == 2 and upstream[-1][1]["stn"] == 0
    assert {first, second} <= {int(key) for key in client.get("/api/record-weather").json()}


def test_automatic_weather_retries_a_transient_provider_error(client, upstream, monkeypatch):
    from app import weather_queue
    oid = record(client, observations=[{}])["observations"][0]["id"]
    original = weather.fetch_text
    failures = []

    def transient(endpoint, params):
        if endpoint == "kma_sfcdd.php" and not failures:
            failures.append(endpoint)
            raise integration_settings.IntegrationError("연결 실패", 503)
        return original(endpoint, params)

    monkeypatch.setattr(weather, "fetch_text", transient)
    monkeypatch.setattr(weather_queue, "sleep", lambda _: None)
    monkeypatch.setattr(weather_queue, "progress", dict(running=True,total=0,saved=0,skipped=0,missing=0,pending=0))
    weather_queue.run(1)
    assert failures and weather_queue.status()["saved"] == 1
    assert str(oid) in client.get("/api/record-weather").json()


def test_obscured_weather_uses_only_stations_within_public_radius(client, upstream, monkeypatch):
    from app import weather_queue
    monkeypatch.setattr(weather_queue, "progress", dict(running=True,total=2,saved=0,skipped=0,missing=0,pending=0))
    monkeypatch.setattr(weather_queue, "missing_until", {})
    ids = [record(client, observations=[{}])["observations"][0]["id"] for _ in range(2)]
    ctx = weather_store.context("observation", ids[0])
    weather_queue.collect_group("daily", ctx["target_time"], [(ids[0],ctx,100),(ids[1],ctx,20_000)])
    stored = client.get("/api/record-weather").json()
    assert str(ids[0]) not in stored
    assert stored[str(ids[1])]["weather"]["station"]["id"] == 108
    assert weather_queue.status()["missing"] == 1


def test_weather_persist_restart_and_shared_sample(client, upstream):
    first, second = record(client), record(client)
    result = query(client, first["id"])
    assert result.status_code == 200, result.text
    saved = result.json()
    assert saved["weather"]["values"][-1]["value"] is None
    assert saved["weather"]["distance_km"] > 0
    assert query(client, first["id"]).json() == saved
    assert query(client, second["id"]).status_code == 200
    with TestClient(app) as restarted:
        assert restarted.get(f'/api/weather/survey/{first["id"]}').json() == saved
    assert len(upstream) == 2  # 관측소 한 번, 같은 날짜 자료 한 번
    assert "authKey" not in json.dumps(saved)


def test_refresh_failure_preserves_existing_and_success_isolated(client, upstream, monkeypatch):
    first, second = record(client), record(client)
    old = query(client, first["id"]).json()
    query(client, second["id"])
    def fail(*args):
        raise integration_settings.IntegrationError("연결 실패", 503)
    monkeypatch.setattr(weather, "fetch_text", fail)
    assert query(client, first["id"], refresh=True).status_code == 503
    assert client.get(f'/api/weather/survey/{first["id"]}').json() == old
    monkeypatch.setattr(weather, "fetch_text", lambda *args: sample(temperature=20))
    assert query(client, first["id"], refresh=True).json()["weather"]["values"][0]["value"] == 20
    assert client.get(f'/api/weather/survey/{second["id"]}').json()["weather"]["values"][0]["value"] == 13.1


def test_hourly_inheritance_historical_station_and_stale(client, upstream):
    row = record(client, observations=[{"observation_time": "12:59"}])
    oid = row["observations"][0]["id"]
    response = query(client, oid, target_type="observation")
    assert response.status_code == 200, response.text
    assert response.json()["context"]["target_time"] == "202510221200"
    assert upstream[0][1]["tm"] == "202510221200"
    assert upstream[1][0] == "kma_sfctm2.php"
    with connect_database() as connection:
        connection.execute("UPDATE surveys SET survey_date='2025-10-21' WHERE id=?", (row["id"],))
    assert client.get(f"/api/weather/observation/{oid}").json()["weather"]["stale"] is True
    assert len(upstream) == 2


def test_changed_context_during_fetch_cannot_attach_wrong_weather(client, upstream, monkeypatch):
    row = record(client)
    original = weather.fetch_text
    def fetch(endpoint, params):
        text = original(endpoint, params)
        if endpoint != "stn_inf.php":
            with connect_database() as connection:
                connection.execute("UPDATE surveys SET place_name='변경 장소' WHERE id=?", (row["id"],))
        return text
    monkeypatch.setattr(weather, "fetch_text", fetch)
    assert query(client, row["id"]).status_code == 409
    assert client.get(f'/api/weather/survey/{row["id"]}').json()["weather"] is None


def test_no_coordinates_and_invalid_station(client, upstream):
    row = record(client, latitude=None, longitude=None)
    assert query(client, row["id"]).json()["weather"]["distance_km"] is None
    assert query(client, row["id"], station_id=9999).status_code == 422
    assert len(upstream) == 2


def test_today_daily_and_future_rejected_before_external(client, upstream):
    for day in (api_usage.now_kst().date().isoformat(), "2099-01-01"):
        row = record(client, survey_date=day)
        assert query(client, row["id"]).status_code == 422
    assert upstream == []


@pytest.mark.parametrize("kind,target", [("daily", "20251022"), ("hourly", "202510221200")])
def test_weather_parsing_negative_temperature_missing_rain(kind, target):
    values = weather.parse_weather(sample(kind, target, -9), 108, target, kind)["values"]
    assert values[0]["value"] == -9
    assert values[-1]["value"] is None
    assert weather.parse_weather(sample(kind, target, -99), 108, target, kind)["values"][0]["value"] is None
    with pytest.raises(integration_settings.IntegrationError):
        weather.parse_weather(sample(kind, target).replace("#7777END", ""), 108, target, kind)
    with pytest.raises(integration_settings.IntegrationError) as error:
        weather.parse_weather(sample(kind, target), 999, target, kind)
    assert error.value.status == 404


def test_station_cp949(client, monkeypatch):
    monkeypatch.setattr(weather, "request_bytes", lambda *args: STATIONS.encode("cp949"))
    result = weather.parse_stations(weather.fetch_text("stn_inf.php", {}))
    assert result[0]["name"] == "서울"
    assert weather.distance_km(37.571, 126.966, result[0]) == 0


def test_quota_concurrent_persistent_and_calendar_rollover(client, monkeypatch):
    monkeypatch.setitem(api_usage.LIMITS, "geocode", (2, 3))
    monkeypatch.setattr(api_usage, "now_kst", lambda: datetime(2026, 10, 23, tzinfo=api_usage.KST))
    def attempt(_):
        try:
            api_usage.reserve("geocode")
            return True
        except api_usage.UsageLimitError:
            return False
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(attempt, range(8))) == 2
    with TestClient(app) as restarted:
        assert restarted.get("/api/integrations/status").json()["usage"][0]["today"] == 2
    monkeypatch.setattr(api_usage, "now_kst", lambda: datetime(2026, 10, 24, tzinfo=api_usage.KST))
    api_usage.reserve("geocode")
    with pytest.raises(api_usage.UsageLimitError):
        api_usage.reserve("geocode")
    monkeypatch.setattr(api_usage, "now_kst", lambda: datetime(2026, 11, 1, tzinfo=api_usage.KST))
    api_usage.reserve("geocode")
    assert api_usage.usage()[0]["month"] == 1


@pytest.mark.parametrize("service,limit,period", [
    ("map", 6_000_000, "monthly"), ("geocode", 3_000_000, "monthly"),
    ("reverse", 3_000_000, "monthly"), ("kma", 20_000, "daily"),
])
def test_provider_limit_boundary(client, monkeypatch, service, limit, period):
    monkeypatch.setattr(api_usage, "now_kst", lambda: datetime(2026, 10, 24, tzinfo=api_usage.KST))
    assert api_usage.LIMITS[service] == ((None, limit) if period == "monthly" else (limit, None))
    with connect_database() as connection:
        connection.execute("INSERT INTO api_usage VALUES (?, ?, ?)", (service, "2026-10-24", limit - 1))
        if period == "daily":
            connection.execute("INSERT INTO api_usage VALUES (?, ?, ?)", (service, "2026-10-23", 500_000))
    api_usage.reserve(service)
    with pytest.raises(api_usage.UsageLimitError):
        api_usage.reserve(service)
    assert next(u for u in api_usage.usage() if u["service"] == service)["today"] == limit


def test_provider_reference_is_dated_and_not_added_to_local_usage(client, monkeypatch):
    monkeypatch.setenv("NAVER_USAGE_SNAPSHOT_DATE", "2026-10-24")
    monkeypatch.setenv("NAVER_MAP_USAGE_SNAPSHOT", "7")
    row = next(u for u in api_usage.usage() if u["service"] == "map")
    assert row["reported_count"] == 7
    assert row["reported_date"] == "2026-10-24"
    assert row["month"] == 0
    monkeypatch.setenv("NAVER_MAP_USAGE_SNAPSHOT", "invalid")
    assert api_usage.reported_usage("map")["reported_count"] is None


def test_failed_call_counted_once_and_secrets_redacted(client, monkeypatch):
    calls = []
    def fail(*args, **kwargs):
        calls.append(True)
        raise urllib.error.HTTPError("https://example.invalid/?authKey=private-test-key", 403, "private-test-secret", {}, None)
    monkeypatch.setattr(urllib.request.OpenerDirector, "open", fail)
    response = client.post("/api/maps/geocode", json={"query": "서울시청"})
    assert response.status_code == 503
    assert "private-test" not in response.text
    assert len(calls) == 1
    assert api_usage.usage()[0]["today"] == 1


def test_disabled_settings_and_bad_origin_fail_closed(client, monkeypatch):
    for origin in ["https://evil.example", "null", "http://localhost:bad", "http://localhost:9999"]:
        assert client.post("/api/maps/permit", headers={"Origin": origin}).status_code == 403
    monkeypatch.setenv("MAPS_FREE_TIER_CONFIRMED", "false")
    assert client.post("/api/maps/permit").status_code == 503
    assert client.post("/api/maps/geocode", json={"query": "서울시청"}).status_code == 503
    assert all(item["today"] == 0 for item in api_usage.usage())


def test_map_input_empty_result_and_valid_point(client, monkeypatch):
    assert client.post("/api/maps/reverse", json={"latitude": 91, "longitude": 127}).status_code == 422
    assert client.post("/api/maps/geocode", json={"query": " "}).status_code == 422
    monkeypatch.setattr(naver_maps, "request_json", lambda *args: {"status": "OK", "addresses": []})
    assert client.post("/api/maps/geocode", json={"query": "없는 주소"}).json() == []
    monkeypatch.setattr(naver_maps, "request_json", lambda *args: {"status": "OK", "addresses": [
        {"y": "37.5", "x": "127.0", "roadAddress": "시험 주소"}]})
    assert client.post("/api/maps/geocode", json={"query": "시험 주소"}).json()[0]["latitude"] == 37.5
    monkeypatch.setattr(naver_maps, "request_json", lambda *args: {"status": {"code": 3}})
    assert client.post("/api/maps/reverse", json={"latitude": 37.5, "longitude": 127}).json() == {"address": None}
    def unexpected_request(*args):
        pytest.fail("A saved map lookup must not call the provider again")
    monkeypatch.setattr(naver_maps, "request_json", unexpected_request)
    assert client.post("/api/maps/geocode", json={"query": "시험   주소"}).json()[0]["latitude"] == 37.5
    assert client.post("/api/maps/reverse", json={"latitude": 37.5, "longitude": 127}).json() == {"address": None}
    row = record(client, location_method="map")
    assert row["location_method"] == "map"


def test_quota_database_error_prevents_network(client, monkeypatch, tmp_path):
    monkeypatch.setenv("BUTTERFLY_DB_PATH", str(tmp_path))
    assert client.post("/api/maps/geocode", json={"query": "서울시청"}).status_code == 503


def test_v1_migration_backup_and_rollback(tmp_path, monkeypatch):
    path = tmp_path / "old.sqlite3"
    monkeypatch.setenv("BUTTERFLY_DB_PATH", str(path))
    with connect_database() as connection:
        for statement in migrations.STATEMENTS:
            connection.execute(statement)
        connection.execute("INSERT INTO species VALUES (1,'보존 종',NULL,'2026-10-23')")
        connection.execute("PRAGMA user_version=1")
    statements = migrations.INTEGRATION_STATEMENTS
    monkeypatch.setattr(migrations, "INTEGRATION_STATEMENTS", statements + ("INVALID SQL",))
    with pytest.raises(sqlite3.Error):
        migrations.initialize_database()
    with connect_database() as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 1
        assert connection.execute("SELECT name FROM sqlite_master WHERE name='api_usage'").fetchone() is None
        assert connection.execute("SELECT korean_name FROM species").fetchone()[0] == "보존 종"
    assert list(tmp_path.glob("*.bak"))
    monkeypatch.setattr(migrations, "INTEGRATION_STATEMENTS", statements)
    migrations.initialize_database()
    before = len(list(tmp_path.glob("*.bak")))
    migrations.initialize_database()
    assert len(list(tmp_path.glob("*.bak"))) == before
    with connect_database() as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == migrations.SCHEMA_VERSION
        assert connection.execute("SELECT korean_name FROM species").fetchone()[0] == "보존 종"
