// API 계약과 화면에서 공유하는 기록 분류입니다.
export const RESULT = { observed: '관찰', not_found: '미발견' } as const
export const STAGE = { unknown: '미상', egg: '알', larva: '유충', pupa: '번데기', adult: '성충' } as const
export const SEX = { unknown: '미상', male: '수컷', female: '암컷', mixed: '혼합' } as const
export const CAPTURE = { unknown: '미상', not_captured: '채집하지 않음', captured: '채집함' } as const
export const IDENTIFICATION = { unidentified: '미확정', candidate: '후보 종', user_confirmed: '사용자 확인' } as const
export const PURPOSE = { general: '일반 관찰', target: '특정 종 탐색', host_plant: '기주식물 확인', exploration: '신규 지역 조사' } as const
export const LOCATION = { unknown: '미상', approximate: '대략적 위치', manual: '좌표 직접 입력', gps: 'GPS' } as const
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
export interface Survey extends Omit<SurveyInput, 'observations'> {
  id: number; created_at: string; updated_at: string; observations: Observation[]
}
