// 관찰 원본을 바꾸지 않고 간접 관찰만 통합하며 화면 주변의 표시 항목을 구합니다.
import Supercluster from 'supercluster'
import type { PointFeature } from 'supercluster'
import type { MapPin, PinSource } from './models'
import type { Bounds } from './regionLayer'

export type SourceCounts = Record<PinSource, number>
type Summary = { count: number; locations: number; sources: SourceCounts }
type Location = Summary & { locationKey: string }
export type DisplayPin = Summary & {
  key: string; latitude: number; longitude: number
  locationKey?: string; expansionZoom?: number
}
const emptyCounts = (): SourceCounts => ({direct: 0, naturing: 0, inaturalist: 0, other: 0})
export const locationKey = (pin: Pick<MapPin, 'latitude' | 'longitude'>) => `${pin.latitude},${pin.longitude}`

// 네이버 축척 이름을 가정하지 않고 실제 화면의 경도 폭을 256px 세계 타일에 맞춥니다.
export function clusterZoom(bounds: Bounds, width: number) {
  const span = bounds[2] >= bounds[0] ? bounds[2] - bounds[0] : bounds[2] + 360 - bounds[0]
  return Math.max(0, Math.min(22, Math.floor(Math.log2(Math.max(1, width) * 360 / (256 * Math.max(span, 1e-9))) + 1e-6)))
}

export function markerBounds(bounds: Bounds): Bounds {
  const span = bounds[2] >= bounds[0] ? bounds[2] - bounds[0] : bounds[2] + 360 - bounds[0]
  const y = (bounds[3] - bounds[1]) * 0.2
  if (span * 1.4 >= 360) return [-180, Math.max(-90, bounds[1] - y), 180, Math.min(90, bounds[3] + y)]
  const wrap = (lng: number) => ((lng + 180) % 360 + 360) % 360 - 180
  return [wrap(bounds[0] - span * 0.2), Math.max(-90, bounds[1] - y), wrap(bounds[2] + span * 0.2), Math.min(90, bounds[3] + y)]
}

export function buildPinIndex(pins: MapPin[]) {
  const direct = new Map<string, PointFeature<Location>>()
  const indirect = new Map<string, PointFeature<Location>>()
  for (const pin of pins) {
    if (!Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude) || Math.abs(pin.latitude) > 90 || Math.abs(pin.longitude) > 180) continue
    const key = locationKey(pin), source = pin.source || 'direct'
    const groups = source === 'direct' ? direct : indirect
    let feature = groups.get(key)
    if (!feature) {
      feature = {type: 'Feature', geometry: {type: 'Point', coordinates: [pin.longitude, pin.latitude]}, properties: {locationKey: key, count: 0, locations: 1, sources: emptyCounts()}}
      groups.set(key, feature)
    }
    feature.properties.count++
    feature.properties.sources[source]++
  }
  const index = new Supercluster<Location, Summary>({
    radius: 60, extent: 256, maxZoom: 18,
    map: p => ({count: p.count, locations: p.locations, sources: {...p.sources}}),
    reduce: (a, b) => {
      a.count += b.count; a.locations += b.locations
      // 상위 통합은 속성을 얕게 복사하므로 하위 축척의 출처 집계를 공유 변경하지 않습니다.
      a.sources = {...a.sources}
      for (const source of Object.keys(a.sources) as PinSource[]) a.sources[source] += b.sources[source]
    },
  }).load([...indirect.values()])
  return {
    query(bounds: Bounds, zoom: number, generation: number): DisplayPin[] {
      const result: DisplayPin[] = []
      for (const feature of direct.values()) {
        const [lng, lat] = feature.geometry.coordinates
        const insideLongitude = bounds[0] <= bounds[2] ? lng >= bounds[0] && lng <= bounds[2] : lng >= bounds[0] || lng <= bounds[2]
        if (insideLongitude && lat >= bounds[1] && lat <= bounds[3]) result.push({key: `d:${feature.properties.locationKey}`, longitude: lng, latitude: lat, ...feature.properties})
      }
      for (const feature of index.getClusters(bounds, zoom)) {
        const p = feature.properties
        const [longitude, latitude] = feature.geometry.coordinates
        if ('cluster' in p) result.push({key: `c:${generation}:${p.cluster_id}`, longitude, latitude, count: p.count, locations: p.locations, sources: p.sources, expansionZoom: index.getClusterExpansionZoom(p.cluster_id)})
        else result.push({key: `p:${p.locationKey}`, longitude, latitude, ...p})
      }
      return result
    },
  }
}
