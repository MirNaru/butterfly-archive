"""검증된 어른벌레 관찰로 상대 출현 적합도를 계산합니다."""
from datetime import date as CalendarDate, timedelta
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
import json
import math

from fastapi import APIRouter, HTTPException, Query

from app import regions, weather
from app.database import connect_database
from app import prediction_gdd

router = APIRouter(prefix='/api/predictions')
HALF_LIFE = 10
BANDWIDTHS = (5, 10, 15, 25)
DEFAULT_BANDWIDTH = 15
BASE_SIGMA_KM = 20
MOBILITY = {'왕나비아과': 1.6, '흰나비과': 1.25, '네발나비과': 1, '팔랑나비과': .8, '부전나비과': .6}


def annual_day(day):
    # 윤일은 2월 28일과 3월 1일 사이에 놓습니다.
    if (day.month, day.day) == (2, 29):
        return 59.5
    return CalendarDate(2001, day.month, day.day).timetuple().tm_yday


@lru_cache(maxsize=8192)
def daily_mass(delta, width):
    scale = width * math.sqrt(2)
    return sum((math.erf((delta + 365*k + .5)/scale)
                - math.erf((delta + 365*k - .5)/scale))/2 for k in (-1, 0, 1))


def weighted_days(samples, year):
    weights = Counter()
    for sample_year, day in samples:
        weights[day] += 2 ** (-(year-sample_year)/HALF_LIFE)
    total = sum(weights.values())
    return {day: weight/total for day, weight in weights.items()}


def density(day, weights, width):
    return sum(w*daily_mass(day-d, width) for d,w in weights.items())


@lru_cache(maxsize=64)
def seasonal_curve(samples, year):
    years = sorted({y for y, _ in samples})
    folds = [(y, tuple(p for p in samples if p[0] < y),
              tuple(d for yy,d in samples if yy == y)) for y in years[1:]]
    folds = [(weighted_days(train, y), Counter(valid)) for y, train, valid in folds if len(train) >= 10]
    width = DEFAULT_BANDWIDTH
    if len(folds) >= 2:
        width = min(BANDWIDTHS, key=lambda h: sum(
            -count*math.log(max(1e-15, density(d, weights, h)))
            for weights, valid in folds for d,count in valid.items()))
    weights = weighted_days(samples, year)
    curve = tuple(density(d, weights, width) for d in range(1,366))
    return curve, width


def boundary_distance(feature, latitude, longitude):
    if regions.contains(feature, latitude, longitude):
        return 0
    geometry = feature['geometry']
    polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    # 국지 접평면에서 선분상의 최근접점을 찾고 그 점까지 대권거리를 계산합니다.
    factor = math.cos(math.radians(latitude))
    best = math.inf
    for polygon in polygons:
        for ring in polygon:
            for (x1,y1),(x2,y2) in zip(ring, ring[1:]):
                dx, dy = (x2-x1)*factor, y2-y1
                length = dx*dx+dy*dy
                u = min(1,max(0,((longitude-x1)*factor*dx+(latitude-y1)*dy)/length)) if length else 0
                best = min(best, weather.distance_km(latitude, longitude, {
                    'latitude': y1+u*(y2-y1), 'longitude': x1+u*(x2-x1)}))
    return best


@dataclass(frozen=True)
class PredictionCase:
    day: CalendarDate
    points: tuple


def prediction_cases(rows):
    cases = {}
    for row in rows:
        day = CalendarDate.fromisoformat(row['observation_date'])
        payload = json.loads(row['import_payload'] or '{}')
        source_note = row['source_note'].strip()
        url = payload.get('url') or (source_note if source_note.startswith(('https://', 'http://')) else '')
        if row['source_type'] == 'direct':
            key = ('survey', row['survey_id'], day)
        elif url:
            key = ('source', url.strip(), day)
        elif row['paper_id'] is not None:
            key = ('paper', row['paper_id'], row['paper_case'], day)
        elif row['web_source_id'] is not None:
            key = ('web', row['web_source_id'], row['web_case'], day)
        else:
            key = ('survey', row['survey_id'], day)
        points = cases.setdefault(key, set())
        point = (row['latitude'], row['longitude'])
        if None not in point and row['method'] != 'approximate' and not payload.get('location_obscured'):
            points.add(point)
    return [PredictionCase(key[-1], tuple(sorted(points))) for key, points in cases.items()]


def paired_density(train, target, curve, thresholds, bandwidth):
    baseline = []
    adjusted = []
    for case in train:
        year, day = case.day.year, annual_day(case.day)
        baseline.append((year, day))
        threshold = thresholds.get(case)
        if threshold is None:
            adjusted.append((year, day))
        elif (reached := prediction_gdd.reached(curve, threshold)) is not None:
            adjusted.append((year, annual_day(reached)))
    original = weighted_days(baseline, target.year)
    # Thresholds not yet reached retain their share of the mass without inventing a date.
    total = sum(2 ** (-(target.year-year)/HALF_LIFE) for year, _ in baseline)
    shifted = Counter()
    for year, day in adjusted:
        shifted[day] += 2 ** (-(target.year-year)/HALF_LIFE) / total
    day = annual_day(target)
    return density(day, original, bandwidth), density(day, shifted, bandwidth)


