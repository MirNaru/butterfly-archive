"""종과 탐사를 하나의 트랜잭션으로 저장하고 관계를 재조회합니다."""
import sqlite3
from contextlib import nullcontext
import json
from datetime import datetime, timezone
from app.database import connect_database
from app.schemas import SpeciesInput, SurveyInput, SurveyUpdate
from app.tags import names as tag_names, save_links
from app.photos import linked_ids, save_photo_links
from app.holdings import validate_observation_links
from app.trash import ACTIVE_SURVEY, ACTIVE_OBSERVATION, survey_active
from app.collection_import import observed_datetime, STAGES
from app.vagrant_years import sync_vagrant_years
from app.regions import locate as locate_region, current_label, display_location


class UnknownSpecies(ValueError):
    pass


class EditConflict(ValueError):
    pass


class InvalidObservation(ValueError):
    pass


def update_survey(survey_id: int, value: SurveyUpdate) -> dict | None:
    """기존 ID와 기상 연결을 보존하며 탐사 전체를 원자적으로 수정합니다."""
    with connect_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        original = read_survey(connection, survey_id)
        if original is None:
            return None
        if original["updated_at"] != value.expected_updated_at:
            raise EditConflict("다른 창에서 수정된 기록입니다. 입력은 유지됩니다. 변경 내용을 별도로 보관한 뒤 취소하고 목록을 새로고침해 주세요.")
        existing = {item["id"] for item in original["observations"]}
        originals = {item['id']: item for item in original['observations']}
        supplied = [item.id for item in value.observations if item.id is not None]
        if len(supplied) != len(set(supplied)) or set(supplied) != existing:
            raise InvalidObservation("기존 종별 기록을 빠짐없이 한 번씩 포함해야 합니다. 삭제는 상세 화면의 관찰 삭제 버튼을 사용해 주세요.")
        for item in value.observations:
            if item.id and item.source_type != 'indirect' and connection.execute('SELECT 1 FROM paper_observations WHERE observation_id=?', (item.id,)).fetchone():
                raise InvalidObservation('논문과 연결된 관찰은 간접 관찰 출처를 유지해야 합니다.')
            if item.species_id and not connection.execute(
                    "SELECT 1 FROM species WHERE id=?", (item.species_id,)).fetchone():
                raise UnknownSpecies("선택한 종이 없습니다. 종 목록을 새로 확인해 주세요.")
        fields = value.model_dump(mode="json", exclude={"observations", "expected_updated_at", "tags", "photo_ids"})
        fields["updated_at"] = datetime.now(timezone.utc).isoformat()
        connection.execute(f"UPDATE surveys SET {', '.join(key + '=?' for key in fields)} WHERE id=?",
                           (*fields.values(), survey_id))
        if 'tags' in value.model_fields_set:
            save_links(connection, 'survey', survey_id, value.tags)
        if 'photo_ids' in value.model_fields_set:
            save_photo_links(connection, 'survey', survey_id, value.photo_ids)
        for item in value.observations:
            fields = item.model_dump(mode="json", exclude={"id", "tags", "photo_ids"})
            if item.id is None:
                fields["survey_id"] = survey_id
                cursor = connection.execute(
                    f"INSERT INTO observations ({', '.join(fields)}) VALUES ({', '.join('?' for _ in fields)})",
                    tuple(fields.values()))
                record_id = cursor.lastrowid
            else:
                connection.execute(f"UPDATE observations SET {', '.join(key + '=?' for key in fields)} WHERE id=? AND survey_id=?",
                                   (*fields.values(), item.id, survey_id))
                record_id = item.id
            if item.id is None or 'tags' in item.model_fields_set:
                save_links(connection, 'observation', record_id, item.tags)
            if item.id is None or 'photo_ids' in item.model_fields_set:
                save_photo_links(connection, 'observation', record_id, item.photo_ids)
            validate_observation_links(connection, record_id)
            if item.id is not None and item.stage != originals[item.id]['stage']:
                imported = connection.execute('SELECT inference_json FROM collection_imports WHERE observation_id=?', (record_id,)).fetchone()
                if imported:
                    inference = json.loads(imported['inference_json'])
                    inference['manual_stage_override'] = True
                    inference['manual_stage_history'] = [*inference.get('manual_stage_history', []), {'at':datetime.now(timezone.utc).isoformat(), 'from':originals[item.id]['stage'], 'to':item.stage}]
                    connection.execute('UPDATE collection_imports SET inference_json=? WHERE observation_id=?', (json.dumps(inference,ensure_ascii=False),record_id))
                    label = f"- 발육 단계: {STAGES.get(item.stage, '미확인')} · 사용자가 직접 수정"
                    lines = item.notes.splitlines()
                    updated = [label if line.startswith('- 발육 단계:') and '도감 기간으로 추정' in line else line for line in lines]
                    if updated == lines:
                        updated.append(label)
                    connection.execute('UPDATE observations SET notes=? WHERE id=?', ('\n'.join(updated),record_id))
        sync_vagrant_years(connection)
        return read_survey(connection, survey_id)


