"""완전 일치 관찰을 찾아 원본을 복구 가능한 휴지통으로 이동합니다."""
from collections import defaultdict
from datetime import time
import json
from app.trash import ACTIVE_OBSERVATION
from app.vagrant_years import sync_vagrant_years


def exact_case_key(species, stage, day, clock, lat, lng, method):
    if not species or stage == 'unknown' or not clock or lat is None or lng is None or method == 'approximate':
        return None
    return json.dumps([species,stage,day,time.fromisoformat(clock).isoformat(),lat,lng], separators=(',',':'))


def exact_case_groups(db, species_ids=None):
    groups = defaultdict(list)
    if species_ids is not None and not species_ids:
        return []
    species_filter = '' if species_ids is None else f" AND o.species_id IN ({','.join('?' for _ in species_ids)})"
    for row in db.execute(f"""SELECT o.id,o.species_id,o.stage,o.observation_time,
        COALESCE(o.observation_date,s.survey_date) AS day,
        CASE WHEN o.place_name!='' OR o.latitude IS NOT NULL THEN o.latitude ELSE s.latitude END AS lat,
        CASE WHEN o.place_name!='' OR o.latitude IS NOT NULL THEN o.longitude ELSE s.longitude END AS lng,
        CASE WHEN o.place_name!='' OR o.latitude IS NOT NULL THEN o.location_method ELSE s.location_method END AS method
        FROM observations o JOIN surveys s ON s.id=o.survey_id
        LEFT JOIN collection_import_views c ON c.observation_id=o.id
        WHERE {ACTIVE_OBSERVATION} AND o.species_id IS NOT NULL AND o.stage!='unknown'
        AND o.result='observed' AND o.identification='user_confirmed' AND o.observation_time IS NOT NULL
        AND COALESCE(json_extract(c.payload_json,'$.location_obscured'),0)=0 {species_filter} ORDER BY o.id""",
        tuple(species_ids or ())):
        oid, species, stage, clock, day, lat, lng, method = row
        key = exact_case_key(species,stage,day,clock,lat,lng,method)
        if key:
            groups[key].append(oid)
    return [ids for ids in groups.values() if len(ids)>1]


def consolidate_exact_cases(db, groups, stamp):
    merged = []
    species = set()
    surveys = set()
    for ids in groups:
        marks = ','.join('?' for _ in ids)
        rows = db.execute(f"""SELECT o.id,o.survey_id,o.species_id,o.source_type,
            EXISTS(SELECT 1 FROM holdings h WHERE h.observation_id=o.id) AS holding,
            EXISTS(SELECT 1 FROM photo_links p WHERE p.observation_id=o.id OR p.survey_id=o.survey_id) AS photo,
            EXISTS(SELECT 1 FROM weather_links w WHERE w.observation_id=o.id) AS weather
            FROM observations o WHERE o.id IN ({marks})
            ORDER BY holding DESC, o.source_type='direct' DESC, photo DESC, weather DESC, o.id""", ids).fetchall()
        if sum(row[4] for row in rows)>1:
            continue
        for oid,sid,sp,*_ in rows[1:]:
            singleton = db.execute('SELECT count(*) FROM observations WHERE survey_id=?',(sid,)).fetchone()[0] == 1
            trash_id = db.execute("""INSERT INTO record_trash(kind,survey_id,observation_id,deleted_at)
                VALUES(?,?,?,?)""", ('survey' if singleton else 'observation',sid,None if singleton else oid,stamp)).lastrowid
            merged.append({'kept':rows[0][0],'original':oid,'trash':trash_id})
            species.add(sp)
            surveys.add(sid)
    db.executemany('UPDATE surveys SET updated_at=? WHERE id=?', ((stamp,sid) for sid in surveys))
    if species:
        sync_vagrant_years(db,species)
    return merged
