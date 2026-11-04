"""PC에서만 조회 사본과 별도 조회 인증 저장소를 갱신합니다."""
import json
import os
from pathlib import Path
import secrets
import sys
import threading
import time
from datetime import datetime,timezone
from fastapi import APIRouter,Request,HTTPException
from app.database import connect_database,PROJECT_ROOT
from app.collection import local_screen
from app import records,exploration,regions,holdings

sys.path.insert(0,str(PROJECT_ROOT))
import viewer_server

router=APIRouter(prefix='/api/viewer')
EXPORT_LOCK=threading.Lock()
ORIGIN=viewer_server.ORIGIN


def root():
    setting=PROJECT_ROOT/'data/viewer-deployment.json'
    override=os.environ.get('BUTTERFLY_VIEWER_ROOT')
    if override:return Path(override).resolve()
    if not setting.is_file():raise HTTPException(503,'조회 서버의 계정·권한 구성을 먼저 준비해 주세요.')
    return Path(json.loads(setting.read_text(encoding='utf-8-sig'))['root']).resolve()


@router.get('/status')
def status():
    try:directory=root()
    except HTTPException:return {'configured':False,'url':ORIGIN,'published_at':None,'sessions':[]}
    file=directory/'snapshots/current.json'
    published_at=datetime.fromtimestamp(file.stat().st_mtime,timezone.utc).isoformat() if file.is_file() else None
    with viewer_server.connect(directory) as db:
        sessions=[dict(r) for r in db.execute('SELECT label,expires FROM sessions WHERE expires>?',(time.time(),))]
    return {'configured':True,'url':ORIGIN,'published_at':published_at,'sessions':sessions}


@router.post('/connection')
def connection(request:Request):
    local_screen(request)
    code=secrets.token_hex(6).upper()
    with viewer_server.connect(root()) as db:
        db.execute('INSERT INTO config VALUES(1,1,?,?) ON CONFLICT(id) DO UPDATE SET enabled=1,code_hash=excluded.code_hash,expires=excluded.expires',(viewer_server.digest(code),time.time()+600))
    return {'code':code,'url':ORIGIN,'expires_in':600}


@router.post('/disable')
def disable(request:Request):
    local_screen(request)
    with viewer_server.connect(root()) as db:
        db.execute('UPDATE config SET enabled=0,code_hash=NULL,expires=0 WHERE id=1')
        db.execute('DELETE FROM sessions')
    return {'disabled':True}


def make_snapshot():
    directory=root()
    with EXPORT_LOCK:
        with connect_database() as db:
            db.execute('BEGIN')
            surveys=records.list_surveys(db)
            observation_regions=regions.observation_regions(db)
            catalog=[]
            for r in db.execute("SELECT s.id,s.korean_name,s.scientific_name,r.payload_json FROM species s LEFT JOIN species_references r ON s.id=r.species_id ORDER BY json_extract(r.payload_json,'$.display_order') IS NULL,json_extract(r.payload_json,'$.display_order'),s.id"):
                raw=json.loads(r['payload_json']) if r['payload_json'] else {}
                ref=regions.for_species(db,r['id'],exploration.normalized_reference(raw),observation_regions,raw)
                catalog.append({'id':r['id'],'name':r['korean_name'],'scientific_name':r['scientific_name'],'reference':ref})
            owned=[holdings.read_holding(db,r[0]) for r in db.execute('SELECT id FROM holdings ORDER BY species_id,id')]
        # 등록된 관찰의 표시 항목만 내보내며 사진 파일은 포함하지 않습니다.
        rows=[]
        for survey in surveys:
            for observation in survey['observations']:
                rows.append({key:observation.get(key) for key in ('id','species_id','species_name','source_type','source_note','effective_date','observation_time','stage','sex','count','count_estimated','capture_status','effective_place','display_place','effective_latitude','effective_longitude','administrative_region','effective_tags','notes')})
        value={'version':1,'generated_at':datetime.now(timezone.utc).isoformat(),'records':rows,'catalog':catalog,'holdings':[{k:v for k,v in h.items() if k not in ('photo_ids',)} for h in owned]}
        encoded=json.dumps(value,ensure_ascii=False,allow_nan=False).encode()
        target=directory/'snapshots/current.json'
        temp=target.with_name('snapshot-'+secrets.token_hex(8)+'.writing')
        try:
            with temp.open('xb') as handle:
                handle.write(encoded);handle.flush();os.fsync(handle.fileno())
            for attempt in range(5):
                try:os.replace(temp,target);break
                except PermissionError:
                    if attempt==4:raise
                    time.sleep(.05)
        finally:temp.unlink(missing_ok=True)
        return {'generated_at':value['generated_at'],'records':len(rows),'catalog':len(catalog),'holdings':len(owned)}


@router.post('/snapshot')
def publish(request:Request):
    local_screen(request)
    return make_snapshot()
