// 모든 기록 요청의 통신 오류와 서버 검증 오류를 한곳에서 처리합니다.
import type { Species, Survey, SurveyInput, SurveyUpdate, AddressCandidate, Coordinate, Station, SavedWeather, IntegrationStatus } from './models'

const ROOT = '/api'
export interface AdministrativeRegion { code: string; name: string; province: string; label: string; group: string; level: string }
let regionRequest: Promise<{regions: AdministrativeRegion[]; source: string; source_url: string}> | undefined
export function listRegions() {
  if (!regionRequest) regionRequest = request<{regions: AdministrativeRegion[]; source: string; source_url: string}>('/regions').catch(error => { regionRequest = undefined; throw error })
  return regionRequest
}
export const collectionItems = (page: number, source: 'naturing' | 'inaturalist' = 'naturing', sort: 'default' | 'asc' | 'desc' = 'default') => request<{ total: number; items: import('./models').CollectedItem[] }>(`/collection?offset=${page * 25}&source=${source}&sort=${sort}`)
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
export const editCollectedStage = (item: import('./models').CollectedItem, stage: keyof typeof import('./models').STAGE, species_id?: number) => request<{id:number;stage:keyof typeof import('./models').STAGE;version:string}>(`/collection/${item.id}/stage`, {...post({stage,species_id,expected_version:item.version}),method:'PUT',headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})
export const editCollectedStages = (items: import('./models').CollectedItem[], stage: keyof typeof import('./models').STAGE) =>
  request<{ids: number[]}>('/collection/batch/stage', {
    ...post({stage, items: items.map(item => ({id: item.id, expected_version: item.version}))}),
    method: 'PUT', headers: {'Content-Type': 'application/json', 'X-Butterfly-Client': 'app'},
  })

export const discardCollected = (ids: number[]) => request<{ids: number[]}>('/collection/discard', {...post({ids}), headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})
export const restoreCollected = (ids: number[]) => request<{ids: number[]}>('/collection/restore', {...post({ids}), headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})
export const listTags = () => request<import('./models').Tag[]>('/tags')
export const addTag = (name: string, category: 'environment'|'individual' = 'environment') => request<import('./models').Tag>('/tags', post({ name, category }))
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
export const listSurveys = (signal?: AbortSignal) => request<Survey[]>('/surveys', {signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)})
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
export const recordReview = (signal: AbortSignal) => request<Record<number, string[]>>('/record-review', {signal})
export interface WeatherQueueStatus { running: boolean; total: number; saved: number; skipped: number; missing: number; pending: number }
export const startWeatherQueue = () => request<WeatherQueueStatus>('/weather-queue', { ...post({}), headers: {'Content-Type':'application/json', 'X-Butterfly-Client':'app'} })
export const weatherQueueStatus = () => request<WeatherQueueStatus>('/weather-queue')
export const getReference = (id: number) => request<import('./models').ReferenceDocument>(`/species/${id}/reference`)
export const saveReference = (id: number, value: import('./models').SpeciesReference, version: string | null) => request<import('./models').ReferenceDocument>(`/species/${id}/reference`, { ...post({ ...value, expected_updated_at: version }), method: 'PUT' })
export const findExploration = (on: string, region: string) => request<import('./models').ExplorationRow[]>(`/exploration?${new URLSearchParams({ on, region })}`)

export interface InatQuery { mode: 'history' | 'latest'; taxon_id: number | null; place_id: number; start: string | null; end: string | null }
export interface InatProgress { done: boolean; scanned: number; created: number; updated: number; unchanged: number; excluded: number }
export const searchInat = (query: string, kind: 'taxa' | 'places') => request<{id: number; name: string; scientific_name: string}[]>('/collection/inaturalist/search', {...post({query, kind}), signal:AbortSignal.timeout(45000), headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})
export const syncInat = (query: InatQuery) => request<InatProgress>('/collection/inaturalist/sync', {...post(query), signal:AbortSignal.timeout(90000), headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})

