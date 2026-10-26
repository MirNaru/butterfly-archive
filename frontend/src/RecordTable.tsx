// 종별 기록을 기본 다섯 열과 선택 열로 표시하고 정렬합니다.
import { useState } from 'react'
import { CAPTURE, IDENTIFICATION, LOCATION, RESULT, SEX, STAGE } from './models'
import type { Survey } from './models'
import { sortRows, weatherState } from './recordSearch'
import type { RecordRow } from './recordSearch'
const extras = { result: '관찰·미발견', stage: '발육 단계', sex: '성별', count: '관찰 개체 수', capture: '채집 여부', captured: '채집 개체 수', coords: '좌표', method: '위치 입력 방식', identification: '동정 상태', notes: '메모', updated: '최근 수정' }
type Extra = keyof typeof extras
export default function RecordTable({ rows, surveys, onSelect, selectedId }: { rows: RecordRow[]; surveys: Survey[]; onSelect: (s: Survey, id?: number) => void; selectedId: number | null }) {
  const [mode, setMode] = useState('records')
  const [columns, setColumns] = useState<Extra[]>([])
  const [sort, setSort] = useState('date')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  function sortBy(key: string) { setSort(key); setDirection(sort === key && direction === 'asc' ? 'desc' : 'asc') }
  function extra(row: RecordRow, key: Extra) {
    const r = row.record
    switch (key) {
      case 'result': return RESULT[r.result]
      case 'stage': return r.result === 'not_found' ? '해당 없음' : STAGE[r.stage]
      case 'sex': return r.result === 'not_found' ? '해당 없음' : SEX[r.sex]
      case 'count': return r.result === 'not_found' ? '해당 없음' : r.count === null ? '미상' : `${r.count}${r.count_estimated ? ' (추정)' : ''}`
      case 'capture': return CAPTURE[r.capture_status]
      case 'captured': return r.capture_status === 'captured' ? r.captured_count ?? '미상' : '해당 없음'
      case 'coords': return r.effective_latitude === null ? '미지정' : `${r.effective_latitude}, ${r.effective_longitude}`
      case 'method': return LOCATION[r.place_name || r.latitude !== null ? r.location_method : row.survey.location_method]
      case 'identification': return IDENTIFICATION[r.identification]
      case 'notes': return r.notes || row.survey.notes || '없음'
      case 'updated': return new Date(row.survey.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
    }
  }
  return <section><div className="toolbar"><h2>{mode === 'records' ? '종별 기록표' : '조사 목록'}</h2><select aria-label="표 종류" value={mode} onChange={e => setMode(e.target.value)}><option value="records">종별 기록</option><option value="surveys">조사 목록</option></select></div>
    {mode === 'records' ? <><div className="table-controls"><details><summary>표시 열 선택</summary><div className="column-options">{Object.entries(extras).map(([key, text]) => <label className="check" key={key}><input type="checkbox" checked={columns.includes(key as Extra)} onChange={e => setColumns(e.target.checked ? [...columns, key as Extra] : columns.filter(k => k !== key))} />{text}</label>)}</div></details><label>정렬<select value={sort} onChange={e => setSort(e.target.value)}><option value="date">관찰 날짜·시각</option><option value="name">국명</option><option value="count">관찰 개체 수</option></select></label><button onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}>{direction === 'asc' ? '오름차순' : '내림차순'}</button></div>
      <div className="table-wrap"><table className="record-table"><thead><tr><th><button className="link" onClick={() => sortBy('name')}>국명</button></th><th>학명</th><th>장소</th><th><button className="link" onClick={() => sortBy('date')}>시간</button></th><th>기상</th>{columns.map(k => <th key={k}>{k === 'count' ? <button className="link" onClick={() => sortBy('count')}>{extras[k]}</button> : extras[k]}</th>)}</tr></thead><tbody>{sortRows(rows, sort, direction).map(row => <tr key={row.record.id} className={selectedId === row.survey.id ? 'selected' : ''} onClick={() => onSelect(row.survey, row.record.id)}>
        <td><button className="link" onClick={e => { e.stopPropagation(); onSelect(row.survey, row.record.id) }}>{row.record.species_name || '동정 미확정'}</button></td><td>{row.scientificName || '미등록'}</td><td>{row.record.effective_place || '좌표 지정 위치'}</td><td>{row.record.effective_date}{row.record.observation_time && ` ${row.record.observation_time}`}</td>
        <td className="weather-cell">{({ none: '미연결', current: '저장됨', stale: '이전 조건 자료' })[weatherState(row)]}{row.weather?.weather && <small>{row.weather.weather.kind === 'daily' ? '일자료' : '시간자료'} · {row.weather.weather.values.slice(0, 3).map(v => `${v.label} ${v.value === null ? '자료 없음' : `${v.value}${v.unit}`}`).join(' · ')}</small>}</td>
        {columns.map(k => <td className={k === 'notes' ? 'memo-cell' : ''} title={k === 'notes' ? String(extra(row, k)) : undefined} key={k}>{extra(row, k)}</td>)}
      </tr>)}</tbody></table></div>{!rows.length && <p className="empty">조건에 맞는 종별 기록이 없습니다. 종별 기록이 없는 조사는 조사 목록에서 확인하세요.</p>}</> : <div className="table-wrap"><table><thead><tr><th>날짜</th><th>장소</th><th>종별 기록</th></tr></thead><tbody>{surveys.map(s => <tr key={s.id}><td><button className="link" onClick={() => onSelect(s)}>{s.survey_date}</button></td><td>{s.place_name || '좌표 지정 장소'}</td><td>{s.observations.length}건 (조사 전체)</td></tr>)}</tbody></table>{!surveys.length && <p className="empty">조건에 맞는 조사가 없습니다.</p>}</div>}
  </section>
}
