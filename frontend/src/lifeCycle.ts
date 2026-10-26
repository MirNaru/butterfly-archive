// 한살이 그림의 날짜 축, 관찰 집계, 구간별 사분위수와 수염을 계산합니다.
import type { LifePeriod, LifeStage, SpeciesReference, Survey } from './models'
export const LIFE_STAGES: { key: LifeStage; label: string; color: string }[] = [
  { key: 'egg', label: '알', color: '#6b8ca8' }, { key: 'larva', label: '유충', color: '#718b67' },
  { key: 'pupa', label: '번데기', color: '#b08c5e' }, { key: 'adult', label: '성충', color: '#917ba3' },
]
export interface LifeFilter { year: string; region: string; source: '' | 'direct' | 'indirect' }
export interface LifeSample { speciesId: number; stage: LifeStage; date: string; day: number; place: string; source: string; sourceType: 'direct' | 'indirect'; observationIds: number[] }
export interface BoxStats { n: number; q1: number; median: number; q3: number; low: number; high: number; outliers: number[] }
export const BOX_MINIMUM = 5
const DAY = 86400000
export const dayOfYear = (date: string) => {
  const [, month, day] = date.split('-').map(Number)
  return (Date.UTC(2000, month - 1, day) - Date.UTC(2000, 0, 1)) / DAY + 1
}
export const slotStart = (slot: number) => dayOfYear(`2000-${String(Math.floor((slot - 1) / 3) + 1).padStart(2, '0')}-${String(((slot - 1) % 3) * 10 + 1).padStart(2, '0')}`)
export const slotEnd = (slot: number) => {
  const month = Math.floor((slot - 1) / 3) + 1
  const end = slot % 3 === 0 ? new Date(Date.UTC(2000, month, 0)).getUTCDate() : slot % 3 * 10
  return dayOfYear(`2000-${String(month).padStart(2, '0')}-${String(end).padStart(2, '0')}`)
}
export function dayLabel(day: number) {
  const d = new Date(Date.UTC(2000, 0, 1) + ((Math.round(day) - 1) % 366 + 366) % 366 * DAY)
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
}
export function boxStats(values: number[]): BoxStats | null {
  if (values.length < BOX_MINIMUM) return null
  const sorted = [...values].sort((a, b) => a - b)
  const q = (p: number) => { const x = (sorted.length - 1) * p, low = Math.floor(x); return sorted[low] + (sorted[Math.ceil(x)] - sorted[low]) * (x - low) }
  const q1 = q(.25), median = q(.5), q3 = q(.75), iqr = q3 - q1
  const inside = sorted.filter(x => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr)
  return { n: sorted.length, q1, median, q3, low: inside[0], high: inside[inside.length - 1], outliers: sorted.filter(x => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr) }
}
export function collectLifeSamples(surveys: Survey[]): LifeSample[] {
  const groups = new Map<string, LifeSample>()
  for (const survey of surveys) for (const record of survey.observations) {
    if (!record.species_id || record.result !== 'observed' || record.stage === 'unknown' || record.identification !== 'user_confirmed') continue
    const origin = record.source_type === 'indirect' ? record.source_note.trim() : `survey-${survey.id}`
    const key = JSON.stringify([record.species_id, record.stage, record.effective_date, record.effective_place, record.effective_latitude, record.effective_longitude, record.source_type, origin])
    const previous = groups.get(key)
    if (previous) previous.observationIds.push(record.id)
    else groups.set(key, { speciesId: record.species_id, stage: record.stage, date: record.effective_date, day: dayOfYear(record.effective_date), place: record.effective_place, source: record.source_note || '직접 관찰', sourceType: record.source_type, observationIds: [record.id] })
  }
  return [...groups.values()]
}
export function lifeWindows(reference: SpeciesReference, stage: LifeStage, region: string): LifePeriod[] {
  const active = reference.lifecycle.filter(p => p.enabled && p.stage === stage)
  const periods: LifePeriod[] = stage === 'adult' && !active.length ? reference.periods.map((p, index) => ({ ...p, id: `legacy-${index}`, stage, source: reference.source || '기존 성충 참고자료', edition: '', region: '', notes: '기존 성충 참고 구간', enabled: true })) : active
  return periods.filter(p => !region.trim() || !p.region || p.region.toLowerCase().includes(region.trim().toLowerCase()))
}
export function coverageGroups(windows: LifePeriod[]) {
  const slots = new Set<number>()
  for (const p of windows) for (let i = p.start; ; i = i % 36 + 1) { slots.add(i); if (i === p.end) break }
  const runs: { start: number; end: number }[] = []
  for (let s = 1; s <= 36; s++) if (slots.has(s)) {
    const last = runs[runs.length - 1]
    if (last?.end === s - 1) last.end = s
    else runs.push({ start: s, end: s })
  }
  if (runs.length > 1 && runs[0].start === 1 && runs[runs.length - 1].end === 36) {
    const first = runs.shift()!, last = runs.pop()!
    runs.push({ start: last.start, end: first.end + 36 })
  }
  return runs.map(r => ({ start: slotStart(r.start), end: slotEnd((r.end - 1) % 36 + 1) + (r.end > 36 ? 366 : 0) }))
}
export function stageData(reference: SpeciesReference, allSamples: LifeSample[], stage: LifeStage, filter: LifeFilter) {
  const windows = lifeWindows(reference, stage, filter.region)
  const samples = allSamples.filter(p => p.stage === stage && (!filter.year || p.date.startsWith(filter.year + '-')) && (!filter.region.trim() || p.place.toLowerCase().includes(filter.region.trim().toLowerCase())) && (!filter.source || p.sourceType === filter.source))
  const groups = coverageGroups(windows).map(range => {
    const selected = samples.map(sample => ({ sample, value: range.end > 366 && sample.day < range.start ? sample.day + 366 : sample.day })).filter(p => p.value >= range.start && p.value <= range.end)
    return { ...range, samples: selected.map(p => p.sample), box: boxStats(selected.map(p => p.value)) }
  })
  const assigned = new Set(groups.flatMap(g => g.samples))
  return { windows, samples, groups, outside: samples.filter(p => !assigned.has(p)) }
}
// 같은 연말 구간을 축 양끝으로 나누며 관찰 날짜 자체는 일 단위로 보존합니다.
export function rangeParts(start: number, end: number): [number, number][] {
  const lo = start - 1, hi = end - 1
  if (lo === hi) return [[((lo % 366) + 366) % 366, ((hi % 366) + 366) % 366]]
  const parts: [number, number][] = []
  for (let base = Math.floor(lo / 366) * 366; base < hi; base += 366) parts.push([Math.max(lo, base) - base, Math.min(hi, base + 366) - base])
  return parts
}
