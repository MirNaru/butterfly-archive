// 관찰 필터와 표·지도에 전달할 동일한 검색 결과를 계산합니다.
import type { Observation, Species, Survey, SavedWeather, ExplorationRow } from './models'
export interface RecordRow { survey: Survey; record: Observation; scientificName: string; weather?: SavedWeather }
export interface Filters {
  start: string; end: string; place: string; species: string[]; stage: string[]; sex: string[]; result: string[]; capture: string[]
  time: string; coordinates: string; weather: string; source: string[]; tags: string[]
}
export const emptyFilters = (): Filters => ({ start: '', end: '', place: '', species: [], stage: [], sex: [], result: [], capture: [], time: '', coordinates: '', weather: '', source: [], tags: [] })
export interface TargetFilters { on: string; region: string; active: boolean; captured: boolean; north: boolean; old: boolean; protected: boolean; includeUnrecorded: boolean }
export const emptyTargets = (): TargetFilters => ({ on: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), region: '', active: false, captured: false, north: false, old: false, protected: false, includeUnrecorded: true })
export const hasTargetConditions = (t: TargetFilters) => !!(t.region.trim() || t.active || t.captured || t.north || t.old || t.protected)
export function targetMatches(r: ExplorationRow, t: TargetFilters) {
  return (!t.active || r.active === true) && (!t.captured || r.capture_history !== 'captured') && (!t.north || r.reference.north_only !== true) && (!t.old || !r.old_vagrant) && (!t.protected || r.reference.protected !== true) && r.region_match
}
export function referenceCandidates(references: ExplorationRow[], allRecords: RecordRow[], f: Filters, t: TargetFilters, query: string) {
  if (!t.includeUnrecorded || f.start || f.end || f.place || f.stage.length || f.sex.length || f.result.length || f.capture.length || f.source.length || f.tags.length || f.time || f.coordinates || f.weather) return []
  const recorded = new Set(allRecords.map(r => r.record.species_id))
  return references.filter(r => !recorded.has(r.id) && targetMatches(r, t) && member(f.species, String(r.id)) && contains(`${r.korean_name} ${r.scientific_name || ''}`, query))
}
export function weatherState(row: RecordRow) { return !row.weather?.weather ? 'none' : row.weather.weather.stale ? 'stale' : 'current' }
const contains = (text: string, query: string) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
const member = (values: string[], value: string) => !values.length || values.includes(value)
export function rowsFor(surveys: Survey[], species: Species[], weather: Record<number, SavedWeather>): RecordRow[] {
  const names = new Map(species.map(s => [s.id, s.scientific_name || '']))
  return surveys.flatMap(survey => survey.observations.map(record => ({ survey, record, scientificName: names.get(record.species_id ?? -1) || '', weather: weather[record.id] })))
}
export function matches(row: RecordRow, f: Filters, query: string): boolean {
  const r = row.record
  const tags = [...new Set([...(row.survey.tags || []), ...(r.tags || [])])]
  if (f.start && f.end && f.start > f.end) return false
  return contains(`${r.species_name || '동정 미확정'} ${row.scientificName} ${r.effective_place} ${row.survey.place_name} ${r.effective_date} ${r.notes} ${r.source_note || ''} ${row.survey.notes} ${tags.join(' ')}`, query)
    && (!f.start || r.effective_date >= f.start) && (!f.end || r.effective_date <= f.end)
    && contains(r.effective_place, f.place) && member(f.species, String(r.species_id ?? 'unknown'))
    && (!f.stage.length || r.result === 'observed' && member(f.stage, r.stage))
    && (!f.sex.length || r.result === 'observed' && member(f.sex, r.sex))
    && (!f.tags.length || f.tags.some(tag => tags.includes(tag)))
    && member(f.result, r.result) && member(f.capture, r.capture_status) && member(f.source, r.source_type)
    && (!f.time || (f.time === 'yes') === !!r.observation_time)
    && (!f.coordinates || (f.coordinates === 'yes') === (r.effective_latitude !== null && r.effective_longitude !== null))
    && (!f.weather || weatherState(row) === f.weather)
}
export function emptySurveyMatches(s: Survey, f: Filters, query: string): boolean {
  if (s.observations.length || f.species.length || f.stage.length || f.sex.length || f.result.length || f.capture.length || f.source.length || f.time || f.weather) return false
  return !(f.start && f.end && f.start > f.end) && contains(`${s.place_name} ${s.survey_date} ${s.notes} ${(s.tags || []).join(' ')}`, query)
    && (!f.tags.length || f.tags.some(tag => (s.tags || []).includes(tag)))
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

export type TableEntry = { kind: 'record'; row: RecordRow } | { kind: 'reference'; reference: ExplorationRow }
export function sortEntries(entries: TableEntry[], references: Map<number, ExplorationRow>, ranks: Map<number, number>, key: string, direction: 'asc' | 'desc') {
  const speciesId = (e: TableEntry) => e.kind === 'record' ? e.row.record.species_id : e.reference.id
  const name = (e: TableEntry) => e.kind === 'record' ? e.row.record.species_name || '동정 미확정' : e.reference.korean_name
  const value = (e: TableEntry): string | number | null => {
    const id = speciesId(e)
    if (key === 'classification') return id === null ? null : ranks.get(id) ?? null
    if (key === 'days') return e.kind === 'reference' ? e.reference.days_left : id === null ? null : references.get(id)?.days_left ?? null
    if (key === 'name') return name(e)
    if (e.kind === 'reference') return null
    return key === 'count' ? e.row.record.count : `${e.row.record.effective_date} ${e.row.record.observation_time || ''}`
  }
  return [...entries].sort((a, b) => {
    const x = value(a), y = value(b)
    if (x === null || y === null) { if (x !== y) return x === null ? 1 : -1 }
    else {
      const result = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko')
      if (result) return result * (direction === 'asc' ? 1 : -1)
    }
    if (a.kind === 'record' && b.kind === 'record') return b.row.record.effective_date.localeCompare(a.row.record.effective_date) || a.row.record.id - b.row.record.id
    return name(a).localeCompare(name(b), 'ko')
  })
}
