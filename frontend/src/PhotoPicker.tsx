// 사진은 순차 검사하고, 사용자 확인 후 정보만 또는 원본 복사본으로 등록합니다.
import { useEffect, useRef, useState } from 'react'
import { inspectPhoto, lookupPhotos, registerPhotoMetadata, registerPhotoOriginal, photoLibrary } from './api'
import type { Photo, PhotoMetadata, PhotoPreview } from './models'

const PAGE_SIZE = 12
type PendingPhoto = { file: File; selected: boolean; keep: boolean; preview?: PhotoPreview; saved?: Photo; error?: string }
function Candidate({ photo, onDate, onGPS, dateLabel }: { photo: PhotoMetadata; onDate?: (p: PhotoMetadata) => void; onGPS?: (p: PhotoMetadata) => void; dateLabel?: string }) {
  return <><p className="hint">{photo.date_candidate ? `${photo.date_candidate} ${photo.time_candidate || ''}` : '촬영 시각 없음'} · {photo.latitude !== null ? 'GPS 있음' : 'GPS 없음'} · {photo.camera || '기기 미상'}</p>
    {photo.warnings.map((text, i) => <p className="hint" key={i}>{text}</p>)}
    <div className="actions">{onDate && photo.date_candidate && <button type="button" onClick={() => onDate(photo)}>{dateLabel || '날짜·시각 적용'}</button>}{onGPS && photo.latitude !== null && photo.longitude !== null && <button type="button" onClick={() => onGPS(photo)}>GPS 적용</button>}</div></>
}

export function PhotoGallery({ ids, onRemove, onDate, onGPS, dateLabel }: { ids: number[]; onRemove?: (id: number) => void; onDate?: (p: PhotoMetadata) => void; onGPS?: (p: PhotoMetadata) => void; dateLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState('')
  const effectivePage = Math.min(page, Math.max(0, Math.ceil(ids.length / PAGE_SIZE) - 1))
  const key = ids.slice(effectivePage * PAGE_SIZE, (effectivePage + 1) * PAGE_SIZE).join(',')
  const requestKey = `${retry}:${key}`
  const loading = loaded !== requestKey
  useEffect(() => {
    if (!open) return
    let active = true
    lookupPhotos(key ? key.split(',').map(Number) : []).then(rows => { if (active) { setPhotos(rows); setError('') } }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : '사진 정보를 읽지 못했습니다.') }).finally(() => { if (active) setLoaded(requestKey) })
    return () => { active = false }
  }, [key, open, requestKey])
  if (!ids.length) return null
  return <details className="photo-gallery" open={open} onToggle={e => setOpen(e.currentTarget.open)}><summary>연결 사진·촬영 정보 {ids.length}개</summary>
    {loading ? <p role="status">사진 목록을 읽는 중입니다.</p> : error ? <p className="error" role="alert">{error}<button type="button" onClick={() => setRetry(n => n + 1)}>다시 읽기</button></p> : <div className="photo-cards">{photos.map(photo => <article key={photo.id}>
      {photo.thumbnail_url && <a href={`/api/photos/${photo.id}/original`} target="_blank" rel="noreferrer"><img src={photo.thumbnail_url} alt={`${photo.filename} 미리보기`} loading="lazy" width={160} height={120} /></a>}
      <strong>{photo.filename}</strong><small>{photo.original_stored ? '증거 사진 보관' : '촬영 정보만 보관 · 원본 파일 없음'}</small>
      <Candidate photo={photo} onDate={onDate} onGPS={onGPS} dateLabel={dateLabel} />
      {onRemove && <button type="button" onClick={() => onRemove(photo.id)}>이 기록에서 연결 해제</button>}
    </article>)}</div>}
    {ids.length > PAGE_SIZE && <div className="actions"><button type="button" disabled={effectivePage === 0} onClick={() => setPage(effectivePage - 1)}>이전 사진</button><span>{effectivePage + 1} / {Math.ceil(ids.length / PAGE_SIZE)}</span><button type="button" disabled={(effectivePage + 1) * PAGE_SIZE >= ids.length} onClick={() => setPage(effectivePage + 1)}>다음 사진</button></div>}
  </details>
}