def list_species() -> list[dict]:
    with connect_database() as connection:
        return [{"id": r['id'], "korean_name": r['korean_name'], "scientific_name": r['scientific_name'],
                 "host_plants": json.loads(r['payload_json']).get('host_plants', '') if r['payload_json'] else ''}
                for r in connection.execute(
                    "SELECT s.id, s.korean_name, s.scientific_name, r.payload_json FROM species s "
                    "LEFT JOIN species_references r ON r.species_id=s.id "
                    "ORDER BY json_extract(r.payload_json, '$.display_order') IS NULL, "
                    "json_extract(r.payload_json, '$.display_order'), s.id")]


def create_species(value: SpeciesInput) -> dict:
    with connect_database() as connection:
        cursor = connection.execute(
            "INSERT INTO species(korean_name, scientific_name, created_at) VALUES (?, ?, ?)",
            (value.korean_name, value.scientific_name or None, datetime.now(timezone.utc).isoformat()))
        return {"id": cursor.lastrowid, **value.model_dump()}


def observation_view(row, survey, tags, photos):
    record = dict(row)
    imported_payload = record.pop('imported_payload')
    imported_inference = record.pop('imported_inference')
    record['collection_accepted'] = bool(imported_inference)
    record['stage_inferred'] = bool(imported_inference and record['stage'] != 'unknown' and not json.loads(imported_inference).get('manual_stage_override') and json.loads(imported_inference).get('stage') == record['stage'])
    record.pop("survey_id")
    record['tags'] = tags
    record['photo_ids'] = photos
    record['effective_tags'] = list(dict.fromkeys([*survey['tags'], *record['tags']]))
    record["count_estimated"] = bool(record["count_estimated"])
    has_location = bool(record["place_name"]) or record["latitude"] is not None
    region_code = locate_region(record['place_name'] if has_location else survey['place_name'],
                                record['latitude'] if has_location else survey['latitude'],record['longitude'] if has_location else survey['longitude'])
    record['administrative_region_code'] = region_code
    record['administrative_region'] = current_label(region_code) if region_code else ''
    record.update(
        effective_date=record["observation_date"] or survey["survey_date"],
        effective_place=record["place_name"] if has_location else survey["place_name"],
        effective_latitude=record["latitude"] if has_location else survey["latitude"],
        effective_longitude=record["longitude"] if has_location else survey["longitude"],
    )
    record.update(display_location(record['effective_place'],record['effective_latitude'],record['effective_longitude'],region_code))
    record['source_weather'] = None
    if imported_payload:
        payload = json.loads(imported_payload)
        weather_text = payload.get('weather_raw', '').strip()
        if weather_text and weather_text != '정보가 없습니다.':
            original_date, original_time = observed_datetime(payload['observed_raw'])
            stale = (record['effective_date'] != original_date.isoformat()
                     or record['observation_time'] != (original_time.isoformat() if original_time else None)
                     or record['effective_place'] != payload.get('place_raw', '')
                     or record['effective_latitude'] != payload.get('latitude')
                     or record['effective_longitude'] != payload.get('longitude'))
            record['source_weather'] = dict(text=weather_text, source='네이처링', url=payload['url'], stale=stale)
    return record


def read_survey(connection: sqlite3.Connection, survey_id: int) -> dict | None:
    row = connection.execute("SELECT * FROM surveys WHERE id=?", (survey_id,)).fetchone()
    if row is None or not survey_active(connection, survey_id):
        return None
    survey = dict(row)
    survey['tags'] = tag_names(connection, 'survey', survey_id)
    survey['photo_ids'] = linked_ids(connection, 'survey', survey_id)
    observations = []
    for row in connection.execute(
        f"""SELECT o.*, s.korean_name AS species_name, ci.payload_json AS imported_payload, ci.inference_json AS imported_inference FROM observations o
        LEFT JOIN species s ON s.id=o.species_id LEFT JOIN collection_imports ci ON ci.observation_id=o.id
        WHERE survey_id=? AND {ACTIVE_OBSERVATION} ORDER BY o.id""", (survey_id,)):
        record = observation_view(row, survey, tag_names(connection, 'observation', row['id']), linked_ids(connection, 'observation', row['id']))
        observations.append(record)
    return {**survey, **display_location(survey['place_name'],survey['latitude'],survey['longitude']), "observations": observations}


