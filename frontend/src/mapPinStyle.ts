// 관찰 출처의 색과 같은 좌표에 겹친 출처의 핀 모양을 정의합니다.
import type { ObservationInput, PinSource } from './models'
import type { SourceCounts } from './mapClusters'

export const PIN_STYLE = {
  direct: { label: '직접 관찰', color: '#e68a32' },
  naturing: { label: '네이처링', color: '#4285d4' },
  inaturalist: { label: 'iNaturalist', color: '#4c9b67' },
  other: { label: '기타 간접 관찰', color: '#858b93' },
  administrative: { label: '행정구역 중심 표시', color: '#cc5959' },
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
    zIndex: unique.includes('direct') ? 1000 : 0,
    signature: unique.join(','),
    title: `기록 위치 선택 · ${label}`,
    content: `<div class="map-single-icon" aria-label="${label}" style="--pin-fill:${background}"></div>`,
  }
}

// 같은 좌표에서는 직접 관찰을 우선하고 같은 출처끼리의 순서는 유지합니다.
export function directPinsFirst<T extends { source?: PinSource }>(pins: T[]): T[] {
  return [...pins].sort((a, b) => Number((b.source || 'direct') === 'direct') - Number((a.source || 'direct') === 'direct'))
}


// 원호의 위 끝은 iNaturalist, 아래 끝은 네이처링에 배정합니다.
function ringFill(sources: SourceCounts) {
  const order = (['naturing', 'other', 'administrative', 'inaturalist'] as const).filter(source => sources[source] > 0)
  if (!order.length) return '#e3e5e7'
  if (order.length === 1) return PIN_STYLE[order[0]].color

  const total = order.reduce((sum, source) => sum + sources[source], 0)
  const sweep = 200
  const minimum = 25
  const naturalWidths = order.map(source => sources[source] / total * sweep)
  const excess = naturalWidths.reduce((sum, width) => sum + Math.max(0, width - minimum), 0)
  let start = 0
  const stops = order.map((source, index) => {
    const from = start
    start += minimum + Math.max(0, naturalWidths[index] - minimum) / excess * (sweep - minimum * order.length)
    return `${PIN_STYLE[source].color} ${from}deg ${start}deg`
  })
  return `conic-gradient(from 152deg at 40.55% 57.13%, ${stops.join(',')}, ${PIN_STYLE[order.at(-1)!].color} ${sweep}deg 360deg)`
}

function countText(count: number, className: string) {
  const text = count.toLocaleString('en-US')
  const direct = className === 'map-cluster-direct'
  // 자릿수마다 폭이 넓은 8을 기준으로 하고 쉼표 폭은 따로 계산합니다.
  const digits = String(count).length
  const widthInEm = digits * 0.65 + (text.length - digits) * 0.35
  const size = Math.min(direct ? 10 : 14, (direct ? 11 : 24) / widthInEm)
  return `<span class="${className}" style="font-size:${size}px">${text}</span>`
}

export function clusterAppearance(count: number, locations: number, sources: SourceCounts, surveyCount: number, directSurveyCount: number, canExpand: boolean) {
  const present = (Object.keys(PIN_STYLE) as PinSource[]).filter(source => sources[source] > 0)
  const action = canExpand ? '클릭하여 확대' : '클릭하여 기록 선택'
  const title = `탐사 ${surveyCount}건 · 관찰 ${count}건 · ${locations}개 위치 · ${present.map(source => `${PIN_STYLE[source].label} ${sources[source]}건`).join(' · ')} · ${action}`
  return {
    signature: `cluster:${title}:${directSurveyCount}`,
    zIndex: directSurveyCount ? 1000 : 10,
    title,
    content: `<div class="map-cluster-icon" aria-label="${title}" style="--wing-fill:${directSurveyCount ? PIN_STYLE.direct.color : '#e3e5e7'};--ring-fill:${ringFill(sources)}"><div class="map-cluster-ring"></div>${countText(surveyCount, 'map-cluster-total')}${directSurveyCount ? countText(directSurveyCount, 'map-cluster-direct') : ''}</div>`,
  }
}