function StoredPhotos({ ids, onAdd, revision }: { ids: number[]; onAdd: (photo: Photo) => void; revision: number }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<{ total: number; items: Photo[] }>({ total: 0, items: [] })
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState('')
  const requestKey = `${page}:${revision}:${retry}`
  useEffect(() => {
    if (!open) return
    let active = true
    photoLibrary(page).then(value => { if (active) { setResult(value); setError('') } }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : '보관 목록을 읽지 못했습니다.') }).finally(() => { if (active) setLoaded(requestKey) })
    return () => { active = false }
  }, [page, requestKey, open])
  return <details className="photo-library" open={open} onToggle={e => setOpen(e.currentTarget.open)}><summary>이미 보관한 자료에서 연결</summary>
    {loaded !== requestKey ? <p role="status">보관 자료를 읽는 중입니다.</p> : error ? <p className="error" role="alert">{error}<button type="button" onClick={() => setRetry(n => n + 1)}>다시 읽기</button></p> : <><p className="hint">전체 {result.total}개 · 입력을 취소하거나 연결을 해제한 사진 자료도 여기에서 다시 연결할 수 있습니다.</p><div className="photo-cards">{result.items.map(photo => <article key={photo.id}>{photo.thumbnail_url && <img src={photo.thumbnail_url} alt={`${photo.filename} 미리보기`} loading="lazy" width={160} height={120} />}<strong>{photo.filename}</strong><small>{photo.original_stored ? '증거 사진 보관' : '촬영 정보만 보관'}</small><Candidate photo={photo} /><button type="button" disabled={ids.includes(photo.id)} onClick={() => onAdd(photo)}>{ids.includes(photo.id) ? '이 기록에 선택됨' : '이 기록에 연결'}</button></article>)}</div></>}
    {result.total > PAGE_SIZE && <div className="actions"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>이전 보관 자료</button><span>{page + 1} / {Math.ceil(result.total / PAGE_SIZE)}</span><button type="button" disabled={(page + 1) * PAGE_SIZE >= result.total} onClick={() => setPage(page + 1)}>다음 보관 자료</button></div>}
  </details>
}

