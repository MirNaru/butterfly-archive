// 등록·검색은 왼쪽에 두고 종별 한살이 그림과 생태 정보를 표로 표시합니다.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { addSpecies, getReference, listCatalog } from './api'
import type { Species, ReferenceDocument, SpeciesCatalog, Survey } from './models'
import ReferenceModal from './ReferenceModal'
import LifeCycleChart from './LifeCycleChart'
import { collectLifeSamples, LIFE_STAGES } from './lifeCycle'
import type { LifeFilter } from './lifeCycle'
import { speciesStatuses } from './speciesStatus'
// 기주식물 원문은 유지하고 괄호 밖의 구분자만 화면에서 줄로 나눕니다.
function hostPlantLines(value: string): string[] {
  const lines: string[] = []
  let current = '', depth = 0
  for (const character of value) {
    if (character === '(' || character === '\uFF08') depth++
    if (character === ')' || character === '\uFF09') depth = Math.max(0, depth - 1)
    if (depth === 0 && ',;\n\r\uFF0C'.includes(character)) {
      if (current.trim()) lines.push(current.trim())
      current = ''
    } else current += character
  }
  if (current.trim()) lines.push(current.trim())
  return lines
}
export default function ButterflyInfo({ species, onCreated, onUpdated, onEditing, sidebar, query, revision, surveys, registerOpen, onRegisterOpen }: { species: Species[]; onCreated: (s: Species) => void; onUpdated: (s: Species) => void; onEditing: (v: boolean) => void; sidebar: HTMLDivElement | null; query: string; revision: number; surveys: Survey[]; registerOpen: boolean; onRegisterOpen: (open: boolean) => void }) {
  const scrollArea = useRef<HTMLDivElement>(null)
  const scrollInput = useRef<HTMLInputElement>(null)
  const [scroll, setScroll] = useState({ left: 0, max: 0, thumbWidth: 36 })
  useEffect(() => {
    const area = scrollArea.current, input = scrollInput.current
    if (!area || !input) return
    const measure = () => {
      const max = Math.max(0, area.scrollWidth - area.clientWidth)
      const thumbWidth = Math.max(36, input.clientWidth * area.clientWidth / Math.max(1, area.scrollWidth))
      setScroll(previous => previous.max === max && previous.left === area.scrollLeft && previous.thumbWidth === thumbWidth ? previous : { left: area.scrollLeft, max, thumbWidth })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(area); observer.observe(input)
    if (area.firstElementChild) observer.observe(area.firstElementChild)
    return () => observer.disconnect()
  }, [])
  function moveScroll(left: number) {
    if (!scrollArea.current) return
    scrollArea.current.scrollLeft = Math.max(0, Math.min(scroll.max, left))
    const actual = scrollArea.current.scrollLeft
    setScroll(previous => previous.left === actual ? previous : { ...previous, left: actual })
  }
  const [catalog, setCatalog] = useState<SpeciesCatalog[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState('')
  const [filter, setFilter] = useState<LifeFilter>({ year: '', region: '', source: '' })
  const [editing, setEditing] = useState<{ species: Species; document: ReferenceDocument } | null>(null)
  const requestKey = `${revision}:${retry}`
  const loading = loaded !== requestKey
  useEffect(() => {
    let active = true
    listCatalog().then(rows => { if (active) { setCatalog(rows); setError('') } })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : '나비 목록을 읽지 못했습니다.') })
      .finally(() => { if (active) setLoaded(requestKey) })
    return () => { active = false }
  }, [requestKey])
  const samples = useMemo(() => {
    const grouped = new Map<number, ReturnType<typeof collectLifeSamples>>()
    for (const sample of collectLifeSamples(surveys)) grouped.set(sample.speciesId, [...(grouped.get(sample.speciesId) || []), sample])
    return grouped
  }, [surveys])
  async function open(s: Species) {
    setBusy(true); setError(''); onEditing(true)
    try { setEditing({ species: s, document: await getReference(s.id) }) }
    catch (e) { setError(e instanceof Error ? e.message : '정보를 읽지 못했습니다.'); onEditing(false) }
    finally { setBusy(false) }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return
    const form = e.currentTarget, data = new FormData(form)
    setBusy(true); setError(''); setNotice(''); onEditing(true)
    try {
      const s = await addSpecies(String(data.get('korean_name') || ''), String(data.get('scientific_name') || ''))
      onCreated(s); form.reset(); setNotice(`${s.korean_name} 등록 완료. 국명을 눌러 한살이 기간과 생태 정보를 편집하세요.`)
    } catch (e) { setError(e instanceof Error ? e.message : '종 등록에 실패했습니다.') }
    finally { setBusy(false); onEditing(false) }
  }
  const filtered = catalog.filter(s => `${s.korean_name} ${s.scientific_name || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const controls = <div className="catalog-controls">
    <details open={registerOpen} onToggle={e => onRegisterOpen(e.currentTarget.open)}><summary>나비 등록</summary><form onSubmit={create} className="catalog-create"><fieldset disabled={busy}><label>국명<input id="catalog-new-name" name="korean_name" required maxLength={100} /></label><label>학명 · 선택<input name="scientific_name" maxLength={200} /></label><button className="primary">나비 등록</button></fieldset></form></details>
    {error && <p className="error" role="alert">{error}<button type="button" disabled={busy} onClick={() => setRetry(n => n + 1)}>목록 다시 읽기</button></p>}{notice && <p className="notice" role="status">{notice}</p>}{loading && <p role="status">나비 목록을 읽는 중입니다.</p>}
    <p className="hint">검색 {filtered.length}종 / 등록 {species.length}종<br />표의 국명을 누르면 편집창이 열립니다.<br />상태 태그에 마우스를 올리면 출처를 볼 수 있습니다. 표시가 없으면 해당 없음으로 확정한 것은 아닙니다.</p>
    <details className="catalog-graph-settings"><summary>한살이 그림 조건·범례</summary><label>관찰 연도<input type="number" min={1800} max={9999} value={filter.year} onChange={e => setFilter({ ...filter, year: e.target.value })} placeholder="전체 연도" /></label><label>그림 지역<input value={filter.region} onChange={e => setFilter({ ...filter, region: e.target.value })} placeholder="전체 지역" /></label><label>그림 관찰 출처<select value={filter.source} onChange={e => setFilter({ ...filter, source: e.target.value as LifeFilter['source'] })}><option value="">직접·간접 전체</option><option value="direct">직접 관찰</option><option value="indirect">간접 관찰</option></select></label><div className="life-legend">{LIFE_STAGES.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div><p className="hint">옅은 막대: 도감 참고<br />상자·수염: 관찰 분포<br />점: 소수 자료·범위 밖 관찰<br />각 단계를 누르면 출처·사례가 열립니다.</p><p className="hint">사용자 확인 동정·단계 지정 관찰만 사용합니다. 참고 구간 안 5사례부터 상자를 표시하고 구간 밖 자료는 별도 점으로 남깁니다. 개체 수·사진 장수로 가중하지 않습니다.</p><button type="button" onClick={() => setFilter({ year: '', region: '', source: '' })}>그림 조건 초기화</button></details>
  </div>
  return <section className="butterfly-info" aria-label="나비 도감 표">
    {sidebar ? createPortal(controls, sidebar) : controls}
    <div className="catalog-toolbar"><h2>나비 도감</h2></div>
    <div className="table-wrap catalog-scroll-area" id="catalog-scroll-area" ref={scrollArea} onScroll={e => { const left = e.currentTarget.scrollLeft; setScroll(previous => previous.left === left ? previous : { ...previous, left }) }}><table className="catalog-table"><thead><tr><th>국명 · 학명</th><th>한살이 기간</th><th>기주식물</th><th>서식지</th><th>습성</th><th>기타</th><th>동정 포인트</th></tr></thead><tbody>{filtered.map(s => <tr key={s.id}><td className="catalog-name"><button className="link" disabled={busy} title={`${s.korean_name} 정보 편집`} onClick={() => void open(s)}>{s.korean_name}</button><small>{s.scientific_name || '학명 미등록'}</small><div className="species-statuses" aria-label={`${s.korean_name} 상태`}>{speciesStatuses(s.reference).map((badge, index) => <span key={index} className={`species-status status-${badge.tone}`} title={badge.detail}>{badge.label}</span>)}</div></td><td><LifeCycleChart name={s.korean_name} reference={s.reference} samples={samples.get(s.id) || []} filter={filter} /></td><td title={s.reference.host_plants}>{s.reference.host_plants ? <ul className="host-plant-list">{hostPlantLines(s.reference.host_plants).map((plant, index) => <li key={index}>{plant}</li>)}</ul> : '미등록'}</td><td>{s.reference.habitat || '미등록'}</td><td>{s.reference.habits || '미등록'}</td><td>{s.reference.other_notes || '미등록'}</td><td>{s.reference.identification_points || '미등록'}</td></tr>)}{!filtered.length && <tr><td colSpan={7}>{loading ? '목록을 읽는 중입니다.' : error ? '왼쪽 오류 안내에서 다시 읽어 주세요.' : catalog.length ? '검색 결과가 없습니다.' : '왼쪽에서 나비를 등록해 주세요.'}</td></tr>}</tbody></table></div>
    <div className="catalog-scrollbar"><input ref={scrollInput} type="range" min={0} max={scroll.max} step={1} value={scroll.left} disabled={scroll.max === 0} aria-label="도감 가로 스크롤" aria-controls="catalog-scroll-area" aria-valuetext={`${Math.round(scroll.max ? scroll.left / scroll.max * 100 : 0)}%`} style={{ '--scroll-thumb-width': `${scroll.thumbWidth}px` } as CSSProperties} onChange={e => moveScroll(Number(e.target.value))} onKeyDown={e => {
      const page = scrollArea.current?.clientWidth || 0
      const deltas: Record<string, number> = { ArrowLeft: -48, ArrowRight: 48, PageUp: -page, PageDown: page }
      if (e.key === 'Home' || e.key === 'End' || e.key in deltas) {
        e.preventDefault(); moveScroll(e.key === 'Home' ? 0 : e.key === 'End' ? scroll.max : scroll.left + deltas[e.key])
      }
    }} /></div>
    {editing && <ReferenceModal species={editing.species} initial={editing.document} onClose={() => { setEditing(null); onEditing(false) }} onSaved={reference => { setCatalog(current => current.map(s => s.id === editing.species.id ? { ...s, reference, host_plants: reference.host_plants } : s)); onUpdated({ ...editing.species, host_plants: reference.host_plants }); setEditing(null); onEditing(false); setNotice('나비 정보를 저장했습니다.') }} />}
  </section>
}