def corrected_season(cases, target, point, series, bandwidth, base, start, peak):
    def curve_at(location, day):
        return prediction_gdd.cumulative(series.get(location, {}), day, base, start)

    curve = curve_at(point, target)
    if not curve or curve[-1][0] != target:
        missing = curve[-1][0] + timedelta(days=1) if curve else CalendarDate(target.year, *start)
        return None, f'예측일까지 연속 일별 기온이 부족해 날짜 분포를 사용했습니다. 최초 공백 {missing.isoformat()}'

    historical = [case for case in cases if case.day.year < target.year]
    thresholds = {}
    evaluation_curves = {}
    for case in historical:
        if len(case.points) != 1:
            continue
        observed = curve_at(case.points[0], case.day)
        if observed and observed[-1][0] == case.day:
            thresholds[case] = observed[-1][1]
            evaluation_curves[case] = observed

    folds = []
    for year in sorted({case.day.year for case in thresholds}):
        train = [case for case in historical if case.day.year < year]
        if sum(case in thresholds for case in train) < 10:
            continue
        # Each fold selects its bandwidth with data preceding that fold.
        samples = tuple((case.day.year, annual_day(case.day)) for case in train)
        _, width = seasonal_curve(samples, year)
        folds.append([paired_density(train, case.day, evaluation_curves[case], thresholds, width)
                      for case in thresholds if case.day.year == year])

    if len(folds) < 3 or len(folds[-1]) < 5:
        return None, (f'적산온도 보정을 평가할 연도 또는 독립 사례가 부족해 날짜 분포를 사용했습니다. '
                      f'연속 기온 연결 사례 {len(thresholds)}건 · 평가 가능 연도 {len(folds)}개')

    def loss(pairs, weight):
        return sum(-math.log(max(1e-15, (1-weight)*original + weight*adjusted))
                   for original, adjusted in pairs)

    tuning = [pair for fold in folds[:-1] for pair in fold]
    weight = min(prediction_gdd.WEIGHTS, key=lambda value: loss(tuning, value))
    if not weight or loss(folds[-1], weight) >= loss(folds[-1], 0):
        return None, '별도 평가 연도에서 적산온도 보정의 개선이 확인되지 않아 날짜 분포를 사용했습니다.'

    _, adjusted = paired_density(cases, target, curve, thresholds, bandwidth)
    return (adjusted / peak, weight), None


@router.get('/butterfly')
def predict(species_id: int, date: CalendarDate, latitude: float = Query(ge=-90, le=90),
            longitude: float = Query(ge=-180, le=180)):
    try:
        base, start, activity_settings = prediction_gdd.species_settings(species_id)
    except (OSError, ValueError, TypeError) as exc:
        raise HTTPException(503, '종별 예측 설정 파일을 확인해 주세요.') from exc
    with connect_database() as db:
        species = db.execute('SELECT 1 FROM species WHERE id=?', (species_id,)).fetchone()
        if not species:
            raise HTTPException(404, '선택한 종이 없습니다.')
        reference = db.execute('SELECT payload_json FROM species_references WHERE species_id=?', (species_id,)).fetchone()
        ref = json.loads(reference[0]) if reference else {}
        rows = db.execute("""SELECT
            COALESCE(o.observation_date, s.survey_date) AS observation_date,
            o.survey_id, o.source_type, o.source_note, ci.payload_json AS import_payload,
            p.paper_id, p.case_key AS paper_case, w.source_id AS web_source_id, w.case_key AS web_case,
            CASE WHEN o.place_name != '' OR o.latitude IS NOT NULL THEN o.latitude ELSE s.latitude END AS latitude,
            CASE WHEN o.place_name != '' OR o.latitude IS NOT NULL THEN o.longitude ELSE s.longitude END AS longitude,
            CASE WHEN o.place_name != '' OR o.latitude IS NOT NULL THEN o.location_method ELSE s.location_method END AS method
            FROM observations o JOIN surveys s ON s.id=o.survey_id
            LEFT JOIN collection_import_views ci ON ci.observation_id=o.id
            LEFT JOIN paper_observations p ON p.observation_id=o.id
            LEFT JOIN web_observations w ON w.observation_id=o.id
            WHERE o.species_id=? AND o.stage='adult' AND o.result='observed'
            AND o.identification='user_confirmed' AND COALESCE(o.observation_date, s.survey_date)<?
            AND NOT EXISTS (SELECT 1 FROM record_trash r WHERE r.observation_id=o.id OR r.survey_id=s.id)
            ORDER BY o.id""", (species_id, date.isoformat())).fetchall()
    cases = prediction_cases(rows)
    point = (latitude, longitude)
    locations = {point, *(location for case in cases for location in case.points)}
    observed = prediction_gdd.observed_series(locations) if cases else {}
    configured = prediction_gdd.daily_series() if cases else {}
    series = {location: {**observed.get(location, {}), **configured.get(location, {})}
              for location in locations}
    codes = set(ref.get('region_codes', [])) - set(ref.get('_region_exclusions', []))
    region_index = regions.index()
    features = [region_index[code] for code in codes if code in region_index]
    guide_distance = min((boundary_distance(feature, latitude, longitude) for feature in features), default=None)
    distances = {location: weather.distance_km(latitude, longitude,
                 {'latitude': location[0], 'longitude': location[1]}) for location in locations if location != point}
    distances[point] = 0
    record = series[point].get(date)
    forecast, forecast_run, forecast_warning = None, None, None
    if cases and (record is None or record[0] is None):
        forecast, forecast_run, forecast_warning = prediction_gdd.forecast_daily(point, date)
    if forecast is not None:
        series[point][date] = (forecast, '기상청 KIMR 예보')
    result = score_date(date, point, cases, series, observed.get(point, {}),
                      forecast, ref, len(features), guide_distance, distances,
                      base, start, activity_settings)

    if forecast_run:
        result['warnings'].append(f'KIMR 모델 실행 시각 {forecast_run} 한국 시간')
    if forecast_warning:
        result['warnings'].append(forecast_warning)
    return result


