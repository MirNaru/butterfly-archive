// 기록 삭제 확인과 휴지통 복구·완전 삭제를 처리하고 실패 시 대상을 유지합니다.
import { useEffect, useRef, useState } from 'react'
import { listTrash, restoreTrash, trashSurvey, purgeTrash } from './api'
import type { Survey, TrashEntry } from './models'

export default function TrashDialog({ target, onClose, onChanged }: { target: { survey: Survey; observationId: number | null } | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [rows, setRows] = useState<TrashEntry[]>([])
  const [loading, setLoading] = useState(!target)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [purgeTarget, setPurgeTarget] = useState<TrashEntry | null>(null)
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    if (target) return
    let active = true
    listTrash().then(values => { if (active) setRows(values) }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : '휴지통을 읽지 못했습니다.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [target])
  async function refresh() {
    setLoading(true)
    try { setRows(await listTrash()); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : '휴지통을 읽지 못했습니다.') }
    finally { setLoading(false) }
  }
  async function remove() {
    if (!target || busy) return
    setBusy(true); setError('')
    try { await trashSurvey(target.survey, target.observationId); await onChanged(); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : '삭제하지 못했습니다.') }
    finally { setBusy(false) }
  }
  async function restore(entry: TrashEntry) {
    if (busy) return
    setBusy(true); setError('')
    try { await restoreTrash(entry); setNotice('복구했습니다.'); await onChanged(); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : '복구하지 못했습니다.') }
    finally { setBusy(false) }
  }
  async function permanentlyRemove() {
    if (!purgeTarget || busy) return
    setBusy(true); setError(''); setNotice('')
    try { await purgeTrash(purgeTarget); setPurgeTarget(null); setNotice('완전 삭제했습니다.'); await onChanged(); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : '완전 삭제하지 못했습니다.') }
    finally { setBusy(false) }
  }
  const record = target?.survey.observations.find(row => row.id === target.observationId)
  return <dialog ref={dialog} className="trash-dialog" aria-label={target ? '기록 삭제 확인' : '휴지통'} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <h2>{target ? '휴지통으로 이동' : '휴지통'}</h2>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {target ? <><p>{target.survey.survey_date} · {target.survey.place_name || '좌표 지정 장소'}</p><p>{target.observationId === null ? `탐사 전체와 현재 관찰 ${target.survey.observations.length}건을 목록에서 숨깁니다.` : `${record?.species_name || '동정 미확정'} 관찰 1건을 목록에서 숨깁니다.`}</p><p className="hint">휴지통에서 복구할 수 있습니다. 사진 원본·태그·메모·저장 기상은 보존합니다. 소장 기록과 연결되어 있으면 먼저 연결을 해제해야 합니다.</p><div className="actions"><button disabled={busy} onClick={onClose}>취소</button><button className="danger" disabled={busy} onClick={() => void remove()}>{busy ? '처리 중…' : '휴지통으로 이동'}</button></div></> : <>
      <p className="hint">탐사 복구 시 따로 삭제했던 관찰은 휴지통에 남습니다. 해당 관찰도 필요하면 별도로 복구해 주세요. 완전 삭제는 앱에서 되돌릴 수 없습니다. 삭제 직전 DB 보호 복사본을 만들며 사진 파일과 소장 기록은 보존합니다.</p>
      {purgeTarget && <section role="region" aria-label="완전 삭제 확인"><h3>완전 삭제 확인</h3><p>{purgeTarget.survey_date} · {purgeTarget.place_name || '좌표 지정 장소'} · {purgeTarget.kind === 'survey' ? '탐사 전체와 따로 삭제한 관찰을 포함한 모든 관찰' : purgeTarget.species_name || '동정 미확정 관찰'}</p><p>기록과 태그·사진·저장 기상의 연결을 완전 삭제합니다. 앱에서 복구할 수 없습니다. 외부 수집 원문은 보존하고 대기함에서 제외합니다.</p><div className="actions"><button disabled={busy} onClick={() => { setPurgeTarget(null); setError('') }}>완전 삭제 취소</button><button className="danger" disabled={busy} onClick={() => void permanentlyRemove()}>{busy ? '처리 중…' : '확인한 자료 완전 삭제'}</button></div></section>}
      <button disabled={loading || busy} onClick={() => void refresh()}>휴지통 새로고침</button>
      {loading ? <p role="status">휴지통을 읽는 중입니다.</p> : <div className="trash-list">{rows.map(entry => <article key={entry.id}><strong>{entry.kind === 'survey' ? '탐사 전체' : entry.species_name || '동정 미확정 관찰'}</strong><p>{entry.survey_date} · {entry.place_name || '좌표 지정 장소'}</p><small>삭제 {new Date(entry.deleted_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</small>{entry.parent_deleted && <p className="hint">탐사 전체를 먼저 복구해 주세요.</p>}<button disabled={busy || !!purgeTarget || entry.parent_deleted} onClick={() => void restore(entry)}>복구</button><button className="danger" disabled={busy || !!purgeTarget} onClick={() => { setPurgeTarget(entry); setError(''); setNotice('') }}>완전 삭제</button></article>)}{!rows.length && !error && <p>휴지통이 비어 있습니다.</p>}</div>}
      <div className="actions"><button disabled={busy} onClick={onClose}>닫기</button></div>
    </>}
  </dialog>
}
