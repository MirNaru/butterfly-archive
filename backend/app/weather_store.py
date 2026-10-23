"""기상자료를 한 번 저장하고 명시적인 재조회 외에는 외부 호출 없이 재사용합니다."""
import json
import threading
from datetime import datetime
from app import records, weather
from app.api_usage import KST, now_kst
from app.database import connect_database
from app.integration_settings import IntegrationError

# 로컬 단일 서버에서 동시 조회를 합쳐 중복 호출을 막습니다.
lookup_lock = threading.RLock()


def context(target_type: str, target_id: int) -> dict:
    if target_type == "survey":
        survey = records.get_survey(target_id)
        if survey is None:
            raise IntegrationError("조사 기록을 찾을 수 없습니다.", 404)
        result = {"date": survey["survey_date"], "time": None, "latitude": survey["latitude"],
                  "longitude": survey["longitude"], "place": survey["place_name"]}
    else:
        with connect_database() as connection:
            row = connection.execute("SELECT survey_id FROM observations WHERE id=?", (target_id,)).fetchone()
        if row is None:
            raise IntegrationError("종별 기록을 찾을 수 없습니다.", 404)
        survey = records.get_survey(row[0])
        record = next(r for r in survey["observations"] if r["id"] == target_id)
        result = {"date": record["effective_date"], "time": record["observation_time"],
                  "latitude": record["effective_latitude"], "longitude": record["effective_longitude"],
                  "place": record["effective_place"]}
    result["kind"] = "hourly" if result["time"] else "daily"
    result["target_time"] = result["date"].replace("-", "") + (result["time"][:2] + "00" if result["time"] else "")
    return result


def ensure_past(ctx: dict) -> None:
    target = datetime.strptime(ctx["target_time"], "%Y%m%d%H%M" if ctx["kind"] == "hourly" else "%Y%m%d").replace(tzinfo=KST)
    if target > now_kst() or (ctx["kind"] == "daily" and target.date() >= now_kst().date()):
        raise IntegrationError("완료된 과거 관측자료만 조회합니다. 일자료는 다음 날 이후 확인해 주세요.", 422)


def station_list(ctx: dict) -> list[dict]:
    ensure_past(ctx)
    as_of = ctx["target_time"] if ctx["kind"] == "hourly" else ctx["target_time"] + "1200"
    with lookup_lock:
        with connect_database() as connection:
            row = connection.execute("SELECT stations_json FROM weather_stations WHERE as_of=?", (as_of,)).fetchone()
        if row:
            stations = json.loads(row[0])
        else:
            stations = weather.parse_stations(weather.fetch_text("stn_inf.php", {"inf": "SFC", "stn": 0, "tm": as_of, "help": 1}))
            with connect_database() as connection:
                connection.execute("INSERT OR IGNORE INTO weather_stations VALUES (?, ?, ?)",
                                   (as_of, json.dumps(stations, ensure_ascii=False), now_kst().isoformat()))
    result = [{**s, "as_of": as_of, "distance_km": weather.distance_km(ctx["latitude"], ctx["longitude"], s)
               if ctx["latitude"] is not None else None} for s in stations]
    return sorted(result, key=lambda s: (s["distance_km"] if s["distance_km"] is not None else 0, s["id"]))


def saved(target_type: str, target_id: int) -> dict:
    ctx = context(target_type, target_id)
    column = "survey_id" if target_type == "survey" else "observation_id"
    with connect_database() as connection:
        row = connection.execute(f"""SELECT l.*, s.payload_json, s.fetched_at FROM weather_links l
            JOIN weather_samples s ON s.id=l.sample_id WHERE l.{column}=?""", (target_id,)).fetchone()
    if not row:
        return {"context": ctx, "weather": None}
    return {"context": ctx, "weather": {**json.loads(row["payload_json"]), "fetched_at": row["fetched_at"],
            "station": json.loads(row["station_json"]), "distance_km": row["distance_km"],
            "linked_context": json.loads(row["context_json"]), "stale": json.loads(row["context_json"]) != ctx}}


def query(target_type: str, target_id: int, station_id: int, refresh: bool = False) -> dict:
    with lookup_lock:
        current = saved(target_type, target_id)
        ctx = current["context"]
        previous = current["weather"]
        if previous and not refresh and not previous["stale"] and previous["station"]["id"] == station_id:
            return current
        stations = station_list(ctx)
        station = next((s for s in stations if s["id"] == station_id), None)
        if station is None:
            raise IntegrationError("해당 시점에 존재하는 관측소를 선택해 주세요.", 422)
        with connect_database() as connection:
            cached = connection.execute("""SELECT id FROM weather_samples WHERE station_id=? AND kind=? AND target_time=?
                ORDER BY id DESC LIMIT 1""", (station_id, ctx["kind"], ctx["target_time"])).fetchone()
        payload = None
        if not cached or refresh:
            endpoint = "kma_sfctm2.php" if ctx["kind"] == "hourly" else "kma_sfcdd.php"
            text = weather.fetch_text(endpoint, {"tm": ctx["target_time"], "stn": station_id, "help": 1})
            payload = weather.parse_weather(text, station_id, ctx["target_time"], ctx["kind"])
        # 호출 실패 시 여기까지 도달하지 않아 이전 연결과 자료가 유지됩니다.
        with connect_database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if context(target_type, target_id) != ctx:
                raise IntegrationError("조회 중 기록 조건이 바뀌었습니다. 기록을 다시 확인해 주세요.", 409)
            sample_id = cached[0] if cached else None
            if payload is not None:
                sample_id = connection.execute("""INSERT INTO weather_samples(station_id,kind,target_time,payload_json,fetched_at)
                    VALUES (?, ?, ?, ?, ?)""", (station_id, ctx["kind"], ctx["target_time"], json.dumps(payload, ensure_ascii=False), now_kst().isoformat())).lastrowid
            column = "survey_id" if target_type == "survey" else "observation_id"
            connection.execute(f"""INSERT INTO weather_links({column},sample_id,context_json,station_json,distance_km)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT({column}) DO UPDATE SET sample_id=excluded.sample_id,
                context_json=excluded.context_json,station_json=excluded.station_json,distance_km=excluded.distance_km""",
                (target_id, sample_id, json.dumps(ctx, ensure_ascii=False), json.dumps(station, ensure_ascii=False), station["distance_km"]))
        return saved(target_type, target_id)
