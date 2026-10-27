// 모든 기록 요청의 통신 오류와 서버 검증 오류를 한곳에서 처리합니다.
import type { Species, Survey, SurveyInput, SurveyUpdate, AddressCandidate, Coordinate, Station, SavedWeather, IntegrationStatus } from './models'

const ROOT = '/api'
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${ROOT}${path}`, { ...init, signal: AbortSignal.timeout(30000) })
  } catch {
    throw new Error('서버에 연결할 수 없습니다. 입력은 유지됩니다. 연결을 확인한 뒤 저장 여부를 조회해 주세요.')
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') {
      const errors = 'errors' in body && Array.isArray(body.errors) ? body.errors : []
      const detail = errors.map((error: unknown) => {
        if (error && typeof error === 'object' && 'field' in error && 'message' in error) {
          const row = /^observations\.(\d+)/.exec(String(error.field))
          const prefix = row ? `종별 기록 ${Number(row[1]) + 1}: ` : ''
          return `${prefix}${String(error.message)}`
        }
        return ''
      }).filter(Boolean).join('\n')
      throw new Error(detail || body.detail)
    }
    throw new Error('요청을 처리하지 못했습니다. 서버 실행 상태를 확인해 주세요.')
  }
  if (body === null) throw new Error('서버 응답을 읽지 못했습니다. 저장 상태를 다시 조회해 주세요.')
  return body as T
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
export const listTags = () => request<import('./models').Tag[]>('/tags')
export const addTag = (name: string) => request<import('./models').Tag>('/tags', post({ name }))
export const listSpecies = () => request<Species[]>('/species')
export const listCatalog = () => request<import('./models').SpeciesCatalog[]>('/species/catalog')
export const addSpecies = (korean_name: string, scientific_name: string) => request<Species>('/species', post({ korean_name, scientific_name: scientific_name || null }))
export const listSurveys = () => request<Survey[]>('/surveys')
export const addSurvey = (value: SurveyInput) => request<Survey>('/surveys', post(value))
export const updateSurvey = (id: number, value: SurveyUpdate) => request<Survey>(`/surveys/${id}`, { ...post(value), method: 'PUT' })
export const integrationStatus = () => request<IntegrationStatus>('/integrations/status')
export const mapPermit = () => request<{ client_id: string }>('/maps/permit', post({}))
export const findAddress = (query: string) => request<AddressCandidate[]>('/maps/geocode', post({ query }))
export const findCoordinateAddress = (point: Coordinate) => request<{ address: string | null }>('/maps/reverse', post(point))
export const getWeather = (type: 'survey' | 'observation', id: number) => request<SavedWeather>(`/weather/${type}/${id}`)
export const findStations = (target_type: 'survey' | 'observation', target_id: number) => request<Station[]>('/weather/stations', post({ target_type, target_id }))
export const queryWeather = (target_type: 'survey' | 'observation', target_id: number, station_id: number, refresh = false) => request<SavedWeather>('/weather/query', post({ target_type, target_id, station_id, refresh }))
export const recordWeather = () => request<Record<number, SavedWeather>>('/record-weather')
export const getReference = (id: number) => request<import('./models').ReferenceDocument>(`/species/${id}/reference`)
export const saveReference = (id: number, value: import('./models').SpeciesReference, version: string | null) => request<import('./models').ReferenceDocument>(`/species/${id}/reference`, { ...post({ ...value, expected_updated_at: version }), method: 'PUT' })
export const findExploration = (on: string, region: string) => request<import('./models').ExplorationRow[]>(`/exploration?${new URLSearchParams({ on, region })}`)
