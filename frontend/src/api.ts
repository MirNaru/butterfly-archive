// 모든 기록 요청의 통신 오류와 서버 검증 오류를 한곳에서 처리합니다.
import type { Species, Survey, SurveyInput, SurveyUpdate, AddressCandidate, Coordinate, Station, SavedWeather, IntegrationStatus } from './models'

const ROOT = '/api'
export interface AdministrativeRegion { code: string; name: string; province: string; label: string; group: string; level: string }
let regionRequest: Promise<{regions: AdministrativeRegion[]; source: string; source_url: string}> | undefined
export function listRegions() {
  if (!regionRequest) regionRequest = request<{regions: AdministrativeRegion[]; source: string; source_url: string}>('/regions').catch(error => { regionRequest = undefined; throw error })
  return regionRequest
}
export const collectionItems = (page: number, source: 'naturing' | 'inaturalist' = 'naturing') => request<{ total: number; items: import('./models').CollectedItem[] }>(`/collection?offset=${page * 25}&source=${source}`)
export const createCollectionConnection = () => request<{ token: string }>('/collection/connection', { method: 'POST', headers: { 'X-Butterfly-Client': 'app' } })
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${ROOT}${path}`, { ...init, signal: init?.signal || AbortSignal.timeout(30000) })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
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
export const registerCollected = (ids: number[]) => request<{surveys?: Survey[]; results: {id: number; status: 'registered' | 'already_registered' | 'skipped'; reason?: string}[]}>('/collection/register', { ...post({ids}), headers: {'Content-Type':'application/json', 'X-Butterfly-Client':'app'} })
export const editCollectedStage = (item: import('./models').CollectedItem, stage: keyof typeof import('./models').STAGE) => request<{id:number;stage:keyof typeof import('./models').STAGE;version:string}>(`/collection/${item.id}/stage`, {...post({stage,expected_version:item.version}),method:'PUT',headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})
export const discardCollected = (ids: number[]) => request<{ids: number[]}>('/collection/discard', {...post({ids}), headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})
export const restoreCollected = (ids: number[]) => request<{ids: number[]}>('/collection/restore', {...post({ids}), headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})
export const listTags = () => request<import('./models').Tag[]>('/tags')
export const addTag = (name: string) => request<import('./models').Tag>('/tags', post({ name }))
export const inspectPhoto = (file: File, signal: AbortSignal) => request<import('./models').PhotoPreview>(`/photos/inspect?${new URLSearchParams({ filename: file.name })}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' }, signal })
export const registerPhotoMetadata = (ticket: string, signal: AbortSignal) => request<import('./models').Photo>('/photos/metadata', { ...post({ ticket }), signal })
export const registerPhotoOriginal = (file: File, signal: AbortSignal) => request<import('./models').Photo>(`/photos/original?${new URLSearchParams({ filename: file.name })}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' }, signal })
export const lookupPhotos = (ids: number[]) => request<import('./models').Photo[]>('/photos/lookup', post({ ids }))
export const photoLibrary = (page: number) => request<{ total: number; items: import('./models').Photo[] }>(`/photos/library?offset=${page * 12}&limit=12`)
export const listHoldings = () => request<import('./models').Holding[]>('/holdings')
export const addHolding = (value: import('./models').HoldingInput) => request<import('./models').Holding>('/holdings', post(value))
export const updateHolding = (id: number, value: import('./models').HoldingInput, expected_updated_at: string) => request<import('./models').Holding>(`/holdings/${id}`, { ...post({ ...value, expected_updated_at }), method: 'PUT' })
export const listSpecies = () => request<Species[]>('/species')
export const listCatalog = () => request<import('./models').SpeciesCatalog[]>('/species/catalog')
export const addSpecies = (korean_name: string, scientific_name: string) => request<Species>('/species', post({ korean_name, scientific_name: scientific_name || null }))
export const listSurveys = () => request<Survey[]>('/surveys')
export const listTrash = () => request<import('./models').TrashEntry[]>('/trash')
export const trashSurvey = (survey: Survey, observationId: number | null) => request<{ id: number }>(`/surveys/${survey.id}${observationId === null ? '' : `/observations/${observationId}`}`, { ...post({ expected_updated_at: survey.updated_at }), method: 'DELETE' })
export const restoreTrash = (entry: import('./models').TrashEntry) => request<{ survey_id: number }>(`/trash/${entry.id}/restore`, post({ expected_deleted_at: entry.deleted_at }))
export const purgeTrash = (entry: import('./models').TrashEntry) => request<{ survey_id: number }>(`/trash/${entry.id}`, { ...post({ expected_deleted_at: entry.deleted_at }), method: 'DELETE' })
export const purgeAllTrash = (entries: import('./models').TrashEntry[]) => request<{deleted_entries:number; deleted_observations:number}>('/trash', { ...post({entries:entries.map(entry => ({id:entry.id,expected_deleted_at:entry.deleted_at}))}), method:'DELETE' })
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

export interface InatQuery { mode: 'history' | 'latest'; taxon_id: number | null; place_id: number; start: string | null; end: string | null }
export interface InatProgress { done: boolean; scanned: number; created: number; updated: number; unchanged: number; excluded: number }
export const searchInat = (query: string, kind: 'taxa' | 'places') => request<{id: number; name: string; scientific_name: string}[]>('/collection/inaturalist/search', {...post({query, kind}), signal:AbortSignal.timeout(45000), headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})
export const syncInat = (query: InatQuery) => request<InatProgress>('/collection/inaturalist/sync', {...post(query), signal:AbortSignal.timeout(90000), headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})

export interface Paper { id: number; title: string; authors: string; journal: string; published: string; language: string; abstract: string; url: string; doi: string; provider: string; providers: string[]; received_at: string; observations: {id:number; survey_id:number; evidence:string}[]; files?: {id:number; original_name:string}[] }
export const uploadPaperPdf = (file: File) => request<{id:number; paper_id:number; duplicate:boolean; warning?:string}>(`/papers/pdf?${new URLSearchParams({filename:file.name})}`, {method:'POST',body:file,headers:{'Content-Type':'application/pdf','X-Butterfly-Client':'app'},signal:AbortSignal.timeout(60000)})
export const paperPdfText = (id: number) => request<{pages:string[]}>(`/papers/pdf/${id}/text`)
export interface PaperQuery { provider: 'all' | 'crossref' | 'kci'; topic: 'latest' | 'new_record' | 'rearing'; query: string; species_id: number | null; start: string | null; end: string | null; page: number }
export const paperStatus = () => request<{kci_ready:boolean}>('/papers/status')
export const listPapers = (offset: number, query: string, topic: string, language: string, speciesId = '', start = '', end = '', provider = 'all') => request<{total:number; items:Paper[]}>(`/papers?${new URLSearchParams({offset:String(offset),query,topic,language,provider,...(speciesId ? {species_id:speciesId} : {}),...(start ? {start} : {}),...(end ? {end} : {})})}`)
export const refreshPapers = (value: PaperQuery) => request<{received:number; created:number; duplicate:number; excluded:number; warnings:string[]}>('/papers/refresh', {...post(value), signal:AbortSignal.timeout(45000), headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})
export const addPaperObservation = (paperId: number, evidence: string, survey: SurveyInput) => request<Survey>(`/papers/${paperId}/observations`, {...post({evidence,survey}),headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})


// 동일한 자료 버전의 진행 중 요청과 결과를 공유하고, 실패하면 다시 요청합니다.
export function latestRequest<A extends unknown[], T>(fetcher: (...args: A) => Promise<T>) {
  let entry: {key: string; promise: Promise<T>} | undefined
  return (version: string, ...args: A) => {
    const key = JSON.stringify([version, ...args])
    if (entry?.key === key) return entry.promise
    const promise = fetcher(...args)
    entry = {key, promise}
    void promise.catch(() => { if (entry?.promise === promise) entry = undefined })
    return promise
  }
}
export const catalogExploration = latestRequest(findExploration)
