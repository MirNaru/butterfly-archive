// 실제 관찰 한 건과 기록 없는 종의 참고 행을 구분하여 하나의 표에 표시합니다.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { CAPTURE, IDENTIFICATION, LOCATION, RESULT, SEX, STAGE, SOURCE_TYPE } from './models'
import type { Survey, ExplorationRow } from './models'
import { sortEntries, weatherState } from './recordSearch'
import type { RecordRow, TableEntry } from './recordSearch'
const extras = { tags: '환경 태그', result: '관찰·미발견', source: '관찰 출처', sourceNote: '출처 근거', stage: '발육 단계', sex: '성별', count: '관찰 개체 수', capture: '채집 여부', captured: '채집 개체 수', coords: '좌표', method: '위치 입력 방식', identification: '동정 상태', notes: '메모', updated: '최근 수정', period: '어른벌레 출현 참고 기간', days: '예상 출현 기간 남은 일수', history: '내 채집 이력', regions: '분포 참고', evidence: '참고자료 출처' }
type Extra = keyof typeof extras
const slot = (n: number) => `${Math.floor((n - 1) / 3) + 1}월 ${['상순', '중순', '하순'][(n - 1) % 3]}`
export default function RecordTable({ rows, surveys, references, candidates, ranks, onSelect, onOpen, selectedId, mode, onModeChange, holdingsView }: { mode: string; onModeChange: (mode: string) => void; holdingsView: ReactNode; rows: RecordRow[]; surveys: Survey[]; references: Map<number, ExplorationRow>; candidates: ExplorationRow[]; ranks: Map<number, number>; onSelect: (s: Survey, id?: number) => void; onOpen: (s: Survey, id?: number) => void; selectedId: number | null }) {
  const [columns, setColumns] = useState<Extra[]>([])
  const [sort, setSort] = useState('classification')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  function sortBy(key: string) { setSort(key); setDirection(sort === key && direction === 'asc' ? 'desc' : 'asc') }
  const entries: TableEntry[] = [...rows.map(row => ({ kind: 'record' as const, row })), ...candidates.map(reference => ({ kind: 'reference' as const, reference }))]
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
      case 'identification': return IDENTIFICATION[r.identification]
      case 'notes': return r.notes || e.row.survey.notes || '없음'
      case 'updated': return new Date(e.row.survey.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
    }
  }
  return <section className="record-results">
    <div className="record-controls">
      <select aria-label="표 종류" value={mode} onChange={e => onModeChange(e.target.value)}><option value="records">관찰 기록</option><option value="surveys">탐사 목록</option><option value="holdings">소장 목록</option></select>
      {mode !== 'holdings' && <><label className="record-sort">정렬<select value={sort} disabled={mode !== 'records'} onChange={e => setSort(e.target.value)}><option value="classification">분류 순서</option><option value="date">관찰 날짜·시각</option><option value="name">국명</option><option value="count">관찰 개체 수</option><option value="days">예상 출현 기간 남은 일수</option></select></label>
      <button disabled={mode !== 'records'} onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}>{direction === 'asc' ? '오름차순' : '내림차순'}</button>
      <details className="record-column-menu" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary')?.focus() } }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false }}><summary>표시 열 선택</summary><div className="column-options">{Object.entries(extras).map(([key, text]) => <label className="check" key={key}><input type="checkbox" disabled={mode !== 'records'} checked={columns.includes(key as Extra)} onChange={e => setColumns(e.target.checked ? [...columns, key as Extra] : columns.filter(k => k !== key))} />{text}</label>)}</div></details></>}
    </div>
    {mode === 'holdings' ? holdingsView : mode === 'records' ? <>
      <div className="table-wrap"><table className="record-table"><thead><tr><th><button className="link" onClick={() => sortBy('name')}>국명</button></th><th>학명</th><th>장소</th><th><button className="link" onClick={() => sortBy('date')}>시간</button></th><th>기상</th>{columns.map(k => <th key={k}>{k === 'count' || k === 'days' ? <button className="link" onClick={() => sortBy(k)}>{extras[k]}</button> : extras[k]}</th>)}</tr></thead><tbody>{sortEntries(entries, references, ranks, sort, direction).map(e => {
        const isRecord = e.kind === 'record'
        const r = isRecord ? e.row.record : null
        const ref = refFor(e)
        const choose = () => { if (isRecord) onSelect(e.row.survey, e.row.record.id) }
        return <tr key={isRecord ? `record-${e.row.record.id}` : `reference-${e.reference.id}`} className={isRecord ? selectedId === e.row.survey.id ? 'selected' : '' : 'reference-row'} onClick={isRecord ? choose : undefined} onDoubleClick={isRecord ? () => onOpen(e.row.survey, e.row.record.id) : undefined} onKeyDown={isRecord ? event => { if (event.key === 'Enter') { event.preventDefault(); onOpen(e.row.survey, e.row.record.id) } } : undefined}>
          <td>{isRecord ? <button className="link" onClick={event => { event.stopPropagation(); choose() }}>{r?.species_name || '동정 미확정'}</button> : e.reference.korean_name}{!isRecord && <small>종 참고 · 관찰 기록 없음</small>}{r?.source_type === 'indirect' && <small>간접 관찰</small>}</td><td>{isRecord ? e.row.scientificName || '미등록' : e.reference.scientific_name || '미등록'}</td><td>{isRecord ? r?.display_place || r?.effective_place || '좌표 지정 위치' : `분포 참고: ${ref?.reference.regions.join(', ') || '미등록'}`}</td><td>{r ? <>{r.effective_date}{r.observation_time && ` ${r.observation_time}`}</> : '관찰 기록 없음'}</td>
          <td className="weather-cell">{isRecord ? <>{({ none: '미연결', current: '저장됨', stale: '이전 조건 자료' })[weatherState(e.row)]}{e.row.weather?.weather ? <small>{e.row.weather.weather.kind === 'daily' ? '일자료' : '시간자료'} · {e.row.weather.weather.values.slice(0, 3).map(v => `${v.label} ${v.value === null ? '자료 없음' : `${v.value}${v.unit}`}`).join(' · ')}</small> : e.row.record.source_weather && <small>{e.row.record.source_weather.source} · {e.row.record.source_weather.text}</small>}</> : '해당 없음'}</td>
          {columns.map(k => <td className="memo-cell" title={String(extra(e, k))} key={k}>{extra(e, k)}</td>)}
        </tr>
      })}</tbody></table></div>{!entries.length && <p className="empty">조건에 맞는 기록이나 종 참고 정보가 없습니다. 관찰 날짜·출처·개체 조건을 지정하면 기록 없는 종은 제외됩니다.</p>}</> : <div className="table-wrap"><table><thead><tr><th>날짜</th><th>장소</th><th>종별 기록</th></tr></thead><tbody>{surveys.map(s => <tr key={s.id} onDoubleClick={() => onOpen(s)}><td><button className="link" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onOpen(s) } }} onClick={() => onSelect(s)}>{s.survey_date}</button></td><td>{s.display_place || s.place_name || '좌표 지정 장소'}</td><td>{s.observations.length}건 (탐사 전체)</td></tr>)}</tbody></table>{!surveys.length && <p className="empty">조건에 맞는 탐사가 없습니다.</p>}</div>}
  </section>
}