export default function PhotoPicker({ name, initialIds = [], onDate, onGPS, dateLabel, onBusy }: { name: string; initialIds?: number[]; onDate: (p: PhotoMetadata) => void; onGPS: (p: PhotoMetadata) => void; dateLabel?: string; onBusy: (busy: boolean) => void }) {
  const [ids, setIds] = useState(initialIds)
  const [queue, setQueue] = useState<PendingPhoto[]>([])
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  useEffect(() => () => controller.current?.abort(), [])
  function patch(index: number, value: Partial<PendingPhoto>) { setQueue(rows => rows.map((row, i) => i === index ? { ...row, ...value } : row)) }
  async function process(register: boolean) {
    if (working) return
    const abort = new AbortController()
    controller.current = abort
    setWorking(true); onBusy(true); setError(''); setNotice('')
    let completed = 0
    const linked = new Set(ids)
    try {
      for (let index = 0; index < queue.length; index++) {
        if (abort.signal.aborted) break
        const item = queue[index]
        if (!item.selected) continue
        if (register && item.saved && (!item.keep || item.saved.original_stored)) { linked.add(item.saved.id); setIds([...linked]); continue }
        setProgress(`${register ? '등록' : '검사'} ${index + 1} / ${queue.length}`)
        try {
          if (register) {
            if (!item.preview) continue
            const photo = item.keep ? await registerPhotoOriginal(item.file, abort.signal) : await registerPhotoMetadata(item.preview.ticket, abort.signal)
            linked.add(photo.id); setIds([...linked]); patch(index, { saved: photo, error: '' }); completed++
          } else {
            if (item.file.size > 32 * 1024 * 1024) throw new Error('사진 한 장은 32MB 이하여야 합니다.')
            const preview = await inspectPhoto(item.file, abort.signal)
            patch(index, { preview, error: '' }); completed++
          }
        } catch (e) {
          if (abort.signal.aborted) break
          patch(index, { error: e instanceof Error ? e.message : '사진 처리에 실패했습니다.' })
        }
      }
      setNotice(`${abort.signal.aborted ? '중단했습니다.' : '처리를 마쳤습니다.'} 이번 ${register ? '등록' : '검사'} ${completed}개. 오류가 있는 항목은 아래에서 확인해 주세요.`)
    } finally { setWorking(false); onBusy(false); setProgress(''); controller.current = null }
  }
  return <div className="photo-picker">{ids.map(id => <input key={id} type="hidden" name={name} value={id} />)}
    <button type="button" onClick={() => setOpen(true)}>사진·촬영 정보 관리 · {ids.length}개</button>
    <dialog ref={dialog} className="photo-dialog" aria-label="사진·촬영 정보 관리" onCancel={e => { e.preventDefault(); if (!working) setOpen(false) }}>
      <header><h2>사진·촬영 정보 관리</h2><button type="button" disabled={working} onClick={() => setOpen(false)}>사진 창 닫기</button></header>
      <p className="hint">PC 안에서만 처리합니다. 기본은 정보만 보관합니다. 증거 사진 보관을 체크한 항목만 data/photo에 원본 복사본과 미리보기를 만듭니다. JPEG·PNG, 한 장 32MB·6000만 화소까지 지원합니다.</p>
      <p className="hint">검사만 하면 저장하지 않습니다. 선택 항목 등록을 누르면 사진 자료가 보관되고, 조사 저장을 눌러야 이 기록에 연결됩니다. 조사 입력을 취소해도 이미 보관한 사진 자료는 자동 삭제하지 않습니다. 같은 파일을 재등록하면 재사용합니다.</p>
      <label>검사할 사진 선택<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple disabled={working} onChange={e => {
        const files = Array.from(e.target.files || [])
        if (files.length > 2000) { setError('한 번에 2000장까지 선택해 주세요.'); return }
        setQueue(files.map(file => ({ file, selected: true, keep: false }))); setPage(0); setError(''); setNotice('')
      }} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button type="button" disabled={working || !queue.length} onClick={() => void process(false)}>촬영 정보 검사</button><button type="button" disabled={working || !queue.some(row => row.selected && row.preview)} onClick={() => void process(true)}>선택 항목 등록</button>{working && <button type="button" onClick={() => controller.current?.abort()}>처리 중단</button>}</div>
      {(progress || notice) && <p role="status">{progress || notice}</p>}
      <div className="photo-import-list">{queue.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item, offset) => { const index = page * PAGE_SIZE + offset; return <article key={index}>
        <div className="actions"><label className="check"><input type="checkbox" disabled={working} checked={item.selected} onChange={e => patch(index, { selected: e.target.checked })} />{item.file.name}</label><label className="check"><input type="checkbox" disabled={working} checked={item.keep} onChange={e => patch(index, { keep: e.target.checked })} />증거 사진 보관</label></div>
        <small>{(item.file.size / 1024 / 1024).toFixed(2)}MB · {item.saved ? item.saved.original_stored ? '원본 보관 등록 완료' : '정보 등록 완료' : item.preview ? '검사 완료 · 미등록' : '검사 전'}</small>
        {item.preview && <Candidate photo={item.preview.metadata} onDate={p => { onDate(p); setNotice('선택한 촬영 날짜를 입력란에 적용했습니다. 사진 창을 닫고 확인해 주세요.') }} onGPS={p => { onGPS(p); setNotice('GPS를 입력란에 적용하고 기존 장소명은 비웠습니다. 좌표 또는 장소명을 확인해 주세요.') }} dateLabel={dateLabel} />}
        {item.error && <p className="error" role="alert">{item.error}</p>}
      </article> })}</div>
      {queue.length > PAGE_SIZE && <div className="actions"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>이전 검사 항목</button><span>{page + 1} / {Math.ceil(queue.length / PAGE_SIZE)}</span><button type="button" disabled={(page + 1) * PAGE_SIZE >= queue.length} onClick={() => setPage(page + 1)}>다음 검사 항목</button></div>}
      <PhotoGallery ids={ids} onRemove={id => setIds(current => current.filter(key => key !== id))} onDate={onDate} onGPS={onGPS} dateLabel={dateLabel} />
      <StoredPhotos ids={ids} revision={queue.filter(row => row.saved).length} onAdd={photo => setIds(current => [...new Set([...current, photo.id])])} />
    </dialog>
  </div>
}