def score_date(date, point, cases, series, observed, forecast, ref, region_count,
               guide_distance, distances, base, start, activity_settings):
    samples = tuple((case.day.year, annual_day(case.day)) for case in cases)
    observation_points = {location for case in cases for location in case.points}
    temporal = bandwidth = None
    corrected = None
    correction_warning = None
    if samples:
        curve, bandwidth = seasonal_curve(samples, date.year)
        peak = max(curve)
        temporal = min(1, density(annual_day(date), weighted_days(samples, date.year), bandwidth) / peak)
        corrected, correction_warning = corrected_season(
            cases, date, point, series, bandwidth, base, start, peak)
        if corrected:
            temporal = min(1, (1-corrected[1])*temporal + corrected[1]*corrected[0])
    observation_distance = min((distances[location] for location in observation_points), default=None)
    multiplier = MOBILITY.get(ref.get('subfamily'), MOBILITY.get(ref.get('family'), 1))
    scale = BASE_SIGMA_KM * multiplier

    def proximity(distance):
        return math.exp(-.5*(distance / scale)**2) if distance is not None else None

    guide_score = proximity(guide_distance)
    observation_score = proximity(observation_distance)
    habitat = max((value for value in (guide_score, observation_score) if value is not None), default=None)
    daily_record = series[point].get(date) if samples else None
    temperature = daily_record[0] if daily_record else None
    observation_weather = observed.get(date) if samples else None
    rain, wind = observation_weather[2:] if observation_weather else (None, None)
    weather_values = {'temperature_c': temperature, 'rain_mm': rain, 'wind_m_s': wind}
    activity = (prediction_gdd.activity_score(temperature, rain, wind, settings=activity_settings)
                if any(value is not None for value in weather_values.values()) else None)
    score = (100 * temporal * habitat * (activity if activity is not None else 1)
             if temporal is not None and habitat is not None else None)
    missing = [label for label, value in zip(('기온', '강수량', '풍속'), weather_values.values()) if value is None]
    warnings = []
    if activity is None:
        warnings.append('당일 기상 자료가 없어 기상 활동 보정을 생략했습니다.')
    elif missing:
        warnings.append('기상 자료 미확보 · ' + ', '.join(missing))
    if correction_warning:
        warnings.append(correction_warning)
    if forecast is not None:
        warnings.append(f'기상청 KIMR 일평균 예보기온 {forecast:.1f}°C · 한국 시간 3시간 간격 8개 값')
    if score is None:
        warnings.append('어른벌레 관찰 날짜 또는 분포 근거가 부족합니다.')
    sources = []
    if temperature is not None:
        sources.append(daily_record[1])
    if rain is not None or wind is not None:
        sources.append(observation_weather[1])
    return {'date': date.isoformat(), **weather_values, 'occurrence_score':score, 'score_type':'relative_suitability', 'temporal_score':temporal,
            'habitat_score':habitat, 'weather_score':activity,
            'guide_distribution_score': guide_score, 'guide_distance_km': guide_distance,
            'observation_location_score': observation_score, 'observation_distance_km': observation_distance,
            'located_case_count': sum(bool(case.points) for case in cases),
            'gdd_applied':bool(corrected), 'weather_source':' · '.join(dict.fromkeys(sources)) or None,
            'model_version':'baseline-2', 'sample_count':len(samples), 'year_count':len({y for y,_ in samples}),
            'region_count':region_count, 'bandwidth_days':bandwidth, 'warnings':warnings}
