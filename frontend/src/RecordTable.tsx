import {readView,writeView} from './viewMemory'
// 실제 관찰을 일정한 높이의 가상 목록으로 표시하고 직접 탐사·소장 보기로 전환합니다.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CAPTURE, LOCATION, RESULT, SEX, STAGE, SOURCE_TYPE } from './models'
import type { Survey, ExplorationRow } from './models'
import { isDirectSurvey, sortEntries, weatherState } from './recordSearch'
import type { RecordRow, TableEntry } from './recordSearch'
const extras = { tags: '환경·개체 태그', result: '관찰·미발견', source: '관찰 출처', sourceNote: '출처 근거', stage: '성장 단계', sex: '성별', count: '관찰 개체 수', capture: '채집 여부', captured: '채집 개체 수', coords: '좌표', method: '위치 입력 방식', notes: '메모', updated: '최근 수정', period: '어른벌레 출현 참고 기간', days: '예상 출현 기간 남은 일수', history: '내 채집 이력', regions: '분포 참고', evidence: '참고자료 출처' }
type Extra = keyof typeof extras
const slot = (n: number) => `${Math.floor((n - 1) / 3) + 1}월 ${['상순', '중순', '하순'][(n - 1) % 3]}`
export default function RecordTable({ rows, surveys, references, ranks, onSelect, onOpen, selectedId, mode, holdingsView }: { mode: string; holdingsView: ReactNode; rows: RecordRow[]; surveys: Survey[]; references: Map<number, ExplorationRow>; candidates: ExplorationRow[]; ranks: Map<number, number>; onSelect: (s: Survey, id?: number) => void; onOpen: (s: Survey, id?: number) => void; selectedId: number | null }) {
  const [columns, setColumns] = useState<Extra[]>([])
  const [sort, setSort] = useState('classification')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  function sortBy(key: string) { resetScroll(); setSort(key); setDirection(sort === key && direction === 'asc' ? 'desc' : 'asc') }
  const entries = useMemo<TableEntry[]>(() => rows.map(row => ({kind:'record',row})), [rows])
  const sorted = useMemo(() => sortEntries(entries, references, ranks, sort, direction), [entries,references,ranks,sort,direction])
  const directSurveys = useMemo(() => surveys.filter(isDirectSurvey), [surveys])
  const scroller = useRef<HTMLDivElement>(null)
  const [windowSize, setWindowSize] = useState(24)
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => setWindowSize(Math.ceil(element.clientHeight / 72) + 16)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [mode])
  const [scrollPosition, setScrollPosition] = useState({rows, row:0})
  const scrollRow = scrollPosition.rows === rows ? scrollPosition.row : 0
  const scrollKey = `${mode}:${sort}:${direction}:${rows.map(r => r.record.id).join(',')}`
  useEffect(() => {
    const saved = readView('record-scroll')
    const top = saved.key === scrollKey && typeof saved.top === 'number' ? Math.max(0,saved.top) : 0
    const frame=requestAnimationFrame(()=>{setScrollPosition({rows,row:Math.floor(top/72)});if(scroller.current){scroller.current.scrollTop=top;scroller.current.scrollLeft=typeof saved.left==='number'?saved.left:0}})
    return ()=>cancelAnimationFrame(frame)
  }, [rows,scrollKey])
  const windowStart = Math.min(Math.max(0,scrollRow-8),Math.max(0,sorted.length-windowSize))
  const visibleEntries = sorted.slice(windowStart,windowStart+windowSize)
  function resetScroll() { if(scroller.current) scroller.current.scrollTop=0; setScrollPosition({rows,row:0}) }

  const refFor = (e: TableEntry) => e.kind === 'reference' ? e.reference : references.get(e.row.record.species_id ?? -1)
  function extra(e: TableEntry, key: Extra) {
    const ref = refFor(e)
    if (key === 'period') return ref?.reference.periods.map(p => `${slot(p.start)} ~ ${slot(p.end)}`).join(', ') || '기간 미등록'
    if (key === 'days') return !ref || ref.active === null ? '기간 미등록' : !ref.active ? '현재 참고 기간 밖' : ref.year_round ? '연중 참고 기간' : `약 ${ref.days_left}일 남음`
    if (key === 'history') return ref ? ({ unknown: '미확인', captured: '채집한 종', not_captured: '미채집 확인' })[ref.capture_history] : '미확인'
    if (key === 'regions') return ref?.reference.regions.join(', ') || '미등록'
    if (key === 'evidence') return ref?.reference.source || '미등록'
    if (e.kind === 'reference') return key === 'source' ? '종 참고 · 관찰 기록 아님' : '해당 없음'
    const r = e.row.record
    switch (key) {
      case 'tags': return r.effective_tags.join(', ') || '미기재'
      case 'result': return RESULT[r.result]
      case 'source': return SOURCE_TYPE[r.source_type]
      case 'sourceNote': return r.source_note || '미등록'
      case 'stage': return r.result === 'not_found' ? '해당 없음' : STAGE[r.stage]
      case 'sex': return r.result === 'not_found' ? '해당 없음' : SEX[r.sex]
      case 'count': return r.result === 'not_found' ? '해당 없음' : r.count === null ? '미상' : `${r.count}${r.count_estimated ? ' (추정)' : ''}`
      case 'capture': return CAPTURE[r.capture_status]
      case 'captured': return r.capture_status === 'captured' ? r.captured_count ?? '미상' : '해당 없음'
      case 'coords': return r.effective_latitude === null ? '미지정' : `${r.effective_latitude}, ${r.effective_longitude}`
      case 'method': return LOCATION[r.place_name || r.latitude !== null ? r.location_method : e.row.survey.location_method]
      case 'notes': return r.notes || e.row.survey.notes || '없음'
      case 'updated': return new Date(e.row.survey.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
    }
  }
  return <section className="record-results">
    <div className="record-controls catalog-toolbar"><h2>{mode === 'holdings' ? '소장 목록' : '관찰 기록표'}</h2>
      {mode !== 'holdings' && <><label className="record-sort">정렬<select value={sort} disabled={mode !== 'records'} onChange={e => { resetScroll(); setSort(e.target.value) }}><option value="classification">분류 순서</option><option value="date">관찰 날짜·시각</option><option value="name">국명</option><option value="count">관찰 개체 수</option><option value="days">예상 출현 기간 남은 일수</option></select></label>
      <button disabled={mode !== 'records'} onClick={() => {resetScroll();setDirection(direction === 'asc' ? 'desc' : 'asc')}}>{direction === 'asc' ? '오름차순' : '내림차순'}</button>
      <details className="record-column-menu" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary')?.focus() } }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false }}><summary>표시 열 선택</summary><div className="column-options">{Object.entries(extras).map(([key, text]) => <label className="check" key={key}><input type="checkbox" disabled={mode !== 'records'} checked={columns.includes(key as Extra)} onChange={e => setColumns(e.target.checked ? [...columns, key as Extra] : columns.filter(k => k !== key))} />{text}</label>)}</div></details></>}
    </div>
    {mode === 'holdings' ? holdingsView : mode === 'records' ? <>
      <div className="table-wrap record-scroll" tabIndex={0} aria-label="관찰 기록 목록" ref={scroller} onScroll={e=>{setScrollPosition({rows,row:Math.floor(e.currentTarget.scrollTop/72)});writeView('record-scroll',{key:scrollKey,top:e.currentTarget.scrollTop,left:e.currentTarget.scrollLeft})}}><table className="record-table" style={{minWidth: `${(5+columns.length)*180}px`}}><thead><tr><th><button className="link" onClick={() => sortBy('name')}>국명</button></th><th>학명</th><th>장소</th><th><button className="link" onClick={() => sortBy('date')}>시간</button></th><th>기상</th>{columns.map(k => <th key={k}>{k === 'count' || k === 'days' ? <button className="link" onClick={() => sortBy(k)}>{extras[k]}</button> : extras[k]}</th>)}</tr></thead><tbody>{windowStart>0&&<tr className="record-spacer" aria-hidden="true"><td colSpan={5+columns.length} style={{height:windowStart*72}}/></tr>}{visibleEntries.map(e => {
        const isRecord = e.kind === 'record'
        const r = isRecord ? e.row.record : null
        const ref = refFor(e)
        const choose = () => { if (isRecord) onSelect(e.row.survey, e.row.record.id) }
        return <tr key={isRecord ? `record-${e.row.record.id}` : `reference-${e.reference.id}`} className={isRecord ? selectedId === e.row.survey.id ? 'selected' : '' : 'reference-row'} onClick={isRecord ? choose : undefined} onDoubleClick={isRecord ? () => onOpen(e.row.survey, e.row.record.id) : undefined} onKeyDown={isRecord ? event => { if (event.key === 'Enter') { event.preventDefault(); onOpen(e.row.survey, e.row.record.id) } } : undefined}>
          <td><div className="record-cell">{isRecord ? <button className="link" onClick={event => { event.stopPropagation(); choose() }}>{r?.species_name || '동정 미확정'}</button> : e.reference.korean_name}{!isRecord && <small>종 참고 · 관찰 기록 없음</small>}{r?.source_type === 'indirect' && <small>간접 관찰</small>}</div></td><td><div className="record-cell">{isRecord ? e.row.scientificName || '미등록' : e.reference.scientific_name || '미등록'}</div></td><td><div className="record-cell">{isRecord ? r?.display_place || r?.effective_place || '좌표 지정 위치' : `분포 참고: ${ref?.reference.regions.join(', ') || '미등록'}`}</div></td><td><div className="record-cell">{r ? <>{r.effective_date}{r.observation_time && ` ${r.observation_time.slice(0,5)}`}</> : '관찰 기록 없음'}</div></td>
          <td className="weather-cell"><div className="record-cell">{isRecord ? <>{({ none: '미연결', current: '저장됨', stale: '이전 조건 자료' })[weatherState(e.row)]}{e.row.weather?.weather ? <small>{e.row.weather.weather.kind === 'daily' ? '일자료' : '시간자료'} · {e.row.weather.weather.values.slice(0, 3).map(v => `${v.label} ${v.value === null ? '자료 없음' : `${v.value}${v.unit}`}`).join(' · ')}</small> : e.row.record.source_weather && <small>{e.row.record.source_weather.source} · {e.row.record.source_weather.text}</small>}</> : '해당 없음'}</div></td>
          {columns.map(k => <td className="memo-cell" title={String(extra(e, k))} key={k}><div className="record-cell">{extra(e, k)}</div></td>)}
        </tr>
      })}{windowStart+visibleEntries.length<sorted.length&&<tr className="record-spacer" aria-hidden="true"><td colSpan={5+columns.length} style={{height:(sorted.length-windowStart-visibleEntries.length)*72}}/></tr>}</tbody></table></div>{!entries.length && <p className="empty">조건에 맞는 관찰 기록이 없습니다.</p>}</> : <div className="table-wrap"><table className="survey-record-table"><thead><tr><th>날짜</th><th>장소</th><th>종별 기록</th></tr></thead><tbody>{directSurveys.map(s => <tr key={s.id} className={selectedId===s.id?'selected':''} tabIndex={0} onClick={event=>{if(!(event.target instanceof Element) || !event.target.closest('input,a,select,textarea'))onSelect(s)}} onDoubleClick={() => onOpen(s)} onKeyDown={event=>{if(event.target===event.currentTarget && event.key==='Enter'){event.preventDefault();onOpen(s)}}}><td><button className="link survey-date-button" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onOpen(s) } }} onClick={() => onSelect(s)}>{s.survey_date}</button></td><td>{s.display_place || s.place_name || '좌표 지정 장소'}</td><td>{s.observations.length}건 (탐사 전체)</td></tr>)}</tbody></table>{!directSurveys.length && <p className="empty">조건에 맞는 탐사가 없습니다.</p>}</div>}
  </section>
}
