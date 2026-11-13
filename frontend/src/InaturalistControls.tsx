// 공식 API의 검색 조건과 중지·재개 가능한 과거 및 최신 수집을 표시합니다.
import { useEffect, useRef, useState } from 'react'
import { searchInat, syncInat } from './api'
import { readView, writeView } from './viewMemory'
type Match = { id: number; name: string; scientific_name: string }
function savedMatch(value: unknown): Match | null {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'number' ||
      !('name' in value) || typeof value.name !== 'string' ||
      !('scientific_name' in value) || typeof value.scientific_name !== 'string') return null
  return { id: value.id, name: value.name, scientific_name: value.scientific_name }
}
export default function InaturalistControls({ onUpdated, onBusyChange }: { onUpdated: () => void; onBusyChange: (busy: boolean) => void }) {
  const [saved] = useState(() => readView('inaturalist-collection'))
  const [mode, setMode] = useState<'history' | 'latest'>(saved.mode === 'latest' ? 'latest' : 'history')
  const [taxonQuery, setTaxonQuery] = useState('')
  const [placeQuery, setPlaceQuery] = useState('')
  const [taxon, setTaxon] = useState(() => savedMatch(saved.taxon))
  const [place, setPlace] = useState(() => savedMatch(saved.place) ?? { id: 6891, name: '대한민국', scientific_name: '' })
  const [taxa, setTaxa] = useState<Match[]>(() => taxon ? [taxon] : [])
  const [places, setPlaces] = useState<Match[]>(() => place.id === 6891 ? [] : [place])
  const [start, setStart] = useState(typeof saved.start === 'string' ? saved.start : '')
  const [end, setEnd] = useState(typeof saved.end === 'string' ? saved.end : '')
  useEffect(() => { writeView('inaturalist-collection', { mode, taxon, place, start, end }) }, [mode, taxon, place, start, end])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const stopped = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; stopped.current = true }
  }, [])
  const [composing, setComposing] = useState(false)
  const [taxonMessage, setTaxonMessage] = useState('')
  const taxonRequest = useRef<AbortController | null>(null)
  const taxonTimer = useRef<number | undefined>(undefined)
  const taxonCache = useRef(new Map<string, Match[]>())

  async function findTaxa(query: string) {
    window.clearTimeout(taxonTimer.current)
    if (taxonRequest.current) return
    const cached = taxonCache.current.get(query)
    if (cached) {
      setTaxa(cached)
      setTaxonMessage(cached.length ? '' : '종 검색 결과가 없습니다.')
      return
    }
    const controller = new AbortController()
    taxonRequest.current = controller
    setTaxonMessage('종 검색 중')
    try {
      const rows = await searchInat(query, 'taxa', controller.signal)
      if (controller.signal.aborted) return
      if (taxonCache.current.size >= 30) taxonCache.current.clear()
      taxonCache.current.set(query, rows)
      setTaxa(rows)
      setTaxonMessage(rows.length ? '' : '종 검색 결과가 없습니다.')
    } catch {
      if (!controller.signal.aborted) setTaxonMessage('종 검색에 실패했습니다. Enter로 다시 검색할 수 있습니다.')
    } finally {
      if (taxonRequest.current === controller) taxonRequest.current = null
    }
  }

  useEffect(() => {
    const query = taxonQuery.trim()
    if (mode !== 'history' || composing || taxon || query.length < 2) return
    taxonTimer.current = window.setTimeout(() => void findTaxa(query), 400)
    return () => {
      window.clearTimeout(taxonTimer.current)
      taxonRequest.current?.abort()
      taxonRequest.current = null
    }
  }, [taxonQuery, composing, mode, taxon])
  async function searchPlace() {
    setBusy(true); onBusyChange(true); setError('')
    try {
      const rows = await searchInat(placeQuery, 'places')
      setPlaces(rows)
      if (!rows.length) setNotice('검색 결과가 없습니다. 학명이나 영어 지역명으로도 검색해 주세요.')
    } catch (e) { setError(e instanceof Error ? e.message : '검색하지 못했습니다.') }
    finally { setBusy(false); onBusyChange(false) }
  }
  async function collect() {
    stopped.current = false; setBusy(true); onBusyChange(true); setError(''); setNotice('자료를 가져오는 중입니다.')
    let savedPage = false
    const totals = { created: 0, updated: 0, unchanged: 0, excluded: 0 }
    try {
      // 50건씩 최대 40번 확인하며 각 단위의 진행 위치를 저장합니다.
      for (let page = 0; page < 40 && !stopped.current; page++) {
        const result = await syncInat({ mode, taxon_id: mode === 'history' ? taxon!.id : null, place_id: place.id, start: start || null, end: end || null })
        for (const key of ['created', 'updated', 'unchanged', 'excluded'] as const) totals[key] += result[key]
        savedPage = true
        if (!mounted.current) return
        setNotice(`신규 ${totals.created} · 원문 변경 ${totals.updated} · 중복 ${totals.unchanged} · 제외 ${totals.excluded}건\n${result.done ? '현재 검색 범위의 수집을 마쳤습니다.' : '진행 위치를 저장했습니다. 중지 후 같은 조건으로 이어갈 수 있습니다.'}`)
        if (result.done) break
        if (page === 39) setNotice(previous => previous + '\n이번 실행의 2000건 확인 한도에 도달했습니다. 같은 버튼으로 이어서 수집해 주세요.')
      }
    } catch (e) { setError(e instanceof Error ? e.message : '수집하지 못했습니다.') }
    finally { if (mounted.current) { if (savedPage) onUpdated(); setBusy(false); onBusyChange(false) } }
  }
  return <details className="inaturalist-controls"><summary>iNaturalist 자료 가져오기</summary>
    <p className="hint">키·로그인 없이 공개 나비 자료만 조회합니다. 과거 수집은 종별로 이어가고, 최신 수집은 종과 관계없이 새로 게시된 나비 관찰을 가져옵니다. 게시일과 실제 관찰일은 다를 수 있습니다.</p>
    <fieldset disabled={busy} className="inat-fields">
      <div className="inat-row inat-species-row" role="group" aria-label="수집 방식과 종">
        <label className="inat-mode">수집 방식<select value={mode} onChange={e => { setMode(e.target.value as 'history' | 'latest'); setNotice(''); setError('') }}><option value="history">종별 과거 자료 · 이어서 수집</option><option value="latest">나비 전체 최신 자료</option></select></label>
        {mode === 'history' && <>
          <div className="inat-taxon-query">
            <label>종 찾기<input value={taxonQuery} placeholder="국명 또는 학명"
              onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
              onChange={e => { setTaxonQuery(e.target.value); setTaxon(null); setTaxa([]); setTaxonMessage('') }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && !composing) {
                  e.preventDefault()
                  if (!taxon && taxonQuery.trim().length >= 2) void findTaxa(taxonQuery.trim())
                }
              }} /></label>
            {!taxon && taxa.length > 0 && <ul className="inat-taxon-results">{taxa.map(item =>
              <li key={item.id}><button type="button" onClick={() => { setTaxon(item); setTaxonMessage('') }}>{item.name} · {item.scientific_name}</button></li>
            )}</ul>}
            {taxonMessage && <small role="status">{taxonMessage}</small>}
          </div>
          <div className="inat-taxon-target"><small>대상 종</small><div>{taxon ? taxon.name + ' · ' + taxon.scientific_name : '미선택'}</div></div>
        </>}
      </div>
      <div className="inat-row inat-location-row" role="group" aria-label="수집 지역과 관찰 기간">
        <label className="inat-place-query">지역 찾기<input value={placeQuery} onChange={e => setPlaceQuery(e.target.value)} placeholder="국가·지역명" /></label><button type="button" disabled={placeQuery.trim().length < 2} onClick={() => void searchPlace()}>지역 검색</button><label className="inat-place-select">수집 지역<select value={place.id} onChange={e => setPlace([{ id: 6891, name: '대한민국', scientific_name: '' }, ...places].find(p => p.id === Number(e.target.value))!)}><option value={6891}>대한민국</option>{places.filter(p => p.id !== 6891).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="inat-date">시작일 · 선택<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label><label className="inat-date">종료일 · 선택<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>
    </fieldset>
    <div className="inat-collect-actions">
      <button type="button" disabled={busy || mode === 'history' && !taxon || !!(start && end && start > end)} onClick={() => void collect()}>가져오기 · 이어서</button>
      <button type="button" disabled={!busy} onClick={() => { stopped.current = true; setNotice(previous => previous + '\n중지 요청: 현재 요청 저장 후 멈춥니다.') }}>수집 중지</button>
    </div>
    <p className="hint">날짜를 비우면 과거 전체가 대상입니다. 한 번에 최대 2000건을 확인하며 같은 조건으로 다시 누르면 이어갑니다. 같은 지역의 과거 수집 이력이 있으면 그 수집을 시작한 뒤 게시된 자료를 모두 확인합니다. 과거 수집 이력이 없으면 최신 200건으로 시작하며, 이후에는 기준 뒤의 신규 게시물을 이어갑니다. 조건별 진행 위치는 프로그램을 다시 실행해도 유지됩니다. 공개 좌표 오차가 50km 이하이거나 미상이면 흐림 위치도 수집하며 대략적 위치로 표시합니다. 좌표 비공개·좌표 없음·50km 초과는 제외하며, 오차가 없는 자료는 정확도 미상으로 수집합니다. 위치 기준이 바뀐 과거 조건은 다시 누르면 중복 없이 재검사합니다. 사진은 다운로드하지 않습니다.</p>
    {notice && <p role="status" style={{ whiteSpace: 'pre-wrap' }}>{notice}</p>}{error && <p role="alert" className="error">{error}</p>}
  </details>
}
