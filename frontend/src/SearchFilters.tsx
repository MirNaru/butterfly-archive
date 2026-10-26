// 기존 검색 조건을 여섯 개의 아이콘과 펼침 영역으로 제공합니다.
import { useState } from 'react'
import { CAPTURE, RESULT, SEX, STAGE } from './models'
import type { Species } from './models'
import { emptyFilters } from './recordSearch'
import type { Filters } from './recordSearch'
const GROUPS = [
  { name: '날짜·시각', path: 'M7 3v4m10-4v4M4 10h16M5 5h14v15H4V5Zm3 9h3m-3 3h6', keys: ['start', 'end', 'time'] },
  { name: '종', path: 'M12 11C8 2 2 3 3 9c0 3 4 4 8 4-7-1-8 6-4 7 3 1 5-4 5-7 0 3 2 8 5 7 4-1 3-8-4-7 4 0 8-1 8-4 1-6-5-7-9 2Zm0 0v9', keys: ['species'] },
  { name: '관찰 특성', path: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', keys: ['stage', 'sex', 'result'] },
  { name: '채집', path: 'M5 6h14v14H5V6Zm3 0V3h8v3m-8 7 3 3 5-6', keys: ['capture'] },
  { name: '위치', path: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Zm-4 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', keys: ['place', 'coordinates'] },
  { name: '기상', path: 'M8 3v2M3 8h2m1-5 1 2m7-2-1 2M6 12a5 5 0 1 1 10-3m-8 9h10a4 4 0 1 0-1-8 5 5 0 0 0-9 2 3 3 0 0 0 0 6Z', keys: ['weather'] },
] as const
export default function SearchFilters({ value, onChange, species, disabled, reset }: { value: Filters; onChange: (f: Filters) => void; species: Species[]; disabled: boolean; reset: () => void }) {
  const [speciesQuery, setSpeciesQuery] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const count = Object.values(value).reduce((sum, v) => sum + (Array.isArray(v) ? v.length : v ? 1 : 0), 0)
  const choose = (key: 'species' | 'stage' | 'sex' | 'result' | 'capture', label: string, options: Record<string, string>) => <details className="filter-group" open={key === 'species' || undefined}><summary>{label}{value[key].length ? ` · ${value[key].length}개 선택` : ' · 전체'}</summary><div className="filter-options">{Object.entries(options).map(([k, text]) => <label className="check" key={k}><input type="checkbox" checked={value[key].includes(k)} onChange={e => onChange({ ...value, [key]: e.target.checked ? [...value[key], k] : value[key].filter(v => v !== k) })} />{text}</label>)}</div></details>
  const presence = (key: 'time' | 'coordinates' | 'weather', label: string) => <label>{label}<select value={value[key]} onChange={e => onChange({ ...value, [key]: e.target.value })}><option value="">전체</option>{Object.entries(key === 'weather' ? { none: '미연결', current: '현재 조건과 일치', stale: '이전 조건의 자료' } : { yes: '있음', no: '미상·없음' }).map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>
  return <fieldset disabled={disabled} className="search-filters">
    <div className="filter-icons" aria-label="상세 필터">{GROUPS.map((group, index) => {
      const active = group.keys.some(key => Array.isArray(value[key]) ? value[key].length > 0 : !!value[key])
      return <button key={group.name} type="button" className={`icon-button has-tooltip${active ? ' has-value' : ''}`} aria-label={`${group.name} 필터${active ? ' · 적용 중' : ''}`} aria-expanded={open === index} aria-controls="record-filter-panel" data-tooltip={group.name} onClick={() => setOpen(open === index ? null : index)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={group.path} /></svg>{active && <span className="filter-dot" />}</button>
    })}</div>
    {open !== null && <section id="record-filter-panel" className="filter-panel" aria-label={`${GROUPS[open].name} 조건`} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); const fieldset = e.currentTarget.closest('fieldset'); (fieldset?.querySelectorAll<HTMLButtonElement>('.filter-icons button')[open])?.focus() } }}><div className="filter-panel-heading"><h3>{GROUPS[open].name}</h3><button type="button" className="quiet" aria-label="필터 닫기" onClick={() => setOpen(null)}>닫기</button></div>
      {open === 0 && <><label>시작일<input type="date" value={value.start} onChange={e => onChange({ ...value, start: e.target.value })} /></label><label>종료일<input type="date" value={value.end} onChange={e => onChange({ ...value, end: e.target.value })} /></label>{value.start && value.end && value.start > value.end && <p role="alert" className="error">시작일은 종료일 이전이어야 합니다.</p>}{presence('time', '관찰 시각')}</>}
      {open === 1 && <><label>필터 종 찾기<input value={speciesQuery} onChange={e => setSpeciesQuery(e.target.value)} /></label>{choose('species', '종', { unknown: '동정 미확정', ...Object.fromEntries(species.filter(s => value.species.includes(String(s.id)) || `${s.korean_name} ${s.scientific_name || ''}`.toLowerCase().includes(speciesQuery.toLowerCase())).map(s => [String(s.id), s.korean_name])) })}</>}
      {open === 2 && <>{choose('stage', '발육 단계', STAGE)}{choose('sex', '성별', SEX)}{choose('result', '기록 결과', RESULT)}</>}
      {open === 3 && choose('capture', '채집 여부', CAPTURE)}
      {open === 4 && <><label>장소 필터<input value={value.place} onChange={e => onChange({ ...value, place: e.target.value })} /></label>{presence('coordinates', '위치 좌표')}</>}
      {open === 5 && presence('weather', '기상자료')}
    </section>}
    <div className="filter-summary"><span>필터 {count}개 조건</span><button type="button" className="quiet" onClick={() => { onChange(emptyFilters()); setSpeciesQuery(''); reset() }}>전체 초기화</button></div>
  </fieldset>
}
