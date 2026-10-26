// 참고 기간과 사용자 확인 정보를 사용해 탐사 후보를 찾습니다. 실제 출현 보장이 아닙니다.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { findExploration, getReference } from './api'
import type { ExplorationRow, ReferenceDocument } from './models'
import ReferenceEditor from './ReferenceEditor'
export default function Exploration({ sidebar, onEditing }: { sidebar: HTMLDivElement | null; onEditing: (editing: boolean) => void }) {
  const [on, setOn] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  const [region, setRegion] = useState('')
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState({ active: true, captured: false, north: false, old: false, protected: false })
  const [direction, setDirection] = useState('asc')
  const [rows, setRows] = useState<ExplorationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [editor, setEditor] = useState<{ row: ExplorationRow; doc: ReferenceDocument } | null>(null)
  const [opening, setOpening] = useState(false)
  useEffect(() => {
    let current = true
    if (!on) return
    findExploration(on, region).then(result => { if (current) { setRows(result); setError(''); setLoading(false) } }).catch(e => { if (current) { setRows([]); setError(e instanceof Error ? e.message : '탐사 자료를 읽지 못했습니다.'); setLoading(false) } })
    return () => { current = false }
  }, [on, region, revision])
  const filtered = rows.filter(r => (!options.active || r.active === true) && (!options.captured || r.capture_history !== 'captured') && (!options.north || r.reference.north_only !== true) && (!options.old || !r.old_vagrant) && (!options.protected || r.reference.protected !== true) && r.region_match && `${r.korean_name} ${r.scientific_name || ''}`.toLowerCase().includes(query.toLowerCase()))
  const ordered = [...filtered].sort((a, b) => a.days_left === null || b.days_left === null ? a.days_left === b.days_left ? a.korean_name.localeCompare(b.korean_name) : a.days_left === null ? 1 : -1 : (a.days_left - b.days_left) * (direction === 'asc' ? 1 : -1) || a.korean_name.localeCompare(b.korean_name))
  const denominator = rows.filter(r => r.active === true).length
  const numerator = filtered.filter(r => r.active === true && r.capture_history === 'not_captured' && r.permission === 'permitted' && r.reference.protected === false).length
  async function edit(row: ExplorationRow) {
    setOpening(true); setError('')
    try { setEditor({ row, doc: await getReference(row.id) }); onEditing(true) } catch (e) { setError(e instanceof Error ? e.message : '참고자료를 읽지 못했습니다.') } finally { setOpening(false) }
  }
  if (editor) return <ReferenceEditor key={editor.row.id} species={editor.row} initial={editor.doc} onClose={() => { setEditor(null); onEditing(false) }} onSaved={() => { setEditor(null); onEditing(false); setLoading(true); setRevision(n => n + 1) }} />
  const controls = <div className="exploration-controls">    <div className="field-grid"><label>탐사 기준일<input type="date" required value={on} onChange={e => { setOn(e.target.value); setRows([]); setLoading(!!e.target.value) }} /></label><label>목표 지역<input value={region} onChange={e => { setRegion(e.target.value); setRows([]); setLoading(true) }} placeholder="참고자료에 등록한 지역" /></label><label>종 검색<input value={query} onChange={e => setQuery(e.target.value)} /></label><label>예상 출현 기간 정렬<select value={direction} onChange={e => setDirection(e.target.value)}><option value="asc">남은 기간 오름차순</option><option value="desc">남은 기간 내림차순</option></select></label></div>
    <div className="column-options">{Object.entries({ active: '현재 출현 참고 종만', captured: '이미 채집한 종 제외', north: '북한에만 분포하는 종 제외', old: '미갱신 미접 제외 · 2010년 이전', protected: '국가보호종 제외' }).map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={options[key as keyof typeof options]} onChange={e => setOptions({ ...options, [key]: e.target.checked })} />{label}</label>)}</div>
    <button onClick={() => { setQuery(''); setRegion(''); setOptions({ active: true, captured: false, north: false, old: false, protected: false }); setDirection('asc'); setRows([]); setLoading(true); setRevision(n => n + 1) }}>조건 초기화</button> <button disabled={loading} onClick={() => { setLoading(true); setRevision(n => n + 1) }}>새로고침</button>
</div>
  return <section className="exploration"><h2>탐사 대상 찾기</h2><p className="hint">성충 참고 기간 기준입니다. 실제 현장 출현을 보장하지 않습니다. 종의 분포를 관찰 핀으로 만들지 않습니다.</p>
    {sidebar ? createPortal(controls, sidebar) : controls}
    {error && <p className="error" role="alert">{error}</p>}{!on && <p role="alert">기준일을 입력해 주세요.</p>}{loading ? <p role="status">참고자료를 읽는 중입니다.</p> : on && !error && <>
      <p className="notice">조건에 맞는 미채집·채집 가능 확인 종 {numerator} / 현재 출현 참고 종 {denominator} · {denominator ? `${(numerator / denominator * 100).toFixed(1)}%` : '계산 대상 없음'}</p>
      <p className="hint">분모는 등록된 전체 종 중 기준일의 출현 참고 종입니다. 분자는 현재 검색·제외 조건, 미채집 확인, 보호종 아님, 목표 지역·기간의 채집 가능 확인을 모두 만족해야 합니다. 미확인은 분자에 포함하지 않습니다.</p>
      <p>결과 {ordered.length}종 · 출현 기간 미등록 {rows.filter(r => r.active === null).length}종 · 채집 이력 미확인 {rows.filter(r => r.capture_history === 'unknown').length}종</p>
      <div className="table-wrap"><table><thead><tr><th>국명·학명</th><th>예상 출현 기간</th><th>분포</th><th>채집 이력</th><th>분류·확인 상태</th><th>근거·입력</th></tr></thead><tbody>{ordered.map(r => <tr key={r.id}><td>{r.korean_name}<small>{r.scientific_name || '학명 미등록'}</small></td><td>{r.active === null ? '기간 미등록' : !r.active ? '현재 참고 기간 밖' : r.year_round ? '연중 참고 기간' : `약 ${r.days_left}일 남음`}{r.next_period && <small>올해 다음 출현 구간 있음</small>}</td><td>{r.reference.regions.join(', ') || '미확인'}</td><td>{({ unknown: '미확인', captured: '채집한 종', not_captured: '미채집 확인' })[r.capture_history]}</td><td>{r.old_vagrant ? '미갱신 미접' : r.reference.vagrant ? `미접 · ${r.reference.sighting_years.join(', ') || '연도 미확인'}` : r.reference.vagrant === false ? '미접 아님' : '미접 여부 미확인'}<small>보호종 {r.reference.protected === null ? '미확인' : r.reference.protected ? '해당' : '아님'} · 채집 {({ unknown: '판단 미확인', permitted: '가능 확인', prohibited: '불가 확인' })[r.permission]}</small></td><td className="memo-cell" title={r.reference.source}>{r.reference.source || '출처 미등록'}<button disabled={opening} onClick={() => void edit(r)}>기본 정보 편집</button></td></tr>)}</tbody></table></div>
      {!ordered.length && <p className="empty">조건에 맞는 종이 없습니다. 참고자료를 입력하려면 ‘현재 출현 참고 종만’을 해제하고 목표 지역을 비워 주세요. 나비 기본 정보 메뉴에서 종 정보를 등록할 수 있습니다.</p>}
    </>}
  </section>
}
