// 한살이 그림의 날짜 축, 관찰 집계, 구간별 사분위수와 수염을 계산합니다.
import type { LifePeriod, LifeStage, SpeciesReference, Survey } from './models'
export const LIFE_STAGES: { key: LifeStage; label: string; color: string }[] = [
  { key: 'egg', label: '알', color: '#6b8ca8' }, { key: 'larva', label: '애벌레', color: '#718b67' },
  { key: 'pupa', label: '번데기', color: '#b08c5e' }, { key: 'adult', label: '어른벌레', color: '#917ba3' },
]
export interface LifeFilter { year: string; region: string; source: '' | 'direct' | 'indirect' }
export interface LifeSample { speciesId: number; stage: LifeStage; date: string; day: number; place: string; source: string; sourceType: 'direct' | 'indirect'; observationIds: number[]; stageEstimated?: boolean }
export interface BoxStats { n: number; q1: number; median: number; q3: number; low: number; high: number; outliers: number[] }
export const BOX_MINIMUM = 20
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
export function periodBounds(p: LifePeriod) {
  const start = p.start_day ?? slotStart(p.start), end = p.end_day ?? slotEnd(p.end)
  return { start, end: end + (start > end ? 366 : 0) }
}
export function periodLabel(p: LifePeriod) { const range = periodBounds(p); return `${dayLabel(range.start)} ~ ${dayLabel(range.end)}${range.end > 366 ? ' · 연말·연초 연결' : ''}` }
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
    const accepted = record.identification === 'user_confirmed' || record.identification === 'candidate' && record.source_type === 'indirect' && (record.collection_accepted || record.stage_inferred)
    if (!record.species_id || record.result !== 'observed' || record.stage === 'unknown' || !accepted) continue
    const origin = record.source_type === 'indirect' ? record.source_note.trim() : `survey-${survey.id}`
    const key = JSON.stringify([record.species_id, record.stage, record.effective_date, record.effective_place, record.effective_latitude, record.effective_longitude, record.source_type, origin])
    const previous = groups.get(key)
    if (previous) previous.observationIds.push(record.id)
    else groups.set(key, { speciesId: record.species_id, stage: record.stage, date: record.effective_date, day: dayOfYear(record.effective_date), place: record.effective_place, source: record.source_note || '직접 관찰', sourceType: record.source_type, observationIds: [record.id], stageEstimated: record.stage_inferred || false })
  }
  return [...groups.values()]
}
export function lifeWindows(reference: SpeciesReference, stage: LifeStage, region: string): LifePeriod[] {
  const active = reference.lifecycle.filter(p => p.enabled && p.stage === stage)
  const periods: LifePeriod[] = stage === 'adult' && !active.length ? reference.periods.map((p, index) => ({ ...p, id: `legacy-${index}`, stage, source: reference.source || '기존 어른벌레 참고자료', edition: '', region: '', notes: '기존 어른벌레 참고 구간', enabled: true })) : active
  return periods.filter(p => !region.trim() || !p.region || p.region.toLowerCase().includes(region.trim().toLowerCase()))
}
// 가장 긴 관찰 공백에서 연간 축을 나눠 겨울 관찰을 잇고, 모든 사례로 계산합니다.
export function observationGroups(samples: LifeSample[]) {
  if (!samples.length) return []
  const days = [...new Set(samples.map(p => p.day))].sort((a, b) => a - b)
  let start = days[0], largestGap = days[0] + 366 - days[days.length - 1]
  for (let i = 1; i < days.length; i++) {
    const gap = days[i] - days[i - 1]
    if (gap > largestGap) { largestGap = gap; start = days[i] }
  }
  const values = samples.map(p => p.day < start ? p.day + 366 : p.day)
  return [{ start, end: Math.max(...values), samples, box: boxStats(values) }]
}
export function stageData(reference: SpeciesReference, allSamples: LifeSample[], stage: LifeStage, filter: LifeFilter) {
  const windows = lifeWindows(reference, stage, filter.region)
  const samples = allSamples.filter(p => p.stage === stage && (!filter.year || p.date.startsWith(filter.year + '-')) && (!filter.region.trim() || p.place.toLowerCase().includes(filter.region.trim().toLowerCase())) && (!filter.source || p.sourceType === filter.source))
  return { windows, samples, groups: observationGroups(samples) }
}
// 같은 연말 구간을 축 양끝으로 나누며 관찰 날짜 자체는 일 단위로 보존합니다.
export function rangeParts(start: number, end: number): [number, number][] {
  const lo = start - 1, hi = end - 1
  if (lo === hi) return [[((lo % 366) + 366) % 366, ((hi % 366) + 366) % 366]]
  const parts: [number, number][] = []
  for (let base = Math.floor(lo / 366) * 366; base < hi; base += 366) parts.push([Math.max(lo, base) - base, Math.min(hi, base + 366) - base])
  return parts
}
