"""완전한 일별 기온 자료로 적산온도와 도달일을 계산합니다."""
from bisect import bisect_left
import csv
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
import math
import json
import os
import re
import sqlite3
from pathlib import Path
from app.integration_settings import IntegrationError, kma_ready, request_bytes
from app.api_usage import UsageLimitError
from app.database import connect_database, database_path
from app.weather import distance_km

BASE_TEMP_C = 10.0
START_MONTH_DAY = (1, 1)
WEIGHTS = (0.0, 0.25, 0.5, 0.75, 1.0)
KST = timezone(timedelta(hours=9))
KIM_URL = 'https://apihub.kma.go.kr/api/typ06/url/nwp_nc_vars_down.php'
ACTIVITY_DEFAULTS = (24.0, 8.0, .12, .08)


def species_settings(species_id):
    path = os.environ.get('BUTTERFLY_PREDICTION_SETTINGS')
    if not path:
        return BASE_TEMP_C, START_MONTH_DAY, ACTIVITY_DEFAULTS
    record = json.loads(Path(path).read_text(encoding='utf-8-sig')).get(str(species_id), {})
    base = float(record.get('base_temperature_c', BASE_TEMP_C))
    month, day = record.get('start_month_day', START_MONTH_DAY)
    date(2001, month, day)
    activity = tuple(float(v) for v in record.get('activity', ACTIVITY_DEFAULTS))
    optimum, spread, rain_decay, wind_decay = activity
    if not all(map(math.isfinite, (base, *activity))) or spread <= 0 or min(rain_decay, wind_decay) < 0:
        raise ValueError('종별 예측 계수를 확인해 주세요.')
    return base, (month, day), activity


