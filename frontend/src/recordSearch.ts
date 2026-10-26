// 관찰 필터와 표·지도에 전달할 동일한 검색 결과를 계산합니다.
import type { Observation, Species, Survey, SavedWeather } from './models'
export interface RecordRow { survey: Survey; record: Observation; scientificName: string; weather?: SavedWeather }
export interface Filters {
  start: string; end: string; place: string; species: string[]; stage: string[]; sex: string[]; result: string[]; capture: string[]
  time: string; coordinates: string; weather: string
}
export const emptyFilters = (): Filters => ({ start: '', end: '', place: '', species: [], stage: [], sex: [], result: [], capture: [], time: '', coordinates: '', weather: '' })
export function weatherState(row: RecordRow) { return !row.weather?.weather ? 'none' : row.weather.weather.stale ? 'stale' : 'current' }
const contains = (text: string, query: string) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
const member = (values: string[], value: string) => !values.length || values.includes(value)
export function rowsFor(surveys: Survey[], species: Species[], weather: Record<number, SavedWeather>): RecordRow[] {
  const names = new Map(species.map(s => [s.id, s.scientific_name || '']))
  return surveys.flatMap(survey => survey.observations.map(record => ({ survey, record, scientificName: names.get(record.species_id ?? -1) || '', weather: weather[record.id] })))
}
export function matches(row: RecordRow, f: Filters, query: string): boolean {
  const r = row.record
  if (f.start && f.end && f.start > f.end) return false
  return contains(`${r.species_name || '동정 미확정'} ${row.scientificName} ${r.effective_place} ${row.survey.place_name} ${r.effective_date} ${r.notes} ${row.survey.notes}`, query)
    && (!f.start || r.effective_date >= f.start) && (!f.end || r.effective_date <= f.end)
    && contains(r.effective_place, f.place) && member(f.species, String(r.species_id ?? 'unknown'))
    && (!f.stage.length || r.result === 'observed' && member(f.stage, r.stage))
    && (!f.sex.length || r.result === 'observed' && member(f.sex, r.sex))
    && member(f.result, r.result) && member(f.capture, r.capture_status)
    && (!f.time || (f.time === 'yes') === !!r.observation_time)
    && (!f.coordinates || (f.coordinates === 'yes') === (r.effective_latitude !== null && r.effective_longitude !== null))
    && (!f.weather || weatherState(row) === f.weather)
}
export function emptySurveyMatches(s: Survey, f: Filters, query: string): boolean {
  if (s.observations.length || f.species.length || f.stage.length || f.sex.length || f.result.length || f.capture.length || f.time || f.weather) return false
  return !(f.start && f.end && f.start > f.end) && contains(`${s.place_name} ${s.survey_date} ${s.notes}`, query)
    && contains(s.place_name, f.place) && (!f.start || s.survey_date >= f.start) && (!f.end || s.survey_date <= f.end)
    && (!f.coordinates || (f.coordinates === 'yes') === (s.latitude !== null && s.longitude !== null))
}
export function sortRows(rows: RecordRow[], key: string, direction: 'asc' | 'desc') {
  return [...rows].sort((a, b) => {
    const value = (row: RecordRow) => key === 'name' ? row.record.species_name || '동정 미확정' : key === 'count' ? row.record.count : `${row.record.effective_date} ${row.record.observation_time || ''}`
    const x = value(a), y = value(b)
    if (x === null || y === null) return x === y ? a.record.id - b.record.id : x === null ? 1 : -1
    const result = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko')
    return result * (direction === 'asc' ? 1 : -1) || a.record.id - b.record.id
  })
}
