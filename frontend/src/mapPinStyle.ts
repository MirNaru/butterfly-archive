// 관찰 출처의 색과 같은 좌표에 겹친 출처의 핀 모양을 정의합니다.
import type { ObservationInput, PinSource } from './models'

export const PIN_STYLE = {
  direct: { label: '직접 관찰', color: '#e68a32' },
  naturing: { label: '네이처링', color: '#4285d4' },
  inaturalist: { label: 'iNaturalist', color: '#4c9b67' },
  other: { label: '기타 간접 관찰', color: '#858b93' },
} satisfies Record<PinSource, { label: string; color: string }>

export function pinSource(record: Pick<ObservationInput, 'source_type' | 'source_note'>): PinSource {
  if (record.source_type === 'direct') return 'direct'
  // 메모에 도메인 이름만 쓰인 경우는 출처 주소로 확정하지 않습니다.
  for (const candidate of record.source_note.match(/https?:\/\/[^\s<>"']+/g) || []) {
    try {
      const host = new URL(candidate).hostname.toLowerCase()
      if (host === 'naturing.net' || host === 'www.naturing.net') return 'naturing'
      if (host === 'inaturalist.org' || host.endsWith('.inaturalist.org')) return 'inaturalist'
    } catch { /* 주소가 아닌 메모는 기타 출처로 남깁니다. */ }
  }
  return 'other'
}

export function pinAppearance(sources: PinSource[]) {
  const unique = (Object.keys(PIN_STYLE) as PinSource[]).filter(source => sources.includes(source))
  if (!unique.length) unique.push('direct')
  const background = unique.length === 1 ? PIN_STYLE[unique[0]].color : `conic-gradient(${unique.map((source, index) => `${PIN_STYLE[source].color} ${index / unique.length * 100}% ${(index + 1) / unique.length * 100}%`).join(',')})`
  const label = unique.map(source => PIN_STYLE[source].label).join(' · ')
  return {
    signature: unique.join(','),
    title: `기록 위치 선택 · ${label}`,
    content: `<div aria-label="${label}" style="position:relative;width:30px;height:38px"><div style="position:absolute;left:3px;top:2px;width:24px;height:24px;box-sizing:border-box;border:2px solid white;border-radius:50% 50% 50% 0;background:${background};transform:rotate(-45deg);box-shadow:0 1px 4px #0005"><span style="position:absolute;left:7px;top:7px;width:6px;height:6px;border-radius:50%;background:white"></span></div></div>`,
  }
}
