"""예측 날짜 좌표계와 시간 가중치 및 순환 경계를 확인합니다."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.predictions import annual_day, daily_mass, seasonal_curve, weighted_days
from app.prediction_gdd import cumulative, reached


def test_calendar_boundary_and_leap_day():
    assert annual_day(date(2024, 2, 29)) == 59.5
    assert annual_day(date(2024, 3, 1)) == annual_day(date(2023, 3, 1)) == 60
    assert abs(daily_mass(364, 10) - daily_mass(-1, 10)) < 1e-14


def test_half_life_and_bandwidth():
    assert weighted_days(((2016, 1), (2026, 2)), 2026) == {1: 1/3, 2: 2/3}
    samples = tuple((year, day) for year in (2021, 2022, 2023) for day in range(100, 112))
    curve, width = seasonal_curve(samples, 2024)
    assert len(curve) == 365
    assert width == 5


def test_gdd_does_not_fill_missing_days_or_shift_unreached_threshold():
    start, second, third, end = (date(2026, 1, day) for day in range(1, 5))
    curve = cumulative({start: (8, '시험'), second: (14, '시험'), end: (25, '시험')}, end)
    assert curve == [(start, 0), (second, 4)]
    assert reached(curve, 4) == second
    assert reached(curve, 5) is None


@pytest.mark.parametrize("explicit_date", [False, True])
def test_prediction_api_counts_independent_cases_and_filters_location(client, explicit_date):
    species = client.post('/api/species', json={'korean_name': '예측 시험종'}).json()['id']
    adult = {'species_id': species, 'stage': 'adult'}
    for day, observations in (
        ('2024-05-01', [adult, adult]),
        ('2024-05-02', [{**adult, 'source_type': 'indirect',
                         'source_note': 'https://example.test/1'}]),
        ('2024-05-02', [{**adult, 'source_type': 'indirect',
                         'source_note': 'https://example.test/1'}]),
        ('2025-05-01', [adult]),
    ):
        if explicit_date:
            observations = [{**item, 'observation_date': day, 'latitude': 37, 'longitude': 127,
                             'location_method': 'approximate'} for item in observations]
        response = client.post('/api/surveys', json={
            'survey_date': day, 'place_name': '시험 장소',
            'latitude': 37, 'longitude': 127, 'location_method': 'approximate',
            'observations': observations,
        })
        assert response.status_code == 201, response.text
    result = client.get('/api/predictions/butterfly', params={
        'species_id': species, 'date': '2025-05-01', 'latitude': 37, 'longitude': 127,
    })
    assert result.status_code == 200, result.text
    values = result.json()
    assert (values['sample_count'], values['year_count'], values['habitat_score']) == (2, 1, None)
    assert values['temporal_score'] > 0
    assert not values['gdd_applied']


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.main import app
    from app import prediction_gdd

    monkeypatch.setenv('BUTTERFLY_DB_PATH', str(tmp_path / 'prediction.sqlite3'))
    monkeypatch.delenv('BUTTERFLY_PREDICTION_SETTINGS', raising=False)
    monkeypatch.delenv('BUTTERFLY_GDD_DAILY_CSV', raising=False)
    monkeypatch.setattr(prediction_gdd, 'forecast_daily', lambda *_: (None, None, None))
    with TestClient(app) as test_client:
        yield test_client


def test_gdd_uses_target_cutoff_and_separate_validation_year():
    from app.predictions import PredictionCase, corrected_season

    point = (37, 127)
    series = {}
    cases = []
    for year, offset in [(2020, 0), (2021, 0), (2022, 30), (2023, 45),
                         (2024, 60), (2025, 30)]:
        start = date(year, 1, 1)
        for index in range(61 + offset):
            series[start + timedelta(days=index)] = (10 if index < offset else 20, '시험')
        if year < 2025:
            for index in range(56, 61):
                cases.append(PredictionCase(start + timedelta(days=index + offset), (point,)))
    target = date(2025, 1, 1) + timedelta(days=90)
    samples = tuple((case.day.year, annual_day(case.day)) for case in cases)
    curve, width = seasonal_curve(samples, target.year)
    args = (cases, target, point, {point: series}, width, 10, (1, 1), max(curve))
    correction, warning = corrected_season(*args)
    assert correction and correction[1] > 0 and warning is None, warning
    series[target + timedelta(days=1)] = (60, '예측일 이후')
    assert corrected_season(*args) == (correction, None)

    # The latest historical year contradicts the correction chosen on earlier years.
    start = date(2024, 1, 1)
    for index in range(121):
        series[start + timedelta(days=index)] = (20, '시험')
    correction, warning = corrected_season(*args)
    assert correction is None and '개선이 확인되지' in warning
    del series[target]
    correction, warning = corrected_season(*args)
    assert correction is None and '연속 일별 기온' in warning



def test_spatial_evidence_separates_guide_and_observation(client, monkeypatch):
    from app import regions
    from app.database import connect_database

    species = client.post('/api/species', json={'korean_name': '공간 근거 시험종'}).json()['id']
    feature = {'bbox': [126.9, 36.9, 127.1, 37.1], 'geometry': {'type': 'Polygon', 'coordinates': [
        [(126.9, 36.9), (127.1, 36.9), (127.1, 37.1), (126.9, 37.1), (126.9, 36.9)]
    ]}}
    response = client.post('/api/surveys', json={
        'survey_date': '2024-05-01', 'place_name': '시험 장소',
        'latitude': 37, 'longitude': 127.5, 'location_method': 'gps',
        'observations': [{'species_id': species, 'stage': 'adult'}],
    })
    assert response.status_code == 201, response.text
    with connect_database() as db:
        db.execute("INSERT INTO species_references(species_id, payload_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                   (species, '{"region_codes":["test"]}'))

    monkeypatch.setattr(regions, 'index', lambda: {'test': feature})

    def predict(longitude):
        response = client.get('/api/predictions/butterfly', params={
            'species_id': species, 'date': '2025-05-01', 'latitude': 37, 'longitude': longitude,
        })
        assert response.status_code == 200, response.text
        return response.json()

    inside = predict(127)
    assert inside['guide_distribution_score'] == inside['habitat_score'] == 1
    assert inside['guide_distance_km'] == 0
    assert inside['located_case_count'] == 1
    assert 0 < inside['observation_location_score'] < 1
    assert inside['observation_distance_km'] > 0
    at_observation = predict(127.5)
    assert at_observation['observation_location_score'] == at_observation['habitat_score'] == 1
    assert at_observation['guide_distance_km'] > 0
    assert 0 < at_observation['guide_distribution_score'] < 1


def test_prediction_uses_cached_rain_wind_and_handles_missing_weather(client):
    import json
    import math
    from app.database import connect_database

    species = client.post('/api/species', json={'korean_name': '기상 비교 시험종'}).json()['id']
    saved = client.post('/api/surveys', json={
        'survey_date': '2023-05-01', 'place_name': '시험 장소',
        'latitude': 37, 'longitude': 127, 'location_method': 'gps',
        'observations': [{'species_id': species, 'stage': 'adult'}],
    })
    assert saved.status_code == 201
    with connect_database() as db:
        db.execute("INSERT INTO weather_stations VALUES ('20240501', ?, CURRENT_TIMESTAMP)",
                   (json.dumps([{'id': 1, 'latitude': 37, 'longitude': 127}]),))
        for day, rain, wind in [('20240501', 8, 4), ('20240502', 0, None)]:
            payload = {'values': [{'code': code, 'value': value} for code, value in
                                  [('TA_AVG', 24), ('RN_DAY', rain), ('WS_AVG', wind)]]}
            db.execute("INSERT INTO weather_samples(station_id, kind, target_time, payload_json, fetched_at)"
                       " VALUES (1, 'daily', ?, ?, CURRENT_TIMESTAMP)", (day, json.dumps(payload)))

    params = {'species_id': species, 'latitude': 37, 'longitude': 127}
    path = '/api/predictions/butterfly'

    def predict(day):
        response = client.get(path, params={**params, 'date': day})
        assert response.status_code == 200, response.text
        assert response.json()['date'] == day
        return response.json()

    rainy = predict('2024-05-01')
    dry = predict('2024-05-02')
    missing = predict('2024-05-03')
    assert (rainy['rain_mm'], rainy['wind_m_s']) == (8, 4)
    assert rainy['weather_score'] == pytest.approx(math.exp(-0.12 * 8 - 0.08 * 4))
    assert dry['rain_mm'] == 0 and dry['wind_m_s'] is None and dry['weather_score'] == 1
    assert missing['weather_score'] is None
    assert missing['occurrence_score'] == pytest.approx(100 * missing['temporal_score'])

def test_kim_cache_reuses_six_slots_then_all_eight(monkeypatch):
    from datetime import datetime
    from app import prediction_gdd as gdd
    from app.api_usage import UsageLimitError

    now = datetime(2026, 11, 13, 16, tzinfo=gdd.KST)
    day = now.date()
    cache = {}
    calls = []
    monkeypatch.setattr(gdd, 'forecast_cache', cache.get)
    monkeypatch.setattr(gdd, 'kma_ready', lambda: True)

    def fetch(lat, lon, run, lead):
        calls.append(lead)
        cache[gdd.temperature_cache_key(lat, lon, run, lead)] = 20
        return 20

    monkeypatch.setattr(gdd, 'kim_temperature', fetch)
    assert gdd.forecast_daily((37.0, 127.0), day, now)[0] == 20
    assert len(calls) == 8
    for key in list(cache)[-2:]:
        del cache[key]
    calls.clear()
    assert gdd.forecast_daily((37.0, 127.0), day, now)[0] == 20
    assert len(calls) == 2
    calls.clear()
    monkeypatch.setattr(gdd, 'kma_ready', lambda: False)
    assert gdd.forecast_daily((37.0, 127.0), day, now)[0] == 20
    assert not calls
    cache.clear()
    monkeypatch.setattr(gdd, 'kma_ready', lambda: True)

    def exhausted(*args):
        raise UsageLimitError()

    monkeypatch.setattr(gdd, 'kim_temperature', exhausted)
    assert '로컬 호출 한도' in gdd.forecast_daily((37.0, 127.0), day, now)[2]
