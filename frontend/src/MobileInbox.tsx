// 휴대폰 연결과 사진 정보 대기함을 PC에서 검수하고 직접 관찰로 등록합니다.
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { mobileStatus, mobileConnection, mobileDisable, mobileRevoke, mobilePhotos, mobileDiscard, mobileRegister } from './api'
import type { MobilePhoto } from './api'
import ViewerControls from './ViewerControls'
import { STAGE, type Species, type Survey } from './models'

function RegisterPhotos({items,species,onClose,onSaved}:{items:MobilePhoto[];species:Species[];onClose:()=>void;onSaved:(s:Survey)=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const dates=new Set(items.map(i=>i.metadata.date_candidate)), locations=new Set(items.map(i=>`${i.metadata.latitude},${i.metadata.longitude}`))
  const first=items[0].metadata
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close()},[])
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setBusy(true);setError('')
    const data=new FormData(event.currentTarget),text=(key:string)=>String(data.get(key)||'').trim(),number=(key:string)=>text(key)?Number(text(key)):null
    try{
      const latitude=number('latitude'),longitude=number('longitude'),place_name=text('place_name')
      const location={latitude,longitude,place_name,location_method:latitude===null?'unknown' as const:'manual' as const}
      const survey=await mobileRegister(items.map(i=>i.id),{...location,survey_date:text('date'),purpose:'general',tags:[],photo_ids:[],notes:text('notes'),observations:[{...location,source_type:'direct',source_note:'내 사진 · 휴대폰 메타데이터 전송',species_id:number('species'),result:'observed',observation_date:text('date'),observation_time:text('time')||null,stage:text('stage') as keyof typeof STAGE,sex:'unknown',count:null,count_estimated:false,identification:'user_confirmed',capture_status:'unknown',captured_count:null,tags:[],photo_ids:[],notes:''}]})
      await onSaved(survey)
    }catch(e){setError(e instanceof Error?e.message:'등록에 실패했습니다.')}
    finally{setBusy(false)}
  }
  return <dialog ref={dialog} className="mobile-review-dialog" onCancel={e=>{e.preventDefault();if(!busy)onClose()}}><form onSubmit={save}><h2>사진 {items.length}장 · 직접 관찰 등록</h2><p className="hint">같은 관찰 사례의 사진만 한 기록으로 묶어 주세요. 원문 촬영 정보는 사진별로 보존합니다. 모르는 종·날짜·위치는 확인 후 입력해 주세요.</p>{(dates.size>1||locations.size>1)&&<p className="notice">선택한 사진의 날짜 또는 좌표가 서로 다릅니다. 같은 사례인지 확인하고 사용할 값을 직접 입력해 주세요.</p>}<fieldset disabled={busy}><label>종<select name="species" required><option value="">종 선택</option>{species.map(s=><option key={s.id} value={s.id}>{s.korean_name}</option>)}</select></label><div className="field-grid"><label>관찰 날짜<input name="date" type="date" required defaultValue={dates.size===1?first.date_candidate||'':''}/></label><label>관찰 시각 · 선택<input name="time" type="time" step="1" defaultValue={items.length===1?first.time_candidate||'':''}/></label><label>성장 단계<select name="stage" defaultValue="unknown">{Object.entries(STAGE).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div><label>장소명<input name="place_name" maxLength={200}/></label><div className="field-grid"><label>위도<input name="latitude" type="number" min={-90} max={90} step="any" defaultValue={locations.size===1?first.latitude??'':''}/></label><label>경도<input name="longitude" type="number" min={-180} max={180} step="any" defaultValue={locations.size===1?first.longitude??'':''}/></label></div><label>메모<textarea name="notes" maxLength={5000}/></label>{error&&<p role="alert" className="error">{error}</p>}<div className="mobile-actions"><button type="button" onClick={onClose}>취소</button><button className="primary">{busy?'등록 중':'직접 관찰로 등록'}</button></div></fieldset></form></dialog>
}