def forecast_cache(key, temperature=None):
    # 예보 캐시는 운영 관찰 DB와 분리해 스키마 이전 없이 사용합니다.
    path = database_path().with_name(database_path().stem + '.prediction-cache.sqlite3')
    try:
        from contextlib import closing
        with closing(sqlite3.connect(path, timeout=2)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS kim_temperature (key TEXT PRIMARY KEY, value REAL NOT NULL)')
            if temperature is not None:
                db.execute('INSERT OR REPLACE INTO kim_temperature VALUES (?,?)', (key, temperature))
                return temperature
            row = db.execute('SELECT value FROM kim_temperature WHERE key=?', (key,)).fetchone()
            return row[0] if row else None
    except sqlite3.Error:
        return temperature


def activity_score(temperature, rain=None, wind=None, settings=ACTIVITY_DEFAULTS):
    # 초기 휴리스틱이며 제공되지 않은 변수의 항은 중립으로 둡니다.
    optimum, spread, rain_decay, wind_decay = settings
    temperature_effect = -.5*((temperature-optimum)/spread)**2 if temperature is not None else 0
    return math.exp(temperature_effect
                    -rain_decay*(rain or 0)-wind_decay*(wind or 0))


def temperature_cache_key(latitude, longitude, run, lead):
    return f'KIMR-T2-v1:{latitude}:{longitude}:{run}:{lead}'


@lru_cache(maxsize=1024)
def kim_temperature(latitude, longitude, run, lead):
    key = temperature_cache_key(latitude, longitude, run, lead)
    cached = forecast_cache(key)
    if cached is not None:
        return cached
    params = dict(group='KIMR', data='U', vars='T2', tmfc=run, hf=lead,
                  lat1=latitude-.015, lat2=latitude+.015,
                  lon1=longitude-.015, lon2=longitude+.015,
                  authKey=os.environ['KMA_API_KEY'])
    raw = request_bytes('kma', KIM_URL, params).decode('ascii', errors='replace')
    shape = re.search(r'# nx=(\d+)\s+ny=(\d+)', raw)
    values = [float(value) for line in raw.splitlines() if line.strip() and not line.startswith('#')
              for value in line.split()]
    if not shape or len(values) != int(shape[1])*int(shape[2]) or not values:
        raise ValueError('KIM 격자 형식을 확인할 수 없습니다.')
    # 클릭 지점을 둘러싼 소영역의 유효한 기온을 평균합니다.
    if not all(193.15 <= value <= 333.15 for value in values):
        raise ValueError('KIM 격자에 결측 기온이 있습니다.')
    return forecast_cache(key, sum(values)/len(values)-273.15)


def forecast_daily(point, day, now=None):
    now = now or datetime.now(KST)
    if not 0 <= (day-now.date()).days <= 2:
        return None, None, 'KIMR 조회 범위 밖입니다. 저장된 관측 기온을 확인해 주세요.'
    start = datetime.combine(day, time(), KST)
    utc = min(now.astimezone(timezone.utc)-timedelta(hours=6), start.astimezone(timezone.utc))
    run = utc.replace(hour=utc.hour//12*12, minute=0, second=0, microsecond=0)
    leads = [int((start+timedelta(hours=h)-run).total_seconds()/3600) for h in range(0,24,3)]
    if min(leads) < 0 or max(leads) > 72:
        return None, None, '해당 모델 실행의 예보 시간 범위를 벗어났습니다.'
    run_key = run.strftime('%Y%m%d%H')
    run_label = run.astimezone(KST).strftime('%Y-%m-%d %H:%M')
    latitude, longitude = (round(value, 3) for value in point)
    values = []
    for hour, lead in zip(range(0,24,3), leads):
        value = forecast_cache(temperature_cache_key(latitude, longitude, run_key, lead))
        if value is None:
            if not kma_ready():
                return None, run_label, '저장된 예보가 일부 없으며 기상청 연동 설정을 확인해야 합니다.'
            try:
                value = kim_temperature(latitude, longitude, run_key, lead)
            except UsageLimitError:
                return None, run_label, '기상청 로컬 호출 한도에 도달했습니다.'
            except IntegrationError as error:
                return None, run_label, f'{hour}시 예보 조회 실패 · {error}'
            except (ValueError, OSError):
                return None, run_label, f'{hour}시 예보 자료 누락 또는 응답 형식 오류'
        values.append(value)
    return sum(values)/len(values), run_label, None


@lru_cache(maxsize=2)
def read_daily(path, modified_ns):
    series = {}
    with open(path, encoding='utf-8-sig', newline='') as source:
        for row in csv.DictReader(source):
            key = (float(row['latitude']), float(row['longitude']))
            day = date.fromisoformat(row['date'])
            temperature = float(row['temperature_c'])
            if math.isfinite(temperature) and -80 <= temperature <= 60 and row['source'].strip():
                series.setdefault(key, {})[day] = (temperature, row['source'].strip())
    return series


def daily_series():
    location = os.environ.get('BUTTERFLY_GDD_DAILY_CSV')
    if not location:
        return {}
    path = Path(location)
    try:
        return read_daily(path, path.stat().st_mtime_ns)
    except (OSError, ValueError, KeyError, csv.Error):
        return {}


def observed_series(points):
    # 기존 ASOS 일자료만 재사용합니다. 시자료 한 건을 일평균으로 간주하지 않습니다.
    with connect_database() as db:
        row = db.execute('SELECT stations_json FROM weather_stations ORDER BY as_of DESC LIMIT 1').fetchone()
        if not row:
            return {}
        stations = json.loads(row[0])
        if not stations:
            return {}
        locations = {}
        for point in points:
            if None in point:
                continue
            station = min(stations, key=lambda item: distance_km(*point, item))
            if distance_km(*point, station) <= 20:
                locations[point] = station['id']
        daily = {}
        for sample in db.execute("SELECT station_id,target_time,payload_json FROM weather_samples WHERE kind='daily' ORDER BY id"):
            values = {item['code']: item['value']
                      for item in json.loads(sample['payload_json']).get('values', [])}
            temperature = values.get('TA_AVG')
            rain = values.get('RN_DAY')
            wind = values.get('WS_AVG')
            target = datetime.strptime(sample['target_time'], '%Y%m%d').date()
            daily.setdefault(sample['station_id'], {})[target] = (
                temperature, '기상청 ASOS 일 관측',
                rain if rain is not None and rain >= 0 else None,
                wind if wind is not None and wind >= 0 else None,
            )
        return {point: daily[sid] for point,sid in locations.items() if sid in daily}


def cumulative(series, end, base=BASE_TEMP_C, start=START_MONTH_DAY):
    day = date(end.year, *start)
    result = []
    total = 0.0
    while day <= end:
        record = series.get(day)
        if record is None or record[0] is None:
            break
        total += max(0.0, record[0]-base)
        result.append((day,total))
        day += timedelta(days=1)
    return result


def reached(curve, threshold):
    index = bisect_left(curve, threshold, key=lambda point: point[1])
    return curve[index][0] if index < len(curve) else None

def collect_asos_daily(station_id, start, end):
    from app import weather
    if end < start or (end-start).days > 365 or end >= datetime.now(KST).date():
        raise ValueError('완료된 과거 관측일을 한 해 이내로 지정해 주세요.')
    targets = [(start+timedelta(days=i)).strftime('%Y%m%d') for i in range((end-start).days+1)]
    with connect_database() as db:
        cached = {r[0] for r in db.execute(
            "SELECT target_time FROM weather_samples WHERE kind='daily' AND station_id=? AND target_time BETWEEN ? AND ?",
            (station_id,targets[0],targets[-1]))}
    missing = [target for target in targets if target not in cached]
    if not missing:
        return 0
    raw = weather.fetch_text('kma_sfcdd3.php', {'tm1':missing[0], 'tm2':missing[-1], 'stn':station_id, 'help':1})
    samples = []
    for target in missing:
        try:
            payload = weather.parse_weather(raw, station_id, target, 'daily')
        except IntegrationError as error:
            if error.status == 404:
                continue
            raise
        samples.append((station_id,target,json.dumps(payload,ensure_ascii=False),datetime.now(KST).isoformat()))
    with connect_database() as db:
        db.execute('BEGIN IMMEDIATE')
        db.executemany("""INSERT INTO weather_samples(station_id,kind,target_time,payload_json,fetched_at)
            SELECT ?, 'daily', ?, ?, ? WHERE NOT EXISTS
            (SELECT 1 FROM weather_samples WHERE station_id=? AND kind='daily' AND target_time=?)""",
            [(*sample,*sample[:2]) for sample in samples])
    return len(samples)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='예측용 ASOS 일자료 수집')
    parser.add_argument('station', type=int)
    parser.add_argument('start', type=date.fromisoformat)
    parser.add_argument('end', type=date.fromisoformat)
    args = parser.parse_args()
    print(collect_asos_daily(args.station, args.start, args.end))
