// 도감 조회 화면은 편집과 분리하고 사진·단계별 동정 근거를 읽기 전용으로 표시합니다.
import {useEffect,useRef,useState} from 'react'
import type {ReferenceDocument,Species,Photo} from './models'
import {speciesPhotos} from './api'
import DetailPhotos from './DetailPhotos'
import {SpeciesDetails} from './SpeciesDetails'
import {LIFE_STAGES,periodLabel} from './lifeCycle'
import {speciesStatuses} from './speciesStatus'

export default function SpeciesInfoModal({species,document,onClose,onEdit}:{species:Species;document:ReferenceDocument;onClose:()=>void;onEdit:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),ref=document.reference
  const [page,setPage]=useState(0),[result,setResult]=useState<{total:number;items:Photo[]}>({total:0,items:[]}),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close()},[])
  useEffect(()=>{let active=true;speciesPhotos(species.id,page).then(r=>{if(active){setResult(r);setError('')}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'사진 목록을 읽지 못했습니다.')});return()=>{active=false}},[species.id,page,retry])
  const flag=(value:boolean|null)=>value===null?'미확인':value?'예':'아니요'
  const fields=[['습성',ref.habits],['생태 출처',ref.ecology_source],['분포',ref.regions.join(', ')],['출현·분포 출처',ref.source],['목격 연도',ref.sighting_years.join(', ')],['목격 근거',ref.sighting_source],['과',ref.family],['아과',ref.subfamily],['분류 근거',ref.taxonomy_source],['상태 메모',ref.status_notes],['보호 근거',ref.protection_source],['채집 이력 근거',ref.capture_source],['채집 허가 근거',ref.permission_source],['북한 서식',flag(ref.north_only)],['미접',flag(ref.vagrant)],['국내 절멸',flag(ref.domestic_extinct)],['절멸 근거',ref.extinction_source],['국가보호종 해당',flag(ref.protected)],['보호정보 확인일',ref.protection_checked],['보호정보 검토',ref.protection_review],['채집 이력',({unknown:'미확인',captured:'채집 확인',not_captured:'미채집'})[ref.capture_history]],['채집 가능 여부',({unknown:'미확인',permitted:'가능 · 사용자 확인',prohibited:'불가 · 사용자 확인'})[ref.permission]],['허가 지역',ref.permission_region],['허가 기간',[ref.permission_start,ref.permission_end].filter(Boolean).join(' ~ ')],['도감 표시 순서',ref.display_order===null?'미지정':String(ref.display_order)]]
  return <dialog ref={dialog} className="species-info-dialog" aria-label={`${species.korean_name} 기본 정보`} onCancel={onClose}>
    <header><div><h2>{species.korean_name}</h2><i>{species.scientific_name||'학명 미등록'}</i></div><div className="actions"><button type="button" onClick={onEdit}>편집</button><button type="button" onClick={onClose}>닫기</button></div></header>
    <div className="species-info-body"><section><h3>대표사진</h3><DetailPhotos ids={ref.representative_photo_id?[ref.representative_photo_id]:[]}/></section>
    <section><h3>동정 포인트</h3><p className="memo">{ref.identification_points||'기존 공통 동정 포인트 미등록'}</p>{ref.identification_source&&<small>출처: {ref.identification_source}</small>}
      {LIFE_STAGES.map(stage=>{const item=ref.stage_identification?.find(p=>p.stage===stage.key);return <details key={stage.key}><summary>{stage.label}</summary><p className="memo">{item?.points||'미등록'}</p>{item?.source&&<small>출처: {item.source}</small>}<DetailPhotos ids={item?.photo_ids||[]}/></details>})}</section>
    <section><h3>기주식물</h3><p className="memo">{ref.host_plants||'미등록'}</p>{ref.host_plants_source&&<p className="hint memo">출처: {ref.host_plants_source}</p>}</section>
    <section><h3>서식지</h3><p className="memo">{ref.habitat||'미등록'}</p></section>
    <section><h3>세부 정보</h3><SpeciesDetails entries={ref.details||[]} legacy={ref.other_notes} legacySource={ref.ecology_source}/></section>
    <section><h3>등록 사진 모아보기 · {result.total}개</h3><p className="hint">이 종의 관찰·탐사 공통 사진과 지정한 도감 사진입니다. 탐사 공통 사진이 모두 해당 종을 촬영했다는 뜻은 아닙니다.</p>{error?<p role="alert">{error}<button type="button" onClick={()=>setRetry(n=>n+1)}>다시 읽기</button></p>:<DetailPhotos key={page} ids={result.items.map(p=>p.id)}/>}<div className="actions"><button type="button" disabled={page===0} onClick={()=>setPage(p=>p-1)}>이전</button><span>{page+1} / {Math.max(1,Math.ceil(result.total/12))}</span><button type="button" disabled={(page+1)*12>=result.total} onClick={()=>setPage(p=>p+1)}>다음</button></div></section>
    <section><h3>상태</h3><div className="species-statuses">{speciesStatuses(ref).map((s,i)=><span className={`status-${s.tone}`} key={i} title={s.detail}>{s.label}</span>)}</div></section>{fields.map(([label,value])=><section key={label}><h3>{label}</h3><p className="memo">{value||'미등록'}</p></section>)}
    <section><h3>보호 지정</h3>{ref.protections.length?ref.protections.map((p,i)=><p key={i}>{p.designation||({endangered_i:'멸종위기 I급',endangered_ii:'멸종위기 II급',monument:'천연기념물',regional:'지역보호'})[p.kind]} · {p.region||'국가 지정'} · {p.source} · {p.checked}</p>):<p>미등록</p>}</section><section><h3>제공자 연결 학명</h3>{ref.inaturalist_names?.map((n,i)=><p key={i}>{n.name} · {n.status==='linked'?'사용자 연결':'검토 중'} · {n.source}</p>)}</section><section><h3>한살이 기간</h3>{ref.lifecycle.filter(p=>p.enabled).map(p=><p key={p.id}>{LIFE_STAGES.find(s=>s.key===p.stage)?.label} · {periodLabel(p)} · {p.region||'지역 미지정'} · {p.source}</p>)}</section></div>
  </dialog>
}
