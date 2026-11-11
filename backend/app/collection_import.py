"""지정 종의 선택 등록과 도감 기간에 따른 단계 추정을 처리합니다."""
import json
import re
from datetime import date, datetime, time, timezone
from app.schemas import ObservationInput, SurveyInput

EXEMPT_SPECIES = frozenset('''호랑나비 산호랑나비 제비나비 산제비나비 긴꼬리제비나비 청띠제비나비 무늬박이제비나비
배추흰나비 큰줄흰나비 대만흰나비 남방노랑나비 극남노랑나비 노랑나비 갈구리나비
뿔나비 큰멋쟁이나비 작은멋쟁이나비 청띠신선나비 네발나비 먹그림나비 대왕나비 은판나비 홍점알락나비 암끝검은표범나비 어리세줄나비
줄점팔랑나비 뾰족부전나비 남방부전나비 푸른부전나비 암먹부전나비 큰주홍부전나비'''.split())
STAGES = {'egg': '알', 'larva': '애벌레', 'pupa': '번데기', 'adult': '어른벌레'}

def preserve_stage_override(old, payload):
    """재수집해도 사용자가 지정한 단계는 도감 추정으로 되돌리지 않습니다."""
    if old:
        saved=json.loads(old['payload_json'])
        if saved.get('_stage_override') in (*STAGES,'unknown'):
            payload['_stage_override']=saved['_stage_override']
        if saved.get('_species_override'):
            payload['_species_override']=saved['_species_override']
    return payload
DATE_PATTERN = re.compile(r'\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*(오전|오후)\s*(\d{1,2})시(?:\s*(\d{1,2})분)?)?\s*')

def observed_datetime(raw):
    match = DATE_PATTERN.fullmatch(raw)
    if not match:
        raise ValueError('관찰 날짜·시각을 해석하지 못했습니다.')
    year, month, day, am_pm, hour, minute = match.groups()
    observed = date(int(year), int(month), int(day))
    clock = None
    if am_pm:
        h = int(hour)
        if not 1 <= h <= 12:
            raise ValueError('관찰 시각이 올바르지 않습니다.')
        clock = time(h % 12 + (12 if am_pm == '오후' else 0), int(minute or 0))
    return observed, clock

