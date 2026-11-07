// 상세 화면에서 연결 사진을 순서대로 보고 WebP 사본을 확대합니다.
import {useEffect,useRef,useState} from 'react'
import {lookupPhotos} from './api'
import type {Photo} from './models'
export default function DetailPhotos({ids}:{ids:number[]}) {
  const [index,setIndex]=useState(0),[photos,setPhotos]=useState<Photo[]>([]),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  const [expanded,setExpanded]=useState(false)
  const zoom=useRef<HTMLDialogElement>(null)
  const current=Math.min(index,Math.max(0,ids.length-1)),id=ids[current],key=id?String(id):''
  useEffect(()=>{
    let active=true
    if(!key)return
    lookupPhotos(key.split(',').slice(0,24).map(Number)).then(p=>{if(active){setPhotos(p);setError('')}}).catch(()=>{if(active)setError('사진 정보를 읽지 못했습니다.')})
    return()=>{active=false}
  },[key,retry])
  const photo=photos.find(p=>p.id===id)
  return <section className="detail-photo-panel"><h3>사진</h3>{!ids.length?<p className="hint">연결된 사진이 없습니다.</p>:<>
    <div className="detail-photo-controls"><button type="button" aria-label="이전 사진" disabled={current===0} onClick={()=>setIndex(current-1)}>←</button><span>{current+1} / {ids.length}</span><button type="button" aria-label="다음 사진" disabled={current>=ids.length-1} onClick={()=>setIndex(current+1)}>→</button><button type="button" disabled={!photo?.original_stored} onClick={()=>{setExpanded(true);zoom.current?.showModal()}}>확대</button></div>
    {photo?.original_stored?<img key={`${id}:${retry}`} src={`/api/photos/${id}/display`} alt={photo.filename} onError={()=>setError('사진을 표시하지 못했습니다. 서버 적용 상태와 보관 파일을 확인해 주세요.')} />:photo?<p className="hint">촬영 정보만 등록된 사진입니다. 사진·촬영 정보 관리에서 원본 보관을 선택해 주세요.</p>:<p role="status">사진 정보를 읽는 중입니다.</p>}
    {error&&<p role="alert">{error}<button type="button" onClick={()=>{setError('');setRetry(n=>n+1)}}>다시 읽기</button></p>}
    <dialog ref={zoom} className="detail-photo-zoom" onCancel={e=>e.stopPropagation()} onClose={()=>setExpanded(false)}><button type="button" onClick={()=>zoom.current?.close()}>확대 닫기</button>{expanded&&photo?.original_stored&&<img src={`/api/photos/${id}/display`} alt={photo.filename}/>}</dialog>
  </>}</section>
}