def get_survey(survey_id: int) -> dict | None:
    with connect_database() as connection:
        return read_survey(connection, survey_id)


def list_surveys() -> list[dict]:
    """목록 전체의 연결 자료를 일괄 조회하고 단건 조회와 같은 표시 규칙을 적용합니다."""
    with connect_database() as connection:
        connection.execute("BEGIN")
        surveys = {r['id']: {**dict(r), 'tags': [], 'photo_ids': [], 'observations': []}
                   for r in connection.execute(f"SELECT s.* FROM surveys s WHERE {ACTIVE_SURVEY} ORDER BY s.survey_date DESC, s.id DESC")}
        tags, photos = {}, {}
        for row in connection.execute('SELECT x.survey_id, t.name FROM survey_tags x JOIN tags t ON t.id=x.tag_id ORDER BY t.id'):
            if row['survey_id'] in surveys:
                surveys[row['survey_id']]['tags'].append(row['name'])
        for row in connection.execute('SELECT x.observation_id, t.name FROM observation_tags x JOIN tags t ON t.id=x.tag_id ORDER BY t.id'):
            tags.setdefault(row['observation_id'], []).append(row['name'])
        for row in connection.execute('SELECT survey_id, observation_id, photo_id FROM photo_links ORDER BY photo_id'):
            if row['survey_id'] in surveys:
                surveys[row['survey_id']]['photo_ids'].append(row['photo_id'])
            if row['observation_id'] is not None:
                photos.setdefault(row['observation_id'], []).append(row['photo_id'])
        for row in connection.execute(f"""SELECT o.*, s.korean_name AS species_name,
                ci.payload_json AS imported_payload, ci.inference_json AS imported_inference
                FROM observations o LEFT JOIN species s ON s.id=o.species_id
                LEFT JOIN collection_imports ci ON ci.observation_id=o.id
                WHERE {ACTIVE_OBSERVATION} ORDER BY o.id"""):
            survey = surveys.get(row['survey_id'])
            if survey is not None:
                survey['observations'].append(observation_view(row, survey, tags.get(row['id'], []), photos.get(row['id'], [])))
        return [{**s,**display_location(s['place_name'],s['latitude'],s['longitude'])} for s in surveys.values()]


def create_survey(value: SurveyInput, connection: sqlite3.Connection | None = None) -> dict:
    values = value.model_dump(mode="json", exclude={"observations", "tags", "photo_ids"})
    now = datetime.now(timezone.utc).isoformat()
    values.update(created_at=now, updated_at=now)
    with (connect_database() if connection is None else nullcontext(connection)) as connection:
        # 열 이름은 검증된 모델에서만 가져오고 값은 매개변수로 전달합니다.
        columns = ", ".join(values)
        cursor = connection.execute(
            f"INSERT INTO surveys ({columns}) VALUES ({', '.join('?' for _ in values)})", tuple(values.values()))
        survey_id = cursor.lastrowid
        save_links(connection, 'survey', survey_id, value.tags)
        save_photo_links(connection, 'survey', survey_id, value.photo_ids)
        for item in value.observations:
            if item.species_id and not connection.execute(
                    "SELECT 1 FROM species WHERE id=?", (item.species_id,)).fetchone():
                raise UnknownSpecies("선택한 종이 없습니다. 종 목록을 새로 확인해 주세요.")
            fields = {"survey_id": survey_id, **item.model_dump(mode="json", exclude={'tags', 'photo_ids'})}
            record_cursor = connection.execute(
                f"INSERT INTO observations ({', '.join(fields)}) VALUES ({', '.join('?' for _ in fields)})",
                tuple(fields.values()))
            save_links(connection, 'observation', record_cursor.lastrowid, item.tags)
            save_photo_links(connection, 'observation', record_cursor.lastrowid, item.photo_ids)
        sync_vagrant_years(connection)
        return read_survey(connection, survey_id)
