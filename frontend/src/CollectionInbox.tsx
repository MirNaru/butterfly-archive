// 확장 연결 키 발급과 외부 관찰 자료의 검토 대기 목록을 표시합니다.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { collectionItems, createCollectionConnection, registerCollected, discardCollected, editCollectedStage, listSpecies } from './api'
import { STAGE, type Survey, type Species, type CollectedItem } from './models'
import InaturalistControls from './InaturalistControls'
import SpeciesPicker from './SpeciesPicker'

export default function CollectionInbox({ onRegistered, source = 'naturing', remoteTarget }: { remoteTarget?: HTMLDivElement | null; onRegistered: (surveys?: Survey[]) => Promise<void>; source?: 'naturing' | 'inaturalist' }) {
  const [items, setItems] = useState<CollectedItem[]>([])
  const [species, setSpecies] = useState<Species[]>([])
  const [speciesId, setSpeciesId] = useState('')
  const [sort, setSort] = useState<'default' | 'asc' | 'desc'>('default')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [working, setBusy] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [editing,setEditing]=useState<CollectedItem|null>(null)
  const [stage,setStage]=useState<keyof typeof STAGE>('unknown')
  const [stageSaving,setStageSaving]=useState(false)
  const [stageLoading,setStageLoading]=useState(false)
  const [stageError,setStageError]=useState('')
  const busy = working || fetching || stageSaving || stageLoading
  async function openStage(item:CollectedItem) {
    if(busy)return
    setStageLoading(true);setError('')
    try {
      const options=await listSpecies()
      setSpecies(options)
      setSpeciesId(item.species_id ? String(item.species_id) : '')
      setStage(item.inferred_stage);setStageError('');setEditing(item)
    } catch(e) {setError(e instanceof Error?e.message:'종 목록을 읽지 못했습니다. 다시 시도해 주세요.')}
    finally {setStageLoading(false)}
  }
  async function saveStage() {
    if(!editing||stageSaving)return
    setStageSaving(true);setStageError('')
    try {
      const saved=await editCollectedStage(editing,stage,speciesId ? Number(speciesId) : undefined)
      reload()
      setNotice(`${species.find(s=>s.id===Number(speciesId))?.korean_name || editing.korean_name} · ${STAGE[saved.stage]}로 수정했습니다. 선택 후 관찰 기록에 추가할 수 있습니다.`)
      setEditing(null)
    } catch(e) {setStageError(e instanceof Error?e.message:'단계 수정에 실패했습니다.')}
    finally {setStageSaving(false)}
  }
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const selectable = items
  const registrationIds = items.filter(item => selected.has(item.id) && item.eligible && item.observation_id === null).map(item => item.id)
  const allSelected = selectable.length > 0 && selectable.every(item => selected.has(item.id))
  function reload() { setSelected(new Set()); setConfirmDelete(false); setRevision(n => n + 1) }
  async function remove() {
    setBusy(true); setError('')
    try {
      const result = await discardCollected([...selected])
      setNotice(`수집 목록에서 ${result.ids.length}건 삭제했습니다. 등록된 관찰 기록은 유지됩니다.`)
      reload()
    } catch (e) { setError(e instanceof Error ? e.message : '삭제 실패') }
    finally { setBusy(false) }
  }
  async function register() {
    setBusy(true); setError(''); setNotice('')
    try {
      const {results,surveys} = await registerCollected(registrationIds)
      const added = results.filter(r => r.status === 'registered').length
      const skipped = results.filter(r => r.status === 'skipped')
      setNotice(`간접 관찰 ${added}건 등록 · 기존 등록 ${results.filter(r => r.status === 'already_registered').length}건 · 제외 ${skipped.length}건${skipped.length ? '\n' + skipped.map(r => `자료 ${r.id}: ${r.reason}`).join('\n') : ''}`)
      reload(); await onRegistered(surveys)
    } catch (e) { setError(e instanceof Error ? e.message : '등록 실패') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    let active = true
    setBusy(true); setError('')
    collectionItems(page, source, sort).then(result => { if (active) {
      const lastPage = Math.max(0, Math.ceil(result.total / 25) - 1)
      if (page > lastPage) { setPage(lastPage); return }
      setItems(result.items); setTotal(result.total)
    } }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [page, revision, source, sort])
  async function connect() {
    setBusy(true); setError('')
    try { setToken((await createCollectionConnection()).token) }
    catch (e) { setError(e instanceof Error ? e.message : '연결 키 발급 실패') }
    finally { setBusy(false) }
  }
  return <section className="collection-inbox">
    {source === 'inaturalist' ? <InaturalistControls onUpdated={reload} onBusyChange={setFetching} /> : <details className="naturing-connection"><summary>크롬 확장 프로그램 연결</summary><p>연결 키를 발급해 확장 프로그램의 연결 설정에 붙여넣으세요. 다시 발급하면 기존 키는 만료됩니다.</p><button disabled={busy} onClick={() => void connect()}>연결 키 발급·재발급</button>{token && <label>연결 키<input readOnly value={token} onFocus={e => e.currentTarget.select()} autoComplete="off" /></label>}</details>}
    {remoteTarget && createPortal(<details className="collection-remote" open><summary>검수 리모컨</summary><p className="hint">현재 페이지 · 선택 {selected.size}건</p><div className="collection-remote-actions">
      <button disabled={busy} onClick={reload}>목록 새로고침</button>
      <button disabled={busy || !items.length} onClick={() => setSelected(allSelected ? new Set() : new Set(items.map(item => item.id)))}>{allSelected ? '전체 선택 해제' : '현재 페이지 전체 선택'}</button>
      <button disabled={busy || !registrationIds.length} onClick={() => void register()}>선택 자료 등록 · {registrationIds.length}건</button>
      <button className="danger" disabled={busy || !selected.size} onClick={() => setConfirmDelete(true)}>선택 자료 삭제 · {selected.size}건</button>
      {confirmDelete && <div className="collection-delete-confirm" role="group" aria-label="수집 자료 삭제 확인"><p>선택한 수집 자료 {selected.size}건을 목록에서 삭제할까요? 이미 등록한 관찰 기록은 유지됩니다.</p><div className="actions" style={{justifyContent:'flex-end'}}><button disabled={busy} onClick={() => void remove()}>수집 자료 삭제 확인</button><button disabled={busy} onClick={() => setConfirmDelete(false)}>취소</button></div></div>}
    </div></details>, remoteTarget)}
    <div className="toolbar"><h3>수집 자료 · {total}건</h3><button disabled={busy} onClick={reload}>목록 새로고침</button><button disabled={busy || !registrationIds.length} onClick={() => void register()}>선택 자료 관찰 기록에 추가 · {registrationIds.length}건</button><button className="danger" disabled={busy || !selected.size} onClick={() => setConfirmDelete(true)}>선택 자료 삭제 · {selected.size}건</button></div>

    <p className="hint">자료를 더블클릭하면 종과 성장 단계를 수정합니다. 체크한 자료는 검수 완료로 보고 등록합니다. 전체 선택은 현재 페이지에 적용합니다. 원본 날짜는 유지하며 직접 수정하지 않은 단계는 도감 추정입니다. 네이처링에서 수동으로 읽은 위치 없는 자료도 간접 관찰로 등록할 수 있으며 지도 핀·관찰 지역 근거는 만들지 않습니다.</p>
    {notice && <p role="status" style={{whiteSpace:'pre-wrap'}}>{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}{busy && <p role="status">처리 중입니다.</p>}
    {!busy && !error && !items.length && <p>수집된 자료가 없습니다.</p>}
    <div className="collection-table-wrap"><table className="collection-table"><colgroup><col className="collection-check"/><col/><col/><col/><col className="collection-location"/><col/><col className="collection-source"/></colgroup><thead><tr><th><input type="checkbox" aria-label="현재 페이지 전체 선택" disabled={busy || !selectable.length} checked={allSelected} ref={node => { if (node) node.indeterminate = !allSelected && selectable.some(item => selected.has(item.id)) }} onChange={e => setSelected(e.target.checked ? new Set(selectable.map(item => item.id)) : new Set())} /></th><th>종</th><th><button className="collection-date-sort" disabled={busy} onClick={()=>{setSort(current=>current==='desc'?'asc':'desc');setPage(0);setSelected(new Set());setConfirmDelete(false)}}>관찰시각 {sort==='asc'?'↑':sort==='desc'?'↓':'↕'}</button></th><th>성장 단계·등록 상태</th><th>장소·공개 좌표</th><th>기상</th><th>출처</th></tr></thead><tbody>{items.map(item => <tr key={item.id} tabIndex={0} onDoubleClick={e=>{if(e.target instanceof Element&&!e.target.closest('a,input,button'))openStage(item)}} onKeyDown={e=>{if(e.key==='Enter'&&e.target===e.currentTarget){e.preventDefault();openStage(item)}}}><td><input type="checkbox" aria-label={`${item.korean_name} 자료 ${item.id} 선택`} disabled={busy} checked={selected.has(item.id)} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(item.id); else next.delete(item.id); return next })} /></td><td>{item.korean_name}<br /><i>{item.scientific_name}</i></td><td>{item.observed_raw || '미상'}</td><td>{STAGE[item.inferred_stage]} · {item.stage_manual?'사용자 지정':'도감 추정'}<br />{item.observation_id !== null ? `등록 완료 · 기록 ${item.observation_id}` : item.eligible ? '검토 후 체크하여 등록' : item.reason}{item.source_changed && <><br />등록 후 원문 변경 · 기존 기록 유지</>}</td><td><span className="collection-place-fade" title={item.display_place || item.place_raw || '미상'}>{item.display_place || item.place_raw || '미상'}</span>{item.location_note&&<small>{item.location_note}</small>}<br />{item.latitude !== null ? `${item.latitude}, ${item.longitude} · ${typeof item.location_accuracy === 'number' ? '정확도 ' + item.location_accuracy + 'm' : '정확도 미상'}` : '좌표 없음'}</td><td>{item.weather_raw || '미상'}</td><td><a href={item.url} target="_blank" rel="noopener noreferrer">{source === 'inaturalist' ? 'iNaturalist' : '네이처링'} #{item.source_id}</a></td></tr>)}</tbody></table></div>
    <div className="toolbar"><button disabled={busy || page === 0} onClick={() => { setSelected(new Set()); setPage(p => p - 1) }}>이전</button><span>{page + 1} / {Math.max(1, Math.ceil(total / 25))}</span><button disabled={busy || (page + 1) * 25 >= total} onClick={() => { setSelected(new Set()); setPage(p => p + 1) }}>다음</button></div>
    {editing&&<dialog className="collection-stage-dialog" aria-labelledby="collection-stage-title" ref={node=>{if(node&&!node.open)node.showModal()}} onCancel={e=>{e.preventDefault();if(!stageSaving)setEditing(null)}}>
      <form onSubmit={e=>{e.preventDefault();void saveStage()}}><h2 id="collection-stage-title">종·성장 단계 수정</h2><p>{editing.korean_name} · {editing.observed_raw||'관찰 시각 미상'}</p>
        <SpeciesPicker autoFocus species={species} value={speciesId} disabled={stageSaving} onChange={setSpeciesId} required/>
        <label>성장 단계<select className="stage-select" value={stage} disabled={stageSaving} onChange={e=>setStage(e.target.value as keyof typeof STAGE)}>{Object.entries(STAGE).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <p className="hint">이 대기 자료의 종·성장 단계를 수정합니다. 수집 원문과 이미 등록한 기록은 유지합니다. 저장 후 목록에서 선택해 관찰 기록에 추가해 주세요.</p>{stageError&&<p role="alert" className="error">{stageError}</p>}
        <div className="actions"><button type="button" disabled={stageSaving} onClick={()=>setEditing(null)}>취소</button><button type="submit" disabled={stageSaving}>{stageSaving?'저장 중…':'수정 저장'}</button></div>
      </form></dialog>}
  </section>
}
