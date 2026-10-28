// 도감의 상태 요약과 색상 이름을 한곳에서 관리합니다. 지역보호는 국가보호와 구분합니다.
import type { SpeciesReference, Protection } from './models'
export const PROTECTION_LABELS: Record<Protection['kind'], string> = {
  endangered_i: '멸종위기 I급', endangered_ii: '멸종위기 II급', monument: '천연기념물', regional: '지역보호',
}
export function speciesStatuses(reference: SpeciesReference) {
  const badges = reference.protections.map(p => ({
    label: p.kind === 'regional' ? `지역보호[${p.region}]` : p.kind === 'monument' && p.designation ? `천연기념물[${p.designation}]` : PROTECTION_LABELS[p.kind],
    tone: p.kind === 'endangered_i' || p.kind === 'endangered_ii' ? 'endangered' : p.kind,
    detail: `${p.source}\n확인일: ${p.checked}`,
  }))
  if (reference.protected === true && !reference.protections.some(p => p.kind !== 'regional')) badges.push({ label: '국가보호종', tone: 'endangered', detail: `${reference.protection_source}\n확인일: ${reference.protection_checked || '미확인'}` })
  if (reference.protection_review) badges.push({ label: '보호정보 확인 필요', tone: 'review', detail: reference.protection_review })
  if (reference.vagrant === true) badges.push({ label: reference.sighting_years.length ? `미접[${[...new Set(reference.sighting_years)].sort((a, b) => a - b).join(', ')}]` : '미접[연도 미상]', tone: 'vagrant', detail: `확인된 목격 사례 연도이며 마지막 목격 연도로 단정하지 않습니다.\n${reference.source}` })
  if (reference.north_only === true) badges.push({ label: '북한 서식', tone: 'north', detail: reference.source })
  if (reference.domestic_extinct === true) badges.push({ label: '절멸', tone: 'extinct', detail: `국내 기준의 분류입니다.\n${reference.extinction_source}` })
  return badges
}
