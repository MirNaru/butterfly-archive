"""사용자 확인된 국내 간접 관찰로 미접의 최신 목격 연도와 근거를 갱신합니다."""
import json
import re
from datetime import datetime, timezone


DOMESTIC_TAG = '국내 관찰 확인'
DOMESTIC_ADDRESS = re.compile(
    r'^(?:대한민국|한국|South Korea|Republic of Korea|서울(?:특별시)?|부산(?:광역시)?|'
    r'대구(?:광역시)?|인천(?:광역시)?|광주(?:광역시)?|대전(?:광역시)?|울산(?:광역시)?|'
    r'세종(?:특별자치시)?|경기도?|강원(?:도|특별자치도)?|충청북도|충북|충청남도|충남|'
    r'전북(?:특별자치도)?|전라북도|전라남도|전남|경상북도|경북|경상남도|경남|'
    r'제주(?:도|특별자치도)?)(?:\s|,|$)', re.IGNORECASE)


def domestic_observation(row):
    # 관찰 자체의 위치가 하나라도 지정되었으면 탐사 위치와 섞지 않습니다.
    own_location = bool(row['place_name']) or row['latitude'] is not None
    place = row['place_name'] if own_location else row['survey_place']
    lat = row['latitude'] if own_location else row['survey_latitude']
    lng = row['longitude'] if own_location else row['survey_longitude']
    if row['domestic_confirmed']:
        return True
    if row['imported_payload']:
        payload = json.loads(row['imported_payload'])
        if payload.get('source') == 'inaturalist':
            # 원본 위치와 현재 위치가 같을 때만 원본의 국가 소속을 사용합니다.
            same_location = (place == payload.get('place_raw', '')
                             and lat == payload.get('latitude') and lng == payload.get('longitude'))
            places = payload.get('original', {}).get('place_ids')
            if same_location and isinstance(places, list) and places:
                return 6891 in places
    return bool(DOMESTIC_ADDRESS.match(place.strip()))


def sync_vagrant_years(db):
    # 목록 단위로 한 번 조회합니다. 삭제·검수 취소·종/날짜/장소 수정도 같은 규칙입니다.
    latest = {}
    rows = db.execute("""SELECT o.*, s.place_name AS survey_place,
        s.latitude AS survey_latitude,s.longitude AS survey_longitude,
        COALESCE(o.observation_date,s.survey_date) AS observed_date,
        ci.payload_json AS imported_payload,
        EXISTS(SELECT 1 FROM observation_tags ot JOIN tags t ON t.id=ot.tag_id
               WHERE ot.observation_id=o.id AND t.name=?) AS domestic_confirmed
        FROM observations o JOIN surveys s ON s.id=o.survey_id
        LEFT JOIN collection_imports ci ON ci.observation_id=o.id
        WHERE o.source_type='indirect' AND o.identification='user_confirmed'
        AND o.result='observed' AND o.species_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM record_trash t WHERE t.restored_at IS NULL
          AND ((t.kind='survey' AND t.survey_id=o.survey_id)
               OR (t.kind='observation' AND t.observation_id=o.id)))
        ORDER BY observed_date DESC,o.id DESC""", (DOMESTIC_TAG,))
    for row in rows:
        if row['species_id'] not in latest and domestic_observation(row):
            latest[row['species_id']] = row
    for reference in db.execute('SELECT * FROM species_references').fetchall():
        raw = json.loads(reference['payload_json'])
        if raw.get('vagrant') is not True:
            continue
        observation = latest.get(reference['species_id'])
        if observation is None and not raw.get('_vagrant_year_managed'):
            continue
        years = [int(observation['observed_date'][:4])] if observation else []
        evidence = (f"관찰 #{observation['id']} · {observation['observed_date']} · "
                    f"사용자 확인 · {observation['source_note']}") if observation else ''
        if (raw.get('sighting_years') == years and raw.get('sighting_source', '') == evidence
                and raw.get('_vagrant_year_managed')):
            continue
        raw.update(sighting_years=years, sighting_source=evidence, _vagrant_year_managed=True)
        db.execute('UPDATE species_references SET payload_json=?,updated_at=? WHERE species_id=?',
                   (json.dumps(raw, ensure_ascii=False), datetime.now(timezone.utc).isoformat(), reference['species_id']))