def infer_stage(reference, observed, place):
    slot = (observed.month - 1) * 3 + min((observed.day - 1) // 10, 2) + 1
    day = (date(2000, observed.month, observed.day) - date(2000,1,1)).days + 1
    periods = reference.get('lifecycle', [])
    # 기존 어른벌레 출현 참고 기간도 동일한 36구간 기준입니다.
    if not periods:
        periods = [{**p, 'stage':'adult', 'source':reference.get('source', ''), 'enabled':True} for p in reference.get('periods', [])]
    matched = []
    for period in periods:
        if not period.get('enabled', True) or period['stage'] not in STAGES:
            continue
        if period.get('region') and period['region'] not in place:
            continue
        exact = period.get('start_day') is not None and period.get('end_day') is not None
        start, end, point = (period['start_day'], period['end_day'], day) if exact else (period['start'], period['end'], slot)
        if (start <= point <= end) if start <= end else (point >= start or point <= end):
            matched.append(period)
    stage = max((p['stage'] for p in matched), key=lambda s: list(STAGES).index(s), default='unknown')
    return {'stage':stage, 'method':'reference_period_later_stage', 'slot':slot, 'day':day,
            'matched_periods':matched, 'reference_snapshot':reference}

def registration_info(db, payload, taxon_matches=None):
    # 원문을 보존하고 줄바꿈 전 첫 국명으로 도감 종을 찾습니다.
    name = payload['korean_name'].splitlines()[0].strip()
    if payload.get('source') == 'inaturalist':
        scientific = payload.get('scientific_name', '')
        taxon_id = (payload.get('original') or {}).get('taxon', {}).get('id')
        key = (scientific, taxon_id)
        if taxon_matches is not None and key in taxon_matches:
            matches = taxon_matches[key]
        else:
            matches = db.execute('''SELECT s.id,s.korean_name FROM species s
                LEFT JOIN species_references r ON r.species_id=s.id
                WHERE s.scientific_name=? OR EXISTS (
                    SELECT 1 FROM json_each(COALESCE(r.payload_json,'{}'),'$.inaturalist_names') a
                    WHERE json_extract(a.value,'$.status')='linked'
                    AND json_extract(a.value,'$.name')=?
                    AND (? IS NULL OR json_extract(a.value,'$.taxon_id')=?)
                )''', (scientific, scientific, taxon_id, taxon_id)).fetchall()
            if taxon_matches is not None:
                taxon_matches[key] = matches
        species = matches[0] if len(matches) == 1 else None
        name = species['korean_name'] if species else name
    else:
        species = db.execute('SELECT id,korean_name FROM species WHERE korean_name=?', (name,)).fetchone()
        if species is None and payload.get('source') == 'naturing' and name == '갈고리흰나비':
            species = db.execute('SELECT id,korean_name FROM species WHERE korean_name=?', ('갈구리나비',)).fetchone()
    if payload.get('_species_override'):
        species = db.execute('SELECT id,korean_name FROM species WHERE id=?', (payload['_species_override'],)).fetchone()
    reason = ''
    observed = clock = None
    if not species:
        reason = '도감에서 종을 찾지 못했습니다.'
    try:
        if payload.get('source') == 'inaturalist':
            observed = date.fromisoformat(payload.get('observed_date') or '')
            clock = time.fromisoformat(payload['observed_time']) if payload.get('observed_time') else None
        else:
            observed, clock = observed_datetime(payload.get('observed_raw', ''))
    except (ValueError, TypeError):
        reason = reason or '관찰 날짜·시각 확인 필요'
    if not payload.get('place_raw') and payload.get('latitude') is None and not (payload.get('source') == 'naturing' and payload.get('manual_capture') is True and payload.get('location_status') in ('private_location','missing_location')):
        reason = reason or '관찰 위치 확인 필요'
    if len(payload.get('place_raw', '')) > 200:
        reason = reason or '장소명 길이 확인 필요'
    ref = db.execute('SELECT payload_json FROM species_references WHERE species_id=?', (species['id'],)).fetchone() if species else None
    inference = infer_stage(json.loads(ref[0]) if ref else {}, observed, payload.get('place_raw', '')) if observed else {'stage':'unknown'}
    if payload.get('_stage_override') in (*STAGES,'unknown'):
        inference={**inference,'original_inferred_stage':inference['stage'],'stage':payload['_stage_override'],'manual_stage_override':True}
    return {'eligible': not reason, 'reason':reason, 'exempt':False,
            'inference':inference, 'species_id':species['id'] if species else None, 'date':observed, 'time':clock}

def source_location_note(payload):
    """공개 좌표의 흐림 여부와 정확도 미상을 구분합니다."""
    if payload.get('source') != 'inaturalist':
        return ''
    accuracy = payload.get('location_accuracy')
    if payload.get('location_obscured'):
        return f'흐림 위치 · 공개 좌표 오차 {accuracy / 1000:.2f}km · 대략적 위치' if isinstance(accuracy, (int, float)) else '흐림 위치 · 공개 좌표 오차 미상 · 대략적 위치'
    return '공개 좌표 · 정확도 미상' if accuracy is None else ''


def import_item(db, row, info, payload):
    stage = info['inference']['stage']
    stage_label = STAGES.get(stage, '미확인')
    review = '사용자가 체크하여 검수 완료'
    note = f"- 성장 단계: {stage_label} · 도감 기간으로 추정, 겹치면 뒤 단계 적용\n- 동정 검수: {review}\n- 원문 관찰 시각: {payload['observed_raw']}\n- 원문 기상: {payload.get('weather_raw', '')}\n- 위치 정확도: 미상"
    if info['inference'].get('manual_stage_override'):
        note=note.replace('도감 기간으로 추정, 겹치면 뒤 단계 적용','사용자가 직접 수정')
    if payload.get('source') == 'inaturalist':
        original = payload.get('original', {})
        accuracy = payload.get('location_accuracy')
        note = note.replace('- 위치 정확도: 미상', f'- 위치 정확도: {accuracy}m' if isinstance(accuracy, (int, float)) else '- 위치 정확도: 미상')
        note += f"\n- iNaturalist 관찰 시각·시간대 원문: {original.get('time_observed_at')} · {original.get('observed_time_zone')}\n- 원문 단계 정보는 수집 스냅샷에 별도 보존합니다."
        if source_location_note(payload):
            note += '\n- ' + source_location_note(payload)
    location = dict(place_name=payload.get('place_raw', ''), latitude=payload.get('latitude'), longitude=payload.get('longitude'), location_method='unknown')
    if payload.get('source') == 'inaturalist' and payload.get('location_obscured'):
        location['location_method'] = 'approximate'
    observation = ObservationInput(**location, source_type='indirect', source_note=payload['url'], species_id=info['species_id'], observation_date=info['date'], observation_time=info['time'], stage=stage, identification='user_confirmed', notes=note)
    survey = SurveyInput(**location, survey_date=info['date'], purpose='online_research', notes=f"외부 관찰 자료 · {payload['url']}", observations=[observation])
    now = datetime.now(timezone.utc).isoformat()
    fields = survey.model_dump(mode='json', exclude={'observations','tags','photo_ids'})
    fields.update(created_at=now, updated_at=now)
    cursor = db.execute(f"INSERT INTO surveys ({', '.join(fields)}) VALUES ({', '.join('?' for _ in fields)})", tuple(fields.values()))
    values = observation.model_dump(mode='json', exclude={'tags','photo_ids'})
    values['survey_id'] = cursor.lastrowid
    cursor = db.execute(f"INSERT INTO observations ({', '.join(values)}) VALUES ({', '.join('?' for _ in values)})", tuple(values.values()))
    db.execute('INSERT INTO collection_imports(item_id,observation_id,imported_at,payload_json,inference_json) VALUES(?,?,?,?,?)',
               (row['id'], cursor.lastrowid, now, row['payload_json'], json.dumps(info['inference'],ensure_ascii=False)))
    return cursor.lastrowid
