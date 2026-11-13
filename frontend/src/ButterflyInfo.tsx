import SpeciesInfoModal from './SpeciesInfoModal'
import {readView,writeView} from './viewMemory'
// 등록·검색은 왼쪽에 두고 종별 한살이 그림과 생태 정보를 표로 표시합니다.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, CSSProperties } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { addSpecies, getReference, latestRequest, catalogExploration, listHoldings } from './api'
import type { Species, ReferenceDocument, SpeciesCatalog, Survey, ExplorationRow } from './models'
import ReferenceModal from './ReferenceModal'
import { SpeciesDetails } from './SpeciesDetails'
import LifeCycleChart from './LifeCycleChart'
import { collectLifeSamples, LIFE_STAGES } from './lifeCycle'
import type { LifeFilter } from './lifeCycle'
import { hasTargetConditions, targetMatches } from './recordSearch'
import type { TargetFilters } from './recordSearch'
import { speciesStatuses } from './speciesStatus'
// 탭을 닫아도 자료만 재사용합니다. 명시적 새로고침·편집은 revision으로 무효화합니다.
const cachedHoldings = latestRequest(listHoldings)
const noSamples: ReturnType<typeof collectLifeSamples> = []
// 화면 가까이에 있는 그래프만 만들고 같은 높이를 예약합니다.
const VisibleLifeChart = memo(function VisibleLifeChart({ positionReady, ...props }: Parameters<typeof LifeCycleChart>[0] & { positionReady: boolean }) {
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useLayoutEffect(() => {
    const node = element.current
    const root = node?.closest('.catalog-scroll-area')
    if (!node || !root || !positionReady) return
    const bounds = node.getBoundingClientRect()
    const viewport = root.getBoundingClientRect()
    setVisible(bounds.bottom > viewport.top && bounds.top < viewport.bottom &&
      bounds.right > viewport.left && bounds.left < viewport.right)
    const observer = new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting))
    }, { root, rootMargin: '300px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [positionReady])
  return <div ref={element} className="life-chart-slot">{visible ? <LifeCycleChart {...props} /> : <button type="button" className="link" onFocus={() => setVisible(true)} onClick={() => setVisible(true)}>{props.name} 한살이 그림 보기</button>}</div>
})
// 기주식물 원문은 유지하고 괄호 밖의 구분자만 화면에서 줄로 나눕니다.
function hostPlantLines(value: string): string[] {
  const lines: string[] = []
  let current = '', depth = 0
  for (const character of value) {
    if (character === '(' || character === '\uFF08') depth++
    if (character === ')' || character === '\uFF09') depth = Math.max(0, depth - 1)
    if (depth === 0 && ',;\n\r\uFF0C&'.includes(character)) {
      if (current.trim()) lines.push(current.trim())
      if (character === '&') lines.push('&')
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
export default function ButterflyInfo({ currentReferences, targets, onTargets, species, onCreated, onUpdated, onEditing, sidebar, query, revision, surveys, registerOpen, onRegisterOpen }: { currentReferences?: ExplorationRow[]; targets: TargetFilters; onTargets: (value: TargetFilters) => void; species: Species[]; onCreated: (s: Species) => void; onUpdated: (s: Species) => void; onEditing: (v: boolean) => void; sidebar: HTMLDivElement | null; query: string; revision: number; surveys: Survey[]; registerOpen: boolean; onRegisterOpen: (open: boolean) => void }) {
  const [savedScroll] = useState(() => readView('catalog-scroll'))
  const [limit,setLimit] = useState(12)
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
  const [editMode,setEditMode] = useState(false)
  const [editing, setEditing] = useState<{ species: Species; document: ReferenceDocument } | null>(null)
  const requestKey = `${revision}:${retry}`
  const loading = loaded !== requestKey
  const restoredScroll = useRef(false)
  const [positionReady, setPositionReady] = useState(false)
  useEffect(() => {
    if (loading || restoredScroll.current || !scrollArea.current) return
    const top = typeof savedScroll.top === 'number' ? savedScroll.top : 0
    const left = typeof savedScroll.left === 'number' ? savedScroll.left : 0
    setLimit(previous => Math.max(previous, Math.ceil(top / 24) + 50))
    const frame = requestAnimationFrame(() => { if(scrollArea.current) { scrollArea.current.scrollTop=top;scrollArea.current.scrollLeft=left;restoredScroll.current=true;setPositionReady(true) } })
    return () => cancelAnimationFrame(frame)
  },[loading,savedScroll])
  useEffect(() => {
    let active = true
    const source = currentReferences
      ? Promise.resolve([...currentReferences].sort((a,b) => (a.reference.display_order ?? Infinity) - (b.reference.display_order ?? Infinity) || a.id-b.id))
      : catalogExploration(String(revision), targets.on, targets.region).then(rows => [...rows].sort((a,b) => (a.reference.display_order ?? Infinity) - (b.reference.display_order ?? Infinity) || a.id-b.id))
    source.then(rows => { if (active) { setCatalog(rows); setError('') } })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : '나비 목록을 읽지 못했습니다.') })
      .finally(() => { if (active) setLoaded(requestKey) })
    return () => { active = false }
  }, [requestKey,currentReferences,revision,targets.on,targets.region])
  const samples = useMemo(() => {
    const grouped = new Map<number, ReturnType<typeof collectLifeSamples>>()
    for (const sample of collectLifeSamples(surveys)) {
      const group = grouped.get(sample.speciesId)
      if (group) group.push(sample); else grouped.set(sample.speciesId,[sample])
    }
    return grouped
  }, [surveys])
  const open = useCallback(async (s: Species) => {
    setBusy(true); setError(''); setEditMode(false); onEditing(true)
    try { setEditing({ species: s, document: await getReference(s.id) }) }
    catch (e) { setError(e instanceof Error ? e.message : '정보를 읽지 못했습니다.'); onEditing(false) }
    finally { setBusy(false) }
  }, [onEditing])
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
  const [conditionOpen, setConditionOpen] = useState(false)
  const [ownership, setOwnership] = useState('')
  const [owned, setOwned] = useState<Set<number>>(new Set())
  const [ownershipStatus, setOwnershipStatus] = useState('loading')
  const [references, setReferences] = useState<ExplorationRow[]>([])
  const [conditionStatus, setConditionStatus] = useState({key:'', error:''})
  const conditionKey = `${targets.on}:${targets.region}:${revision}:${retry}`
  useEffect(() => {
    let active = true
    catalogExploration(String(revision), targets.on, targets.region).then(refs => {
      if (!active) return
      setReferences(refs)
      setConditionStatus({key:conditionKey,error:''})
    }).catch((e: unknown) => { if(active) setConditionStatus({key:conditionKey,error:e instanceof Error ? e.message : '도감 조건을 읽지 못했습니다.'}) })
    return () => { active = false }
  }, [conditionKey, targets.on, targets.region, revision])
  useEffect(() => {
    let active = true
    cachedHoldings(requestKey).then(holdings => {
      if(active) { setOwned(new Set(holdings.filter(h => h.possession === 'owned' && (h.acquisition === 'purchase' || h.acquisition === 'own_capture')).map(h => h.species_id))); setOwnershipStatus(requestKey) }
    }).catch(() => { if(active) setOwnershipStatus('error') })
    return () => { active = false }
  }, [requestKey])
  const conditionReady = conditionStatus.key === conditionKey && !conditionStatus.error
  const referenceMap = useMemo(() => new Map(references.map(r => [r.id,r])), [references])
  const observed = useMemo(() => new Set(surveys.flatMap(s => s.observations.filter(o => o.result === 'observed').map(o => o.species_id))), [surveys])
  const searched = catalog.filter(s => `${s.korean_name} ${s.scientific_name || ''} ${speciesStatuses(s.reference).map(badge => badge.label).join(' ')} ${s.reference.regions.join(' ')} ${s.reference.region_search||''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const filtered = searched.filter(s => {
    const r = referenceMap.get(s.id)
    return (!hasTargetConditions(targets) || (conditionReady && !!r && targetMatches(r, {...targets, active:false}))) && (!ownership || ownershipStatus === requestKey) && (targets.includeUnrecorded || observed.has(s.id))
      && (!ownership || (ownership === 'only' ? owned.has(s.id) : !owned.has(s.id)))
  })
  // 첫 화면을 먼저 그린 뒤 나머지 행을 프레임마다 나누어 붙입니다.

  useEffect(() => {
    if (limit >= filtered.length) return
    const id = requestAnimationFrame(() => setLimit(n => n + 16))
    return () => cancelAnimationFrame(id)
  }, [limit,filtered.length])
  const visible = new Set(filtered.map(s => s.id))
  const denominator = references.length
  const numerator = references.filter(r => visible.has(r.id) && r.capture_history === 'not_captured' && r.permission === 'permitted' && r.reference.protected === false).length
  // 전체·과별 소유 비율은 검색 결과가 아닌 전체 도감에서 계산합니다.
  const families = [...new Set(catalog.map(s => s.reference.family).filter(Boolean))]
  const ownershipRatios = ['전체', ...families].map(label => {
    const group = label === '전체' ? catalog : catalog.filter(s => s.reference.family === label)
    return {label, total:group.length, count:group.filter(s => owned.has(s.id)).length}
  })
  const ratioText = (count:number,total:number) => `${count} / ${total} · ${total ? (count / total * 100).toFixed(2) : '0.00'}%`
  const controls = <div className="catalog-controls">
    <details open={registerOpen} onToggle={e => onRegisterOpen(e.currentTarget.open)}><summary>나비 등록</summary><form onSubmit={create} className="catalog-create"><fieldset disabled={busy}><label>국명<input id="catalog-new-name" name="korean_name" required maxLength={100} /></label><label>학명 · 선택<input name="scientific_name" maxLength={200} /></label><button className="primary">나비 등록</button></fieldset></form></details>
    <details open={conditionOpen} onToggle={e => setConditionOpen(e.currentTarget.open)} className="catalog-conditions"><summary>도감 조건부 보기</summary>
      <label>출현 행정지역<input value={targets.region} onChange={e => onTargets({...targets,region:e.target.value})} placeholder="예: 정선, 강원도, 수도권"/></label>
      {Object.entries({captured:'이미 채집한 종 제외',north:'북한 서식 종 제외',old:'미갱신 미접 제외 · 2010년 이전',protected:'국가보호종 제외',includeUnrecorded:'관찰 기록 없는 종 포함'}).map(([key,label]) => <label className="check" key={key}><input type="checkbox" checked={targets[key as 'active'|'captured'|'north'|'old'|'protected'|'includeUnrecorded']} onChange={e=>onTargets({...targets,[key]:e.target.checked})}/>{label}</label>)}
      <label>소유 여부<select value={ownership} onChange={e=>setOwnership(e.target.value)}><option value="">전체</option><option value="exclude">소유한 종 제외</option><option value="only">소유한 종만 보기</option></select></label>
      <p className="hint">소유 여부는 소장 목록에서 구매·직접 채집으로 소지 중인 종을 기준으로 합니다.</p>

    </details>
    {!conditionReady && <p role="status">{conditionStatus.error || '도감 조건을 읽는 중입니다.'}{conditionStatus.error && <button onClick={()=>setRetry(n=>n+1)}>다시 읽기</button>}</p>}
    {error && <p className="error" role="alert">{error}<button type="button" disabled={busy} onClick={() => setRetry(n => n + 1)}>목록 다시 읽기</button></p>}{notice && <p className="notice" role="status">{notice}</p>}{loading && <p role="status">나비 목록을 읽는 중입니다.</p>}
    <p className="hint">검색 {filtered.length}종 / 등록 {species.length}종</p>
    <details className="catalog-graph-settings"><summary>한살이 그림 조건·범례</summary><label>관찰 연도<input type="number" min={1800} max={9999} value={filter.year} onChange={e => setFilter({ ...filter, year: e.target.value })} placeholder="전체 연도" /></label><label>그림 지역<input value={filter.region} onChange={e => setFilter({ ...filter, region: e.target.value })} placeholder="전체 지역" /></label><label>그림 관찰 출처<select value={filter.source} onChange={e => setFilter({ ...filter, source: e.target.value as LifeFilter['source'] })}><option value="">직접·간접 전체</option><option value="direct">직접 관찰</option><option value="indirect">간접 관찰</option></select></label><div className="life-legend">{LIFE_STAGES.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div><p className="hint">옅은 막대: 도감 참고<br />상자·수염: 관찰 분포<br />점: 소수 자료·통계적 이상값<br />각 단계를 누르면 출처·사례가 열립니다.</p><p className="hint">등록한 관찰 중 종과 성장 단계가 지정된 사례를 사용합니다. 단계별 관찰 20사례부터 상자를 표시하며 도감 기간과 독립적으로 계산합니다. 도감 밖 관찰도 포함하고 통계적 이상값은 점으로 남깁니다. 단계는 도감 추정을 포함하며 상세에서 근거를 구분합니다. 개체 수·사진 장수로 가중하지 않습니다.</p><button type="button" onClick={() => setFilter({ year: '', region: '', source: '' })}>한살이 필터 초기화</button></details>
  </div>
  return <section className="butterfly-info" aria-label="나비 도감 표">
    {sidebar ? createPortal(controls, sidebar) : controls}
    <div className="catalog-toolbar"><h2>나비 도감</h2><div className="catalog-ratios" role="group" aria-label="도감 종 비율">
      <div className="catalog-ratio" title="도감 조건·검색 결과 중 미채집·채집 허용·보호종 아님이 확인된 종 / 전체 등록 종"><strong>포획 가능 종</strong><span>{!loading && !error && conditionReady && (!ownership || ownershipStatus === requestKey) ? ratioText(numerator,denominator) : '확인 중'}</span></div>
      {ownershipRatios.map(r => <button type="button" className="catalog-ratio catalog-family-link" key={r.label} onClick={() => { const first = filtered.find(s => r.label === '전체' || s.reference.family === r.label); if (first && filtered.indexOf(first) >= limit) flushSync(() => setLimit(filtered.indexOf(first) + 1)); const area = scrollArea.current; const row = first && area?.querySelector<HTMLElement>('[data-species-id="' + first.id + '"]'); if (area && row) area.scrollTop += row.getBoundingClientRect().top - area.getBoundingClientRect().top - (area.querySelector('thead')?.getBoundingClientRect().height || 0); }} title="소유 종 / 전체 등록 종 · 도감 조건과 검색의 영향을 받지 않습니다."><strong>{r.label}</strong><span>{!loading && ownershipStatus === requestKey ? ratioText(r.count,r.total) : ownershipStatus === 'error' ? '소장 조회 실패' : '확인 중'}</span></button>)}
    </div></div>
    <div className="table-wrap catalog-scroll-area" id="catalog-scroll-area" ref={scrollArea} onScroll={e => { const left = e.currentTarget.scrollLeft; if(restoredScroll.current) writeView('catalog-scroll',{left,top:e.currentTarget.scrollTop}); setScroll(previous => previous.left === left ? previous : { ...previous, left }) }}><table className="catalog-table"><thead><tr><th>대표사진 · 국명 · 학명</th><th>한살이 기간</th><th>기주식물</th><th>서식지</th><th>습성</th><th>세부 정보</th><th>동정 포인트</th></tr></thead><tbody>{filtered.slice(0,limit).map(s => <CatalogRow key={s.id} positionReady={positionReady} s={s} busy={busy} onOpen={open} samples={samples.get(s.id) || noSamples} filter={filter} />)}{!filtered.length && <tr><td colSpan={7}>{loading ? '목록을 읽는 중입니다.' : error ? '왼쪽 오류 안내에서 다시 읽어 주세요.' : catalog.length ? '검색 결과가 없습니다.' : '왼쪽에서 나비를 등록해 주세요.'}</td></tr>}</tbody></table></div>
    <div className="catalog-scrollbar"><input ref={scrollInput} type="range" min={0} max={scroll.max} step={1} value={scroll.left} disabled={scroll.max === 0} aria-label="도감 가로 스크롤" aria-controls="catalog-scroll-area" aria-valuetext={`${Math.round(scroll.max ? scroll.left / scroll.max * 100 : 0)}%`} style={{ '--scroll-thumb-width': `${scroll.thumbWidth}px` } as CSSProperties} onChange={e => moveScroll(Number(e.target.value))} onKeyDown={e => {
      const page = scrollArea.current?.clientWidth || 0
      const deltas: Record<string, number> = { ArrowLeft: -48, ArrowRight: 48, PageUp: -page, PageDown: page }
      if (e.key === 'Home' || e.key === 'End' || e.key in deltas) {
        e.preventDefault(); moveScroll(e.key === 'Home' ? 0 : e.key === 'End' ? scroll.max : scroll.left + deltas[e.key])
      }
    }} /></div>
    {editing && !editMode && <SpeciesInfoModal species={editing.species} document={editing.document} surveys={surveys} onClose={()=>{setEditing(null);onEditing(false)}} onEdit={()=>setEditMode(true)}/> }
    {editing && editMode && <ReferenceModal species={editing.species} initial={editing.document} onClose={() => setEditMode(false)} onSaved={reference => { setCatalog(current => current.map(s => s.id === editing.species.id ? { ...s, reference, host_plants: reference.host_plants } : s)); onUpdated({ ...editing.species, host_plants: reference.host_plants }); setEditing(null); onEditing(false); setNotice('나비 정보를 저장했습니다.') }} />}
  </section>
}

const CatalogRow = memo(function CatalogRow({s,busy,onOpen,samples,filter,positionReady}:{positionReady:boolean;s:SpeciesCatalog;busy:boolean;onOpen:(s:Species)=>void;samples:typeof noSamples;filter:LifeFilter}) {
  return <tr data-species-id={s.id}><td className="catalog-name">{s.reference.representative_photo_id&&<img className="catalog-representative" onError={e=>{e.currentTarget.style.display='none'}} src={`/api/photos/${s.reference.representative_photo_id}/display?size=small`} alt={`${s.korean_name} 대표사진`} loading="lazy" onDoubleClick={()=>void onOpen(s)}/>}<button className="link" disabled={busy} title={`${s.korean_name} 기본 정보 · 더블클릭`} onDoubleClick={() => void onOpen(s)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void onOpen(s)}}}>{s.korean_name}</button><small>{s.scientific_name || '학명 미등록'}</small><div className="species-statuses" aria-label={`${s.korean_name} 상태`}>{speciesStatuses(s.reference).map((badge, index) => <span key={index} className={`species-status status-${badge.tone}`} title={badge.detail}>{badge.label}</span>)}</div></td><td><VisibleLifeChart positionReady={positionReady} name={s.korean_name} reference={s.reference} samples={samples} filter={filter} /></td><td title={s.reference.host_plants}>{s.reference.host_plants ? <ul className="host-plant-list">{hostPlantLines(s.reference.host_plants).map((plant, index) => <li key={index}>{plant}</li>)}</ul> : <span className="catalog-unregistered">미등록</span>}</td><td>{s.reference.habitat || <span className="catalog-unregistered">미등록</span>}</td><td><CatalogNotes text={s.reference.habits} /></td><td><SpeciesDetails entries={s.reference.details || []} legacy={s.reference.other_notes} legacySource={s.reference.ecology_source} /></td><td><div className="catalog-identification" tabIndex={0} role="button" aria-label={`${s.korean_name} 동정 정보 열기`} onDoubleClick={()=>void onOpen(s)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void onOpen(s)}}}><CatalogNotes text={s.reference.identification_points} /></div></td></tr>
})
