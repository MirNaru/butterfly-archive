// API 계약과 화면에서 공유하는 기록 분류입니다.
export const RESULT = { observed: '관찰', not_found: '미발견' } as const
export const STAGE = { unknown: '미상', egg: '알', larva: '유충', pupa: '번데기', adult: '성충' } as const
export const SEX = { unknown: '미상', male: '수컷', female: '암컷', mixed: '혼합' } as const
export const CAPTURE = { unknown: '미상', not_captured: '채집하지 않음', captured: '채집함' } as const
export const IDENTIFICATION = { unidentified: '미확정', candidate: '후보 종', user_confirmed: '사용자 확인' } as const
export const PURPOSE = { general: '일반 관찰', target: '특정 종 탐색', host_plant: '기주식물 확인', exploration: '신규 지역 조사' } as const
export const LOCATION = { unknown: '미상', approximate: '대략적 위치', manual: '좌표 직접 입력', gps: 'GPS', map: '지도 선택', address: '주소 검색' } as const
export interface Species { id: number; korean_name: string; scientific_name: string | null }
export interface LocationInput {
  place_name: string; latitude: number | null; longitude: number | null; location_method: keyof typeof LOCATION
}
export interface ObservationInput extends LocationInput {
  species_id: number | null; result: keyof typeof RESULT
  observation_date: string | null; observation_time: string | null
  stage: keyof typeof STAGE; sex: keyof typeof SEX; count: number | null; count_estimated: boolean
  identification: keyof typeof IDENTIFICATION; capture_status: keyof typeof CAPTURE
  captured_count: number | null; notes: string
}
export interface SurveyInput extends LocationInput {
  survey_date: string; purpose: keyof typeof PURPOSE; notes: string; observations: ObservationInput[]
}
export interface Observation extends ObservationInput {
  id: number; species_name: string | null; effective_date: string; effective_place: string
  effective_latitude: number | null; effective_longitude: number | null
}
export interface SurveyUpdate extends Omit<SurveyInput, 'observations'> {
  expected_updated_at: string
  observations: (ObservationInput & { id: number | null })[]
}
export interface Survey extends Omit<SurveyInput, 'observations'> {
  id: number; created_at: string; updated_at: string; observations: Observation[]
}

export interface Coordinate { latitude: number; longitude: number }
export interface AddressCandidate extends Coordinate { address: string }
export interface MapPin extends Coordinate { id: string; surveyId: number; label: string }
export interface Station extends Coordinate { id: number; name: string; distance_km: number | null; as_of: string }
export interface WeatherContext {
  date: string; time: string | null; latitude: number | null; longitude: number | null
  place: string; kind: 'hourly' | 'daily'; target_time: string
}
export interface SavedWeather {
  context: WeatherContext
  weather: null | {
    values: { code: string; label: string; unit: string; value: number | null; raw: string }[]
    source: string; source_url: string; kind: 'hourly' | 'daily'; target_time: string; fetched_at: string
    station: Station; distance_km: number | null; linked_context: WeatherContext; stale: boolean
  }
}
export interface IntegrationStatus {
  maps_ready: boolean; weather_ready: boolean
  usage: { service: string; today: number; month: number; daily_limit: number | null; monthly_limit: number | null; reported_count: number | null; reported_date: string | null }[]
}

export interface SpeciesReference {
  periods: { start: number; end: number }[]; regions: string[]; north_only: boolean | null; vagrant: boolean | null
  sighting_years: number[]; protected: boolean | null; capture_history: 'unknown' | 'captured' | 'not_captured'
  source: string; capture_source: string; protection_source: string; protection_checked: string | null
  permission: 'unknown' | 'permitted' | 'prohibited'; permission_region: string; permission_start: string | null; permission_end: string | null; permission_source: string
}
export interface ReferenceDocument { reference: SpeciesReference; updated_at: string | null }
export interface ExplorationRow extends Species {
  reference: SpeciesReference; active: boolean | null; days_left: number | null; next_period: boolean; year_round: boolean
  old_vagrant: boolean; capture_history: SpeciesReference['capture_history']; permission: SpeciesReference['permission']; region_match: boolean
}
