"""등록된 관찰의 누락 기상을 단일 백그라운드 작업에서 연결합니다."""
import json
import logging
from collections import defaultdict
from threading import Lock, Thread
from time import sleep

from app import weather, weather_store
from app.api_usage import now_kst, usage, UsageLimitError
from app.database import connect_database
from app.integration_settings import IntegrationError, kma_ready
from app.regions import locate_point
from app.trash import ACTIVE_OBSERVATION

lock = Lock()
progress = dict(running=False, total=0, saved=0, skipped=0, missing=0, pending=0)
missing_until = {}


def status():
    with lock:
        return dict(progress)


def candidates(limit):
    today = now_kst().date()
    with connect_database() as db:
        rows = db.execute(f"""SELECT o.id, COALESCE(o.observation_date,s.survey_date) AS day,
            o.observation_time AS time,
            CASE WHEN o.place_name!='' OR o.latitude IS NOT NULL THEN o.place_name ELSE s.place_name END AS place,
            CASE WHEN o.place_name!='' OR o.latitude IS NOT NULL THEN o.latitude ELSE s.latitude END AS lat,
            CASE WHEN o.place_name!='' OR o.latitude IS NOT NULL THEN o.longitude ELSE s.longitude END AS lng,
            CASE WHEN o.place_name!='' OR o.latitude IS NOT NULL THEN o.location_method ELSE s.location_method END AS method
            FROM observations o JOIN surveys s ON s.id=o.survey_id
            LEFT JOIN collection_import_views ci ON ci.observation_id=o.id
            WHERE {ACTIVE_OBSERVATION} AND o.result='observed'
            AND NOT EXISTS(SELECT 1 FROM weather_links w WHERE w.observation_id=o.id)
            AND COALESCE(json_extract(ci.payload_json,'$.location_obscured'),0)=0
            AND COALESCE(json_extract(ci.payload_json,'$.location_accuracy'),0)<=5000
            AND TRIM(COALESCE(json_extract(ci.payload_json,'$.weather_raw'),'')) IN ('','정보가 없습니다.')
            AND COALESCE(o.observation_date,s.survey_date) < ?
            ORDER BY o.id DESC""", (today.isoformat(),)).fetchall()
    groups = defaultdict(list)
    count = 0
    for row in rows:
        if missing_until.get(row['id']) == today:
            continue
        if row['lat'] is None or row['lng'] is None or row['method']=='approximate':
            continue
        if not locate_point(row['lat'], row['lng']):
            continue
        ctx = weather_store.time_context(dict(date=row['day'], time=row['time'],
            latitude=row['lat'], longitude=row['lng'], place=row['place']))
        groups[ctx['kind'],ctx['target_time']].append((row['id'], ctx))
        count += 1
        if count == limit:
            break
    return groups


def add_counts(**counts):
    with lock:
        for key, value in counts.items():
            progress[key] += value


def ensure_budget():
    remaining = next(row for row in usage() if row['service']=='kma')
    if remaining['today'] >= remaining['daily_limit'] - 100:
        raise UsageLimitError()


def collect_group(kind, target, entries):
    # 같은 시각의 관측값은 ASOS 전체 지점 응답 한 건으로 확인합니다.
    ensure_budget()
    stations = weather_store.station_list(entries[0][1])
    endpoint = 'kma_sfctm2.php' if kind=='hourly' else 'kma_sfcdd.php'
    with connect_database() as db:
        samples = {row['station_id']:json.loads(row['payload_json']) for row in db.execute(
            'SELECT station_id,payload_json FROM weather_samples WHERE kind=? AND target_time=? ORDER BY id',
            (kind,target))}
    text = None
    for oid, ctx in entries:
        ordered = sorted(({**s,'distance_km':weather.distance_km(ctx['latitude'],ctx['longitude'],s)}
                          for s in stations), key=lambda s: (s['distance_km'], s['id']))
        for station in ordered[:3]:
            sid = station['id']
            if sid not in samples:
                if text is None:
                    text = weather.fetch_text(endpoint, {'tm':target, 'stn':0, 'help':1})
                try:
                    samples[sid] = weather.parse_weather(text,sid,target,kind)
                except IntegrationError as error:
                    if error.status != 404:
                        raise
                    samples[sid] = None
            payload = samples[sid]
            if payload and any(value['value'] is not None for value in payload['values']):
                saved = weather_store.save_automatic(oid,ctx,station,payload)
                add_counts(**{('saved' if saved else 'skipped'):1})
                break
        else:
            missing_until[oid] = now_kst().date()
            add_counts(missing=1)


def run(limit):
    try:
        groups = candidates(limit)
        add_counts(total=sum(map(len,groups.values())))
        for (kind,target), entries in groups.items():
            try:
                collect_group(kind,target,entries)
            except IntegrationError as error:
                if error.status == 404:
                    missing_until.update((oid, now_kst().date()) for oid, _ in entries)
                    add_counts(missing=len(entries))
                    continue
                # 미처리 기록은 다음 진입 시 저장 상태에서 다시 찾습니다.
                logging.getLogger(__name__).warning('Weather queue paused with provider status %s', error.status)
                break
            except UsageLimitError:
                break
            sleep(0.08)
    except Exception:
        logging.getLogger(__name__).exception('Weather queue stopped')
    finally:
        with lock:
            progress['pending'] = progress['total'] - progress['saved'] - progress['skipped'] - progress['missing']
            progress['running'] = False


def start(limit=15000):
    with lock:
        if not progress['running'] and kma_ready():
            progress.update(running=True,total=0,saved=0,skipped=0,missing=0,pending=0)
            Thread(target=run,args=(limit,),daemon=True,name='weather-queue').start()
        return dict(progress)