export default function MobileInbox({species,onRegistered,onEditing}:{species:Species[];onRegistered:(s?:Survey[])=>Promise<void>;onEditing:(v:boolean)=>void}) {
  const [status,setStatus]=useState<Awaited<ReturnType<typeof mobileStatus>>|null>(null)
  const [code,setCode]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [items,setItems]=useState<MobilePhoto[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[revision,setRevision]=useState(0)
  const [selected,setSelected]=useState<Set<number>>(new Set()),[working,setBusy]=useState(false),[editing,setEditing]=useState<MobilePhoto[]|null>(null),[confirmDelete,setConfirmDelete]=useState(false)
  const [loaded,setLoaded]=useState('')
  const requestKey=page+':'+revision
  const busy=working||loaded!==requestKey
  const refresh=()=>{setSelected(new Set());setConfirmDelete(false);setRevision(n=>n+1)}
  useEffect(()=>{
    let active=true
    Promise.all([mobileStatus(),mobilePhotos(page)]).then(([state,list])=>{if(active){const last=Math.max(0,Math.ceil(list.total/25)-1);if(page>last){setPage(last);return}setStatus(state);setItems(list.items);setTotal(list.total);setError('')}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'목록 조회 실패')}).finally(()=>{if(active)setLoaded(requestKey)})
    return()=>{active=false}
  },[page,revision,requestKey])
  async function action(work:()=>Promise<unknown>){setBusy(true);setError('');try{await work();refresh()}catch(e){setError(e instanceof Error?e.message:'요청 실패')}finally{setBusy(false)}}
  const all=items.length>0&&items.every(i=>selected.has(i.id))
  return <section className="mobile-inbox"><ViewerControls /><details className="mobile-connection"><summary>집 안 휴대폰 연결·관리</summary><p>{status?.url ? <a href={status.url} target="_blank" rel="noreferrer">{status.url}</a> : '집 안 전송 서버 설정이 필요합니다.'}</p><p className="hint">집 Wi-Fi에 연결된 휴대폰에서 위 주소를 열고 아래 코드를 입력하세요. 외부 조회용 코드는 별도입니다. 코드는 10분 동안 한 번 사용할 수 있습니다. 연결은 30일 뒤 만료됩니다.</p><div className="mobile-actions"><button disabled={busy} onClick={()=>void action(async()=>{const value=await mobileConnection();setCode(value.code);setNotice('연결 코드를 발급했습니다. 휴대폰에서 입력해 주세요.')})}>연결 코드 발급</button><button disabled={busy||!status?.enabled} onClick={()=>void action(async()=>{await mobileDisable();setCode('');setNotice('모든 휴대폰의 연결을 해제했습니다.')})}>모든 연결 해제</button></div>{code&&<p className="mobile-code">{code}</p>}<p className="hint">전송 {status?.enabled?'허용됨':'중지됨'} · 접속용 서버가 실행 중이어야 합니다.</p>{status?.sessions.map(s=><p key={s.id}>{s.label} · {new Date(s.expires*1000).toLocaleDateString('ko-KR')}까지 <button disabled={busy} onClick={()=>void action(()=>mobileRevoke(s.id))}>연결 해제</button></p>)}</details>
  <div className="mobile-actions"><h3>사진 정보 · {total}건</h3><button disabled={busy} onClick={refresh}>목록 새로고침</button><button disabled={busy||!items.length} onClick={()=>setSelected(all?new Set():new Set(items.map(i=>i.id)))}>{all?'현재 페이지 선택 해제':'현재 페이지 전체 선택'}</button><button disabled={busy||!selected.size} onClick={()=>{setEditing(items.filter(i=>selected.has(i.id)));onEditing(true)}}>선택 사진 관찰 등록 · {selected.size}장</button><div><button disabled={busy||!selected.size} onClick={()=>setConfirmDelete(true)}>선택 자료 삭제 · {selected.size}건</button>{confirmDelete&&<div><p>대기함에서 선택 자료를 삭제할까요?</p><button disabled={busy} onClick={()=>void action(()=>mobileDiscard([...selected]))}>삭제 확인</button><button disabled={busy} onClick={()=>setConfirmDelete(false)}>취소</button></div>}</div></div><p className="hint">메타데이터만 전송된 자료입니다. PC에서 종·성장 단계·촬영 날짜·좌표를 확인해 주세요. 현재 페이지의 사진을 선택해 같은 사례 한 건으로 등록할 수 있습니다. 삭제해도 원본 사진은 휴대폰에 남습니다.</p>
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{busy&&<p role="status">처리 중입니다.</p>}
  <div className="table-wrap"><table className="collection-table"><thead><tr><th><input type="checkbox" aria-label="사진 현재 페이지 전체 선택" checked={all} disabled={busy||!items.length} onChange={e=>setSelected(e.target.checked?new Set(items.map(i=>i.id)):new Set())}/></th><th>사진 파일</th><th>촬영 시각</th><th>촬영 좌표</th><th>확인 사항</th><th>전송 기기</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td><input type="checkbox" aria-label={`${i.metadata.filename} 선택`} checked={selected.has(i.id)} disabled={busy} onChange={e=>setSelected(current=>{const next=new Set(current);if(e.target.checked)next.add(i.id);else next.delete(i.id);return next})}/></td><td>{i.metadata.filename}<small>{(i.metadata.size_bytes/1024/1024).toFixed(1)}MB · {i.metadata.camera||'기기 정보 없음'}</small></td><td>{i.metadata.date_candidate||'날짜 없음'} {i.metadata.time_candidate}<small>원문 {i.metadata.taken_at_raw||'없음'} · {i.metadata.offset_raw||'시간대 없음'}</small></td><td>{i.metadata.latitude===null?'좌표 없음':`${i.metadata.latitude}, ${i.metadata.longitude}`}</td><td className="memo-cell">{i.metadata.warnings.join(' / ')||'PC에서 원본 파일 미검증'}</td><td>{i.device_label}<small>{new Date(i.received_at).toLocaleString('ko-KR')}</small></td></tr>)}</tbody></table></div>{!busy&&!items.length&&<p>전송된 사진 정보가 없습니다.</p>}<div className="mobile-actions"><button disabled={busy||page===0} onClick={()=>{setPage(n=>n-1);setSelected(new Set())}}>이전</button><span>{page+1} / {Math.max(1,Math.ceil(total/25))}</span><button disabled={busy||(page+1)*25>=total} onClick={()=>{setPage(n=>n+1);setSelected(new Set())}}>다음</button></div>
  {editing&&<RegisterPhotos items={editing} species={species} onClose={()=>{setEditing(null);onEditing(false)}} onSaved={async survey=>{await onRegistered([survey]);setEditing(null);onEditing(false);setNotice('직접 관찰로 등록했습니다.');refresh()}}/>}</section>
}
