// 등록·검색은 왼쪽에 두고 종별 한살이 그림과 생태 정보를 표로 표시합니다.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { addSpecies, getReference, listCatalog } from './api'
import type { Species, ReferenceDocument, SpeciesCatalog, Survey } from './models'
import ReferenceModal from './ReferenceModal'
import LifeCycleChart from './LifeCycleChart'
import { collectLifeSamples, LIFE_STAGES } from './lifeCycle'
import type { LifeFilter } from './lifeCycle'
import { speciesStatuses } from './speciesStatus'
// 탭을 닫아도 자료만 재사용합니다. 명시적 새로고침·편집은 revision으로 무효화합니다.
let catalogCache: { key: string; promise: Promise<SpeciesCatalog[]> } | undefined
function cachedCatalog(key: string) {
  if (!catalogCache || catalogCache.key !== key) {
    const promise = listCatalog()
    catalogCache = { key, promise }
    void promise.catch(() => { if (catalogCache?.promise === promise) catalogCache = undefined })
  }
  return catalogCache.promise
}
const noSamples: ReturnType<typeof collectLifeSamples> = []
// 화면 가까이에 있는 그래프만 만들고 같은 높이를 예약합니다.
const VisibleLifeChart = memo(function VisibleLifeChart(props: Parameters<typeof LifeCycleChart>[0]) {
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const node = element.current
    if (!node) return
    const observer = new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting))
    }, { root: node.closest('.catalog-scroll-area'), rootMargin: '300px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return <div ref={element} className="life-chart-slot">{visible ? <LifeCycleChart {...props} /> : <button type="button" className="link" onFocus={() => setVisible(true)} onClick={() => setVisible(true)}>{props.name} 한살이 그림 보기</button>}</div>
})
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
// 저장된 개조식 줄은 실제 글머리 목록으로 표시하고 구분 제목을 유지합니다.
function CatalogNotes({ text }: { text: string }) {
  if (!text) return <span className="catalog-unregistered">미등록</span>
  const groups: { title: string; items: string[] }[] = []
  for (const line of text.split('\n').map(value => value.trim()).filter(Boolean)) {
    if (/^[-•]\s*/.test(line)) {
      if (!groups.length) groups.push({ title: '', items: [] })
      groups[groups.length - 1].items.push(line.replace(/^[-•]\s*/, ''))
    } else groups.push({ title: line, items: [] })
  }
  return <div className="catalog-notes">{groups.map((group, index) => {
    const items: { label: string; lines: string[] }[] = []
    for (const item of group.items) {
      const match = /^(수컷|암컷|공통):\s*(.*)$/.exec(item)
      const label = match ? match[1] : ''
      const body = match ? match[2] : item
      const previous = items[items.length - 1]
      if (label && previous?.label === label) {
        // 앞날개·뒷날개 열거 도중 나뉜 짧은 조각은 문장에 다시 연결합니다.
        const last = previous.lines.length - 1
        if (/^(앞날개|뒷날개)$/.test(previous.lines[last])) previous.lines[last] += ', ' + body
        else previous.lines.push(body)
      } else items.push({ label, lines: [body] })
    }
    return <div key={index}>{group.title && <div className="catalog-note-heading">{group.title}</div>}{items.length > 0 && <ul>{items.map((item, i) => <li key={i} className={item.lines[0].startsWith('참고 문헌:') ? 'catalog-citation' : undefined}>{item.label ? <div className="catalog-sex-description"><span>{item.label}:</span><div>{item.lines.map((line, n) => <div key={n}>{line}</div>)}</div></div> : item.lines[0]}</li>)}</ul>}</div>
  })}</div>
}
export default function ButterflyInfo({ species, onCreated, onUpdated, onEditing, sidebar, query, revision, surveys, registerOpen, onRegisterOpen }: { species: Species[]; onCreated: (s: Species) => void; onUpdated: (s: Species) => void; onEditing: (v: boolean) => void; sidebar: HTMLDivElement | null; query: string; revision: number; surveys: Survey[]; registerOpen: boolean; onRegisterOpen: (open: boolean) => void }) {
  const scrollArea = useRef<HTMLDivElement>(null)
  const scrollInput = useRef<HTMLInputElement>(null)
  const [scroll, setScroll] = useState({ left: 0, max: 0, thumbWidth: 36 })
  useEffect(() => {
    const area = scrollArea.current, input = scrollInput.current
    if (!area || !input) return
    const measure = () => {
      area.style.setProperty('--catalog-header-height', `${area.querySelector('thead')?.getBoundingClientRect().height || 0}px`)
      const max = Math.max(0, area.scrollWidth - area.clientWidth)
      const thumbWidth = Math.max(36, input.clientWidth * area.clientWidth / Math.max(1, area.scrollWidth))
      setScroll(previous => previous.max === max && previous.left === area.scrollLeft && previous.thumbWidth === thumbWidth ? previous : { left: area.scrollLeft, max, thumbWidth })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(area); observer.observe(input)
    if (area.firstElementChild) observer.observe(area.firstElementChild)
    const header = area.querySelector('thead')
    if (header) observer.observe(header)
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
    cachedCatalog(requestKey).then(rows => { if (active) { setCatalog(rows); setError('') } })
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
  const filtered = catalog.filter(s => `${s.korean_name} ${s.scientific_name || ''} ${speciesStatuses(s.reference).map(badge => badge.label).join(' ')} ${s.reference.regions.join(' ')} ${s.reference.region_search||''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const controls = <div className="catalog-controls">
    <details open={registerOpen} onToggle={e => onRegisterOpen(e.currentTarget.open)}><summary>나비 등록</summary><form onSubmit={create} className="catalog-create"><fieldset disabled={busy}><label>국명<input id="catalog-new-name" name="korean_name" required maxLength={100} /></label><label>학명 · 선택<input name="scientific_name" maxLength={200} /></label><button className="primary">나비 등록</button></fieldset></form></details>
    {error && <p className="error" role="alert">{error}<button type="button" disabled={busy} onClick={() => setRetry(n => n + 1)}>목록 다시 읽기</button></p>}{notice && <p className="notice" role="status">{notice}</p>}{loading && <p role="status">나비 목록을 읽는 중입니다.</p>}
    <p className="hint">검색 {filtered.length}종 / 등록 {species.length}종<br />표의 국명을 누르면 편집창이 열립니다.<br />상태 태그에 마우스를 올리면 출처를 볼 수 있습니다. 표시가 없으면 해당 없음으로 확정한 것은 아닙니다.</p>
    <details className="catalog-graph-settings"><summary>한살이 그림 조건·범례</summary><label>관찰 연도<input type="number" min={1800} max={9999} value={filter.year} onChange={e => setFilter({ ...filter, year: e.target.value })} placeholder="전체 연도" /></label><label>그림 지역<input value={filter.region} onChange={e => setFilter({ ...filter, region: e.target.value })} placeholder="전체 지역" /></label><label>그림 관찰 출처<select value={filter.source} onChange={e => setFilter({ ...filter, source: e.target.value as LifeFilter['source'] })}><option value="">직접·간접 전체</option><option value="direct">직접 관찰</option><option value="indirect">간접 관찰</option></select></label><div className="life-legend">{LIFE_STAGES.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div><p className="hint">옅은 막대: 도감 참고<br />상자·수염: 관찰 분포<br />점: 소수 자료·통계적 이상값<br />각 단계를 누르면 출처·사례가 열립니다.</p><p className="hint">사용자 확인 동정·단계 지정 관찰만 사용합니다. 단계별 관찰 20사례부터 상자를 표시하며 도감 기간과 독립적으로 계산합니다. 도감 밖 관찰도 포함하고 통계적 이상값은 점으로 남깁니다. 단계는 도감 추정을 포함하며 상세에서 근거를 구분합니다. 개체 수·사진 장수로 가중하지 않습니다.</p><button type="button" onClick={() => setFilter({ year: '', region: '', source: '' })}>한살이 필터 초기화</button></details>
  </div>
  return <section className="butterfly-info" aria-label="나비 도감 표">
    {sidebar ? createPortal(controls, sidebar) : controls}
    <div className="catalog-toolbar"><h2>나비 도감</h2></div>
    <div className="table-wrap catalog-scroll-area" id="catalog-scroll-area" ref={scrollArea} onScroll={e => { const left = e.currentTarget.scrollLeft; setScroll(previous => previous.left === left ? previous : { ...previous, left }) }}><table className="catalog-table"><thead><tr><th>국명 · 학명</th><th>한살이 기간</th><th>기주식물</th><th>서식지</th><th>습성</th><th>기타</th><th>동정 포인트</th></tr></thead><tbody>{filtered.map(s => <tr key={s.id}><td className="catalog-name"><button className="link" disabled={busy} title={`${s.korean_name} 정보 편집`} onClick={() => void open(s)}>{s.korean_name}</button><small>{s.scientific_name || '학명 미등록'}</small><div className="species-statuses" aria-label={`${s.korean_name} 상태`}>{speciesStatuses(s.reference).map((badge, index) => <span key={index} className={`species-status status-${badge.tone}`} title={badge.detail}>{badge.label}</span>)}</div></td><td><VisibleLifeChart name={s.korean_name} reference={s.reference} samples={samples.get(s.id) || noSamples} filter={filter} /></td><td title={s.reference.host_plants}>{s.reference.host_plants ? <ul className="host-plant-list">{hostPlantLines(s.reference.host_plants).map((plant, index) => <li key={index}>{plant}</li>)}</ul> : <span className="catalog-unregistered">미등록</span>}</td><td>{s.reference.habitat || <span className="catalog-unregistered">미등록</span>}</td><td><CatalogNotes text={s.reference.habits} /></td><td><CatalogNotes text={s.reference.other_notes} /></td><td><div className="catalog-identification"><CatalogNotes text={s.reference.identification_points} /></div></td></tr>)}{!filtered.length && <tr><td colSpan={7}>{loading ? '목록을 읽는 중입니다.' : error ? '왼쪽 오류 안내에서 다시 읽어 주세요.' : catalog.length ? '검색 결과가 없습니다.' : '왼쪽에서 나비를 등록해 주세요.'}</td></tr>}</tbody></table></div>
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
