// 소지 여부와 수량 미상을 보존하면서 종 수와 알려진 개체 수를 따로 계산합니다.
import type { Holding } from './models'
export const HOLDING_SEX = { unknown: '미상', male: '수컷', female: '암컷', mixed: '수컷 / 암컷' } as const
export interface HoldingGroup {
  key: string; rows: Holding[]; first: Holding; sex: Holding['sex']; quantity: number | null
  quantityText: string; quantityHint: string; photoIds: number[]
}
function sexTotal(rows: Holding[], sex: 'male' | 'female') {
  const relevant = rows.filter(row => row.sex === sex || row.sex === 'mixed')
  const quantities = relevant.map(row => row.sex === 'mixed' ? row[sex === 'male' ? 'male_quantity' : 'female_quantity'] : row.quantity)
  const known = quantities.reduce<number>((sum, count) => sum + (count ?? 0), 0)
  return quantities.some(count => count == null) ? known ? `${known}개체 + 미상` : '미상' : `${known}개체`
}
export function groupHoldings(rows: Holding[]): HoldingGroup[] {
  const groups = new Map<string, Holding[]>()
  for (const row of rows) {
    const key = `${row.species_id}:${row.acquisition}`
    const current = groups.get(key) || []
    current.push(row); groups.set(key, current)
  }
  return [...groups].map(([key, entries]) => {
    const owned = entries.filter(row => row.possession === 'owned')
    const known = owned.filter(row => row.quantity !== null).reduce((sum, row) => sum + (row.quantity ?? 0), 0)
    const incomplete = owned.some(row => row.quantity === null)
    const hasMale = entries.some(row => row.sex === 'male' || row.sex === 'mixed')
    const hasFemale = entries.some(row => row.sex === 'female' || row.sex === 'mixed')
    const sex = hasMale && hasFemale ? 'mixed' : hasMale ? 'male' : hasFemale ? 'female' : 'unknown'
    const quantityText = !owned.length ? '해당 없음' : incomplete ? known ? `${known} + 미상` : '수량 미상' : `${known}`
    const unknownSex = owned.filter(row => row.sex === 'unknown')
    const quantityHint = `수컷 ${sexTotal(owned, 'male')} / 암컷 ${sexTotal(owned, 'female')}${unknownSex.length ? ` / 성별 미상 ${unknownSex.some(row => row.quantity === null) ? '수량 미상' : `${unknownSex.reduce((sum, row) => sum + (row.quantity ?? 0), 0)}개체`}` : ''}`
    return { key, rows: entries, first: entries[0], sex, quantity: !owned.length || incomplete ? null : known, quantityText, quantityHint, photoIds: [...new Set(entries.flatMap(row => row.photo_ids))] }
  })
}

export function holdingGroupMatches(group: HoldingGroup, query: string, acquisition: string, possession: string, sex: string) {
  return (!sex || (sex === 'mixed' ? group.sex === 'mixed' : group.rows.some(row => row.sex === sex || (row.sex === 'mixed' && sex !== 'unknown'))))
    && group.rows.some(row => holdingMatches(row, query, acquisition, possession, ''))
}
export function holdingSummary(rows: Holding[]) {
  const owned = rows.filter(row => row.possession === 'owned')
  const known = owned.filter(row => row.quantity !== null)
  return { species: new Set(owned.map(row => row.species_id)).size,
    knownQuantity: known.length ? known.reduce((sum, row) => sum + (row.quantity ?? 0), 0) : null,
    unknownRecords: owned.filter(row => row.quantity === null).length }
}
export function holdingMatches(row: Holding, query: string, acquisition: string, possession: string, sex: string) {
  return (!acquisition || row.acquisition === acquisition) && (!possession || row.possession === possession) && (!sex || row.sex === sex || (row.sex === 'mixed' && (sex === 'male' || sex === 'female')))
    && [row.korean_name, row.scientific_name, row.source_note, row.notes, row.acquired_date].join(' ').toLowerCase().includes(query.trim().toLowerCase())
}