export interface Paper { favorite: boolean; tags: string[]; id: number; title: string; authors: string; journal: string; published: string; language: string; abstract: string; url: string; doi: string; provider: string; providers: string[]; received_at: string; observations: {id:number; survey_id:number; evidence:string}[]; files?: {id:number; original_name:string}[] }
export const uploadPaperPdf = (file: File) => request<{id:number; paper_id:number; duplicate:boolean; warning?:string}>(`/papers/pdf?${new URLSearchParams({filename:file.name})}`, {method:'POST',body:file,headers:{'Content-Type':'application/pdf','X-Butterfly-Client':'app'},signal:AbortSignal.timeout(60000)})
export const paperPdfText = (id: number) => request<{pages:string[]}>(`/papers/pdf/${id}/text`)
export interface PaperQuery { provider: 'all' | 'crossref' | 'kci'; topic: 'latest' | 'new_record' | 'rearing'; query: string; species_id: number | null; start: string | null; end: string | null; page: number }
export const paperStatus = () => request<{kci_ready:boolean}>('/papers/status')
export const listPapers = (offset: number, query: string, topic: string, language: string, speciesId = '', start = '', end = '', provider = 'all', favorite = false, tag = '') => request<{total:number; items:Paper[]}>(`/papers?${new URLSearchParams({offset:String(offset),query,topic,language,provider,favorite:String(favorite),tag,...(speciesId ? {species_id:speciesId} : {}),...(start ? {start} : {}),...(end ? {end} : {})})}`)
export const refreshPapers = (value: PaperQuery) => request<{received:number; created:number; duplicate:number; excluded:number; warnings:string[]}>('/papers/refresh', {...post(value), signal:AbortSignal.timeout(45000), headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})
export const addPaperObservation = (paperId: number, evidence: string, survey: SurveyInput) => request<Survey>(`/papers/${paperId}/observations`, {...post({evidence,survey}),headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})


const researchWrite = (value: unknown, method = 'POST') => ({
  method, body: JSON.stringify(value), headers: {'Content-Type': 'application/json', 'X-Butterfly-Client': 'app'},
})
export interface WebSource { id: number; title: string; url: string; saved_at: string; species_name: string | null; registered_count: number }
export interface GroundedSearch { answer: string; entry: string; links: {url: string; title: string}[] }
export const researchStatus = () => request<{gemini_ready: boolean; daily_limit: number}>('/research/status')
export const organizePaper = (id: number, favorite: boolean, tags: string[]) =>
  request<{favorite: boolean; tags: string[]}>(`/research/papers/${id}/organization`, researchWrite({favorite, tags}, 'PUT'))
export const extractBibliography = (id: number) =>
  request<{updated: string[]}>(`/research/pdf/${id}/extract`, researchWrite({consent: true, save: true}))
export const searchWeb = (query: string) => request<GroundedSearch>('/research/web/search', researchWrite({query, consent: true}))
export const listWebSources = (page: number) => request<{items: WebSource[]; total: number}>(`/research/web/sources?offset=${page * 25}`)
export const saveWebSource = (value: {title: string; url: string; species_id: number | null}) =>
  request<{id: number; duplicate: boolean}>('/research/web/sources', researchWrite(value))
export const addWebObservation = (id: number, evidence: string, survey: SurveyInput) =>
  request<Survey>(`/research/web/sources/${id}/observations`, researchWrite({evidence, survey}))

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


// 모바일 수신 서버와 구분된 PC 전용 관리·검수 요청입니다.
export interface MobilePhoto {
  id:number;device_label:string;received_at:string;
  metadata:{sha256:string;filename:string;size_bytes:number;camera:string;taken_at_raw:string;offset_raw:string;date_candidate:string|null;time_candidate:string|null;latitude:number|null;longitude:number|null;warnings:string[]}
}
export const mobileStatus = () => request<{url:string;enabled:boolean;sessions:{id:number;label:string;expires:number;created_at:string}[]}>('/mobile/status')
const mobilePost = (body:unknown) => ({...post(body),headers:{'Content-Type':'application/json','X-Butterfly-Client':'app'}})
export const mobileConnection = () => request<{code:string;expires_in:number;url:string}>('/mobile/connection',mobilePost({}))
export const mobileDisable = () => request('/mobile/disable',mobilePost({}))
export const mobileRevoke = (id:number) => request('/mobile/revoke',mobilePost({id}))
export const mobilePhotos = (page:number) => request<{items:MobilePhoto[];total:number}>('/mobile/photos?offset='+page*25)
export const mobileDiscard = (ids:number[]) => request('/mobile/discard',mobilePost({ids}))
export const mobileRegister = (ids:number[],survey:SurveyInput) => request<Survey>('/mobile/register',mobilePost({ids,survey}))

export const viewerStatus = () => request<{configured:boolean;url:string;published_at:string|null;sessions:{label:string;expires:number}[]}>('/viewer/status')
export const viewerPublish = () => request<{records:number;catalog:number;holdings:number}>('/viewer/snapshot',mobilePost({}))
export const viewerConnection = () => request<{code:string;url:string}>('/viewer/connection',mobilePost({}))
export const viewerDisable = () => request('/viewer/disable',mobilePost({}))

export const moveTag = (id:number,category:'environment'|'individual') => request<import('./models').Tag>(`/tags/${id}/category`,{...post({category}),method:'PUT'})
export const speciesPhotos = (id:number,page:number) => request<{total:number;items:import('./models').Photo[]}>(`/species/${id}/photos?offset=${page*12}`)
