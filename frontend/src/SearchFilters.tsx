// 다중 선택 필터와 초기화를 제공합니다. 선택한 조건은 지도·표에 공통 적용됩니다.
import { useState } from 'react'
import { CAPTURE, RESULT, SEX, STAGE } from './models'
import type { Species } from './models'
import { emptyFilters } from './recordSearch'
import type { Filters } from './recordSearch'
export default function SearchFilters({ value, onChange, species, disabled, reset }: { value: Filters; onChange: (f: Filters) => void; species: Species[]; disabled: boolean; reset: () => void }) {
  const [speciesQuery, setSpeciesQuery] = useState('')
  const count = Object.values(value).reduce((sum, v) => sum + (Array.isArray(v) ? v.length : v ? 1 : 0), 0)
  const choose = (key: 'species' | 'stage' | 'sex' | 'result' | 'capture', label: string, options: Record<string, string>) => <details className="filter-group"><summary>{label}{value[key].length ? ` · ${value[key].map(k => options[k] || k).join(', ')}` : ' · 전체'}</summary>{Object.entries(options).map(([k, text]) => <label className="check" key={k}><input type="checkbox" checked={value[key].includes(k)} onChange={e => onChange({ ...value, [key]: e.target.checked ? [...value[key], k] : value[key].filter(v => v !== k) })} />{text}</label>)}</details>
  return <fieldset disabled={disabled} className="search-filters"><details><summary>상세 필터 · {count}개 조건</summary>
    <label>시작일<input type="date" value={value.start} onChange={e => onChange({ ...value, start: e.target.value })} /></label>
    <label>종료일<input type="date" value={value.end} onChange={e => onChange({ ...value, end: e.target.value })} /></label>
    {value.start && value.end && value.start > value.end && <p role="alert" className="error">시작일은 종료일 이전이어야 합니다.</p>}
    <label>장소 필터<input value={value.place} onChange={e => onChange({ ...value, place: e.target.value })} /></label>
    <label>필터 종 찾기<input value={speciesQuery} onChange={e => setSpeciesQuery(e.target.value)} /></label>
    {choose('species', '종', { unknown: '동정 미확정', ...Object.fromEntries(species.filter(s => value.species.includes(String(s.id)) || `${s.korean_name} ${s.scientific_name || ''}`.toLowerCase().includes(speciesQuery.toLowerCase())).map(s => [String(s.id), s.korean_name])) })}
    {choose('stage', '발육 단계', STAGE)}{choose('sex', '성별', SEX)}{choose('result', '기록 결과', RESULT)}{choose('capture', '채집 여부', CAPTURE)}
    {(['time', 'coordinates', 'weather'] as const).map(key => <label key={key}>{({ time: '관찰 시각', coordinates: '위치 좌표', weather: '기상자료' })[key]}<select value={value[key]} onChange={e => onChange({ ...value, [key]: e.target.value })}><option value="">전체</option>{Object.entries(key === 'weather' ? { none: '미연결', current: '현재 조건과 일치', stale: '이전 조건의 자료' } : { yes: '있음', no: '미상·없음' }).map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>)}
  </details><button type="button" onClick={() => { onChange(emptyFilters()); setSpeciesQuery(''); reset() }}>전체 초기화</button></fieldset>
}
