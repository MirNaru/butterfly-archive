import CloseConfirmation from './CloseConfirmation'
import ScrollToTop from './ScrollToTop'
import DetailPhotos from './DetailPhotos'
import {readView,writeView} from './viewMemory'
// 탐사 등록과 지도·표 보기의 선택 상태를 관리합니다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listSpecies, listSurveys, integrationStatus, recordWeather, catalogExploration, listTags } from './api'
import { CAPTURE, PURPOSE, RESULT, SEX, STAGE, SOURCE_TYPE } from './models'
import type { Species, Survey, MapPin, Coordinate, IntegrationStatus, SavedWeather, ExplorationRow, Tag } from './models'
import SurveyForm, { type SurveyFormHandle } from './SurveyForm'
import MapView from './MapView'
import MobileInbox from './MobileInbox'
import { pinSource } from './mapPinStyle'
import WeatherPanel from './WeatherPanel'
import HoldingsView from './HoldingsView'
import TrashDialog from './TrashDialog'
import SearchFilters from './SearchFilters'
import RecordTable from './RecordTable'
import ButterflyInfo from './ButterflyInfo'
import CollectionInbox from './CollectionInbox'
import PaperBrowser from './PaperBrowser'
import WebResearch from './WebResearch'
import type { Paper } from './api'
import { emptyFilters, emptyTargets, rowsFor, matches, emptySurveyMatches, referenceCandidates } from './recordSearch'
import './App.css'
import { groupSpecies } from './speciesGroups'

// 원문 텍스트를 유지하고 HTTP·HTTPS 주소만 새 탭 링크로 표시합니다.
function SourceText({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s<>"']+)/g).map((part, index) => index % 2
    ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
    : part)}</>
}

function Detail({ survey, species, tagOptions, onDelete, onWeatherChanged, selectedRecord }: { survey: Survey; species:Species[]; tagOptions:Tag[]; onEdit: () => void; onDelete: (observationId: number | null) => void; onWeatherChanged: () => void; selectedRecord: number | null }) {
  const namesFor=(names:string[],category:'environment'|'individual')=>names.filter(name=>(tagOptions.find(t=>t.name===name)?.category||'environment')===category)
  return <article className="detail detail-with-photos"><div className="detail-information"><section className="detail-survey-panel"><span className="eyebrow">탐사 기록 #{survey.id}</span>
    <h2>{survey.display_place || survey.place_name || '좌표로 등록한 장소'}</h2>
    {survey.location_note&&<p className="hint">{survey.location_note}</p>}
    <p>{survey.survey_date} · {PURPOSE[survey.purpose]}</p>
    <p className="hint">{survey.latitude === null ? '탐사 좌표 미지정' : `위도 ${survey.latitude} · 경도 ${survey.longitude}`}</p>
    {(['environment','individual'] as const).map(category=>namesFor(survey.tags||[],category).length>0&&<p key={category} className="tag-summary">탐사 공통 {category==='environment'?'환경':'개체'} 태그: {namesFor(survey.tags||[],category).join(', ')}</p>)}
    {survey.notes && <p className="memo"><SourceText text={survey.notes} /></p>}

    <WeatherPanel key={`survey-${survey.id}`} targetType="survey" targetId={survey.id} />
    </section><h3>종별 기록 {survey.observations.length}건</h3>
    {survey.observations.length === 0 && <p className="empty">종별 기록이 없는 탐사입니다. 특정 종의 미발견을 뜻하지 않습니다.</p>}
    {survey.observations.map(record => <section className={`observation${selectedRecord === record.id ? ' selected' : ''}`} key={record.id}>
      <div className="record-title"><div><h3>{record.species_name || '동정 미확정'}</h3><small className="detail-scientific">{species.find(s=>s.id===record.species_id)?.scientific_name || ''}</small></div><span className={`badge ${record.result}`}>{RESULT[record.result]}</span></div>
      <p>{record.effective_date} · {record.observation_time ? record.observation_time.slice(0,5) : '시각 미상'}</p>
      <p>{record.display_place || record.effective_place || '좌표 지정 위치'}</p><p className="hint">{record.effective_latitude !== null && `위도 ${record.effective_latitude} · 경도 ${record.effective_longitude}`}</p>
      {record.location_note&&<p className="hint">{record.location_note}</p>}
      <p className="hint">{SOURCE_TYPE[record.source_type]}{record.source_note && <> · <SourceText text={record.source_note} /></>}</p>
      {record.result === 'observed' && <dl>
        <dt>성장 단계 · 성별</dt><dd>{STAGE[record.stage]} · {SEX[record.sex]}</dd>
        <dt>관찰 개체 수</dt><dd>{record.count === null ? '미상' : `${record.count}마리${record.count_estimated ? ' (추정)' : ''}`}</dd>
        <dt>채집</dt><dd>{CAPTURE[record.capture_status]}{record.capture_status === 'captured' && ` · ${record.captured_count === null ? '수량 미상' : `${record.captured_count}마리`}`}</dd>
      </dl>}
      {(['environment','individual'] as const).map(category=>namesFor(record.tags||[],category).length>0&&<p key={category} className="tag-summary">{category==='environment'?'환경':'개체'} 태그: {namesFor(record.tags||[],category).join(', ')}</p>)}
      {record.notes && <p className="memo">{record.notes}</p>}

      <WeatherPanel key={`observation-${record.id}`} targetType="observation" targetId={record.id} sourceWeather={record.source_weather} onChanged={onWeatherChanged} />
      <div className="observation-delete"><button type="button" className="danger" onClick={() => onDelete(record.id)}>이 관찰 삭제</button></div>
    </section>)}
    <p className="hint">등록 {new Date(survey.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit' })} · 로컬 보관</p>
    <p className="hint">최근 수정 {new Date(survey.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit' })}</p>
  </div><DetailPhotos ids={[...new Set([...(selectedRecord ? survey.observations.find(r=>r.id===selectedRecord)?.photo_ids || [] : []),...(survey.photo_ids || []),...survey.observations.flatMap(r=>r.photo_ids || [])])]} /></article>
}

export default function App() {
  const [savedView] = useState(() => readView('app'))
  const [species, setSpecies] = useState<Species[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [tagsError, setTagsError] = useState('')
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedSpeciesId,setSelectedSpeciesId] = useState<number|null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailEditing, setDetailEditing] = useState(false)
  const detailForm = useRef<SurveyFormHandle>(null)
  const [tab, setTab] = useState<'map' | 'table'>(savedView.tab === 'map' ? 'map' : 'table')
  const [mapVisited, setMapVisited] = useState(savedView.tab === 'map')
  const [mapFocus, setMapFocus] = useState<Coordinate | null>(null)
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null)
  const [integrationError, setIntegrationError] = useState('')
  const [creating, setCreating] = useState(false)
  const [paperSource, setPaperSource] = useState<(Pick<Paper, 'id' | 'title' | 'url'> & {kind?: 'web'}) | null>(null)
  const [paperRevision, setPaperRevision] = useState(0)
  const [editing, setEditing] = useState<Survey | undefined>()
  const [trashOpen, setTrashOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ survey: Survey; observationId: number | null } | null>(null)
  const formOpen = creating || !!editing || trashOpen || detailOpen
  const [query, setQuery] = useState(typeof savedView.query === 'string' ? savedView.query : '')
  const [filterRevision, setFilterRevision] = useState(0)
  const [infoQuery, setInfoQuery] = useState(typeof savedView.infoQuery === 'string' ? savedView.infoQuery : '')
  const [holdingQuery, setHoldingQuery] = useState(typeof savedView.holdingQuery === 'string' ? savedView.holdingQuery : '')
  const [tableMode, setTableMode] = useState('records')
  const [holdingSidebar, setHoldingSidebar] = useState<HTMLDivElement | null>(null)
  const [holdingRevision, setHoldingRevision] = useState(0)
  const [holdingRegisterOpen, setHoldingRegisterOpen] = useState(false)
  const [infoSidebar, setInfoSidebar] = useState<HTMLDivElement | null>(null)
  const [mapInfoFooter, setMapInfoFooter] = useState<HTMLDivElement | null>(null)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [filters, setFilters] = useState(() => {
    const defaults = emptyFilters(), stored = savedView.filters
    if (stored && typeof stored === 'object') for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
      const value = (stored as Record<string,unknown>)[key]
      if (Array.isArray(defaults[key]) ? Array.isArray(value) && value.every(v => typeof v === 'string') : typeof value === 'string') Object.assign(defaults,{[key]:value})
    }
    return defaults
  })
  const [weather, setWeather] = useState<Record<number, SavedWeather>>({})
  const [referenceEditing, setReferenceEditing] = useState(false)
  const [mode, setMode] = useState<'records' | 'info' | 'collection'>(savedView.mode === 'info' || savedView.mode === 'collection' ? savedView.mode : 'records')
  const [collectionRemote, setCollectionRemote] = useState<HTMLDivElement | null>(null)
  const [collectionSource, setCollectionSource] = useState('inaturalist')
  useEffect(() => { writeView('app',{mode,tab,query,infoQuery,holdingQuery,filters}) },[mode,tab,query,infoQuery,holdingQuery,filters])
  const collectionSources = [
    { id: 'mobile', name: '내 사진', method: '휴대폰 전송', description: '내 사진의 촬영 정보를 검수해 탐사를 등록하고 여러 종의 관찰을 추가합니다.' },
    { id: 'inaturalist', name: 'iNaturalist', method: '공식 API', description: '공식 API로 공개 나비 관찰 자료를 조회합니다.' },
    { id: 'naturing', name: '네이처링', method: '현재 관찰 페이지 가져오기', description: '브라우저 확장 프로그램으로 직접 열어 둔 관찰 기록을 가져옵니다.' },
    { id: 'papers', name: '논문 탐색', method: '공식 서지 API', description: '나비 관련 논문을 모으고 원문 근거로 간접 관찰 사례를 등록합니다.' },
    { id: 'google', name: '구글링', method: '관심 종 웹 검색', description: '관심 종과 기간을 기준으로 블로그·공개 커뮤니티의 자료를 찾습니다.' },
  ]
  const selectedSource = collectionSources.find(source => source.id === collectionSource)!
  const holdingShown = mode === 'records' && tab === 'table' && tableMode === 'holdings'
  const needsRecords = mode === 'records' && !holdingShown
  const [targets, setTargets] = useState(emptyTargets)
  const [references, setReferences] = useState<ExplorationRow[]>([])
  const [referenceLoading, setReferenceLoading] = useState(true)
  const [referenceError, setReferenceError] = useState('')
  const [referenceRevision, setReferenceRevision] = useState(0)
  const [selectedRecord, setSelectedRecord] = useState<number | null>(null)
  const [detailCloseConfirm, setDetailCloseConfirm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  function rememberTag(tag: Tag) { setTags(current => current.some(t => t.name === tag.name) ? current.map(t=>t.name===tag.name?{...t,...tag}:t) : [...current, tag]) }
  async function refreshTags() {
    try { setTags(await listTags()); setTagsError('') }
    catch (e) { setTagsError(e instanceof Error ? e.message : '태그 목록을 읽지 못했습니다.') }
  }
  useEffect(() => {
    let active = true
    listTags().then(values => { if (active) { setTags(values); setTagsError('') } })
      .catch((e: unknown) => { if (active) setTagsError(e instanceof Error ? e.message : '태그 목록을 읽지 못했습니다.') })
    return () => { active = false }
  }, [])
  const snapshot = useRef(0)
  const initialized = useRef(false)
  async function registered(changes?: Survey[]) {
    if (!initialized.current) { refreshReferences(); return }
    if (!changes) { await load(); return }
    if (!changes.length) return
    snapshot.current++
    const updated = new Map(changes.map(s => [s.id,s]))
    setSurveys(current => [...changes,...current.filter(s => !updated.has(s.id))].sort((a,b) => b.survey_date.localeCompare(a.survey_date) || b.id-a.id))
    refreshReferences()
  }
  async function load() {
    setLoading(true)
    const version = ++snapshot.current
    try {
      const [nextSpecies, nextSurveys, nextWeather] = await Promise.all([listSpecies(), listSurveys(), recordWeather()])
      if (version !== snapshot.current) return
      initialized.current = true
      setSpecies(nextSpecies); setSurveys(nextSurveys); setWeather(nextWeather); setError('')
      refreshReferences(); void refreshTags()
    } catch (error) { setError(error instanceof Error ? error.message : '목록을 불러오지 못했습니다.') }
    finally { setLoading(false) }
  }
  const needsSurveys = mode !== 'collection'
  useEffect(() => {
    let active = true
    listSpecies().then(next => { if (active) setSpecies(next) })
      .catch(() => { if (active && !initialized.current) setError('종 목록을 불러오지 못했습니다.') })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!needsSurveys || initialized.current) return
    let active = true
    const controller = new AbortController()
    const version = snapshot.current
    listSurveys(controller.signal)
      .then(next => {
        if (active && version === snapshot.current) {
          initialized.current = true
          setSurveys(next)
          setError('')
        }
      })
      .catch((error: unknown) => {
        if (active && version === snapshot.current) setError(error instanceof Error ? error.message : '목록을 불러오지 못했습니다.')
      })
      .finally(() => { if (active && version === snapshot.current) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [needsSurveys])
  useEffect(() => {
    if (!needsRecords) return
    let active = true
    recordWeather().then(next => { if (active) setWeather(next) })
      .catch(() => { if (active) setNotice('저장 기상을 읽지 못했습니다. 기록 목록은 사용할 수 있습니다.') })
    return () => { active = false }
  }, [needsRecords])
  useEffect(() => {
    let active = true
    if (!needsRecords) return
    const request = targets.on ? catalogExploration(String(referenceRevision), targets.on, '') : Promise.reject(new Error('출현 기준일을 입력해 주세요.'))
    request.then(next => { if (active) setReferences(next) })
      .catch((e: unknown) => { if (active) setReferenceError(e instanceof Error ? e.message : '종 참고자료를 읽지 못했습니다.') })
      .finally(() => { if (active) setReferenceLoading(false) })
    return () => { active = false }
  }, [targets.on, needsRecords, referenceRevision])
  const referencesReady = !referenceLoading && !referenceError
  const referenceMap = useMemo(() => new Map(references.map(row => [row.id, row])), [references])
  const ranks = useMemo(() => new Map(species.map((s, index) => [s.id, index])), [species])
  const allRecords = useMemo(() => needsRecords ? rowsFor(surveys, species, weather) : [], [needsRecords, surveys, species, weather])
  const matchedRows = useMemo(() => allRecords.filter(row => matches(row, filters, query)), [allRecords, filters, query])
  const speciesGroups=useMemo(()=>groupSpecies(matchedRows,filters.place||query,ranks),[matchedRows,filters.place,query,ranks])
  const matchedCandidates = useMemo(() => needsRecords && referencesReady ? referenceCandidates(references, allRecords, filters, emptyTargets(), query) : [], [needsRecords, referencesReady, references, allRecords, filters, query])
  const exactSpecies=species.find(s=>query.trim()&&[s.korean_name,s.scientific_name].some(n=>n?.toLowerCase()===query.trim().toLowerCase()))
  const activeSpeciesId=selectedSpeciesId!==null&&(speciesGroups.some(g=>g.id===selectedSpeciesId)||matchedCandidates.some(r=>r.id===selectedSpeciesId))?selectedSpeciesId:exactSpecies?.id??(filters.species.length===1&&filters.species[0]!=='unknown'?Number(filters.species[0]):null)
  const distribution=useMemo(()=>{
    const species=activeSpeciesId===null?undefined:referenceMap.get(activeSpeciesId)
    return species?{name:species.korean_name,reference:species.reference}:null
  },[activeSpeciesId,referenceMap])
  const rows=useMemo(()=>activeSpeciesId===null?matchedRows:matchedRows.filter(r=>(r.record.species_id??-1)===activeSpeciesId),[matchedRows,activeSpeciesId])
  const candidates=useMemo(()=>activeSpeciesId===null?matchedCandidates:matchedCandidates.filter(r=>r.id===activeSpeciesId),[matchedCandidates,activeSpeciesId])
  const surveyIds = useMemo(() => new Set(rows.map(row => row.survey.id)), [rows])
  const emptySurveys = useMemo(() => !needsRecords ? [] : surveys.filter(s => s.purpose !== 'online_research' && emptySurveyMatches(s, filters, query)), [needsRecords, surveys, filters, query])
  const filtered = useMemo(() => !needsRecords ? [] : surveys.filter(s => surveyIds.has(s.id) || emptySurveys.includes(s)), [needsRecords, surveys, surveyIds, emptySurveys])
  const selected = filtered.find(s => s.id === selectedId)
  const mapShown = mode === 'records' && tab === 'map'
  const pins: MapPin[] = useMemo(() => !mapShown ? [] : [
    ...rows.flatMap(({ survey, record: r }): MapPin[] => {
      const latitude = r.administrative_pin?.latitude ?? r.effective_latitude
      const longitude = r.administrative_pin?.longitude ?? r.effective_longitude
      if (latitude === null || longitude === null) return []
      const note = r.administrative_pin ? '행정구역 중심 표시 · 정확한 관찰 위치 미상' : r.source_location_note
      return [{ id: `record-${r.id}`, surveyId: survey.id, source: r.administrative_pin ? 'administrative' : pinSource(r), latitude, longitude, label: `${r.effective_date} · ${r.species_name || '동정 미확정'} · ${RESULT[r.result]}${note ? ' · ' + note : ''}` }]
    }),
    ...(activeSpeciesId===null?emptySurveys:[]).flatMap(s => s.latitude !== null && s.longitude !== null ? [{ id: `survey-${s.id}`, surveyId: s.id, latitude: s.latitude, longitude: s.longitude, label: `${s.survey_date} · ${s.display_place || s.place_name || '탐사 위치'} · 종별 기록 없음` }] : []),
  ], [mapShown,rows, emptySurveys,activeSpeciesId])
  const selectSurvey = useCallback((s: Survey, recordId?: number) => {
    setSelectedId(s.id); setSelectedRecord(recordId ?? null)
    const record = recordId ? s.observations.find(o => o.id === recordId) : rows.find(row => row.survey.id === s.id && (row.record.administrative_pin || row.record.effective_latitude !== null && row.record.effective_longitude !== null))?.record
    const latitude = record?.administrative_pin?.latitude ?? record?.effective_latitude ?? (!recordId && !s.observations.length ? s.latitude : null)
    const longitude = record?.administrative_pin?.longitude ?? record?.effective_longitude ?? (!recordId && !s.observations.length ? s.longitude : null)
    setMapFocus(latitude !== null && longitude !== null ? {latitude,longitude} : null)
  }, [rows])
  const openRecordDetail = useCallback((s: Survey, recordId?: number) => {
    setDetailEditing(false)
    setDetailCloseConfirm(false)
    selectSurvey(s, recordId)
    setDetailOpen(true)
  }, [selectSurvey])
  function closeRecordDetail() {
    if (detailEditing) detailForm.current?.requestClose()
    else setDetailOpen(false)
  }
  async function saveDetail(saved: Survey) {
    snapshot.current++
    setSurveys(current => current.map(item => item.id === saved.id ? saved : item))
    setDetailEditing(false); refreshReferences(); void refreshTags(); await refreshWeather()
  }
  const changeTableMode = useCallback((next: string) => { setTableMode(next); setNotice('') }, [])
  const recordTable = useMemo(() => <RecordTable mode={tableMode} holdingsView={null} rows={rows} surveys={filtered} references={referenceMap} candidates={candidates} ranks={ranks} onSelect={selectSurvey} onOpen={openRecordDetail} selectedId={selectedId} />, [tableMode, rows, filtered, referenceMap, candidates, ranks, selectSurvey, openRecordDetail, selectedId])
  function chooseSpecies(id:number) {
    setSelectedSpeciesId(id);setSelectedId(null);setSelectedRecord(null)
    const latest=matchedRows.filter(r=>r.record.species_id===id&&(r.record.administrative_pin||r.record.effective_latitude!==null)).sort((a,b)=>b.record.effective_date.localeCompare(a.record.effective_date))[0]?.record
    setMapFocus(latest?.administrative_pin ?? (latest&&latest.effective_latitude!==null&&latest.effective_longitude!==null?{latitude:latest.effective_latitude,longitude:latest.effective_longitude}:null))
  }
  const observedSpeciesCount=new Set(matchedRows.filter(r=>r.record.result==='observed'&&r.record.species_id!==null).map(r=>r.record.species_id)).size
  const surveyList=<nav aria-label="종별 기록" className="survey-list">
    {tab === 'map' && selected && <button type="button" className="selected-survey-summary selected" onDoubleClick={() => { setTab('table'); openRecordDetail(selected, selectedRecord ?? undefined) }} onKeyDown={e => {if(e.key==='Enter'){setTab('table');openRecordDetail(selected,selectedRecord ?? undefined)}}} title="더블클릭하면 탐사 상세를 엽니다"><strong>선택한 탐사 · {selected.survey_date}</strong><span>{selected.display_place || selected.place_name || '좌표 지정 장소'}</span><span>{selected.observations.map(r => r.species_name || '동정 미확정').filter((v,i,a)=>a.indexOf(v)===i).join(' · ') || '종별 기록 없음'}</span><span>종별 기록 {selected.observations.length}건</span></button>}
    {activeSpeciesId!==null&&<button type="button" onClick={()=>{setSelectedSpeciesId(null);setFilters({...filters,species:[]});if(exactSpecies)setQuery('')}}>종 선택 해제 · 전체 보기</button>}
    {speciesGroups.filter(g=>g.id!==-1).map(g=><button key={g.id} disabled={referenceEditing||formOpen} className={activeSpeciesId===g.id?'selected':''} onClick={()=>chooseSpecies(g.id)}>
      <strong>{g.name}</strong><span className="species-card-region">{g.regions[0]||'행정지역 미확인'}{g.regions.length>1&&` · 외 ${g.regions.length-1}개 지역`}</span>
      <span>관찰 {g.observed}건 · 직접 {g.direct} / 간접 {g.indirect}{g.notFound>0&&` · 미발견 ${g.notFound}건`}</span>{g.latest&&<span>최근 관찰 {g.latest}</span>}
    </button>)}
    {query.trim()&&matchedCandidates.map(r=><button key={`reference-${r.id}`} className={activeSpeciesId===r.id?'selected':''} disabled={referenceEditing||formOpen} onClick={()=>chooseSpecies(r.id)}><strong>{r.korean_name}</strong><span>{[...r.reference.regions].sort((a,b)=>Number(b.includes(query))-Number(a.includes(query)))[0]||'지역 미등록'}</span><span>출현지역 참고 · 관찰 기록 없음</span></button>)}
    {(speciesGroups.some(g=>g.id===-1)||emptySurveys.length>0)&&<details><summary>동정 미확정·종별 기록 없는 탐사</summary>{speciesGroups.filter(g=>g.id===-1).map(g=><button key="unknown" onClick={()=>chooseSpecies(-1)}>동정 미확정 · {g.rows.length}건</button>)}{emptySurveys.map(s=><button key={`empty-${s.id}`} disabled={referenceEditing||formOpen} onClick={()=>openRecordDetail(s)}><strong>{s.display_place||s.place_name||'좌표 지정 장소'}</strong><span>{s.survey_date} · 종별 기록 없음</span><span>상세 보기</span></button>)}</details>}
  </nav>
  const detailSurvey = surveys.find(s => s.id === selectedId)
  function referenceUpdated(id: number, hostPlants: string) {
    setSpecies(current => current.map(s => s.id === id ? { ...s, host_plants: hostPlants } : s))
    refreshReferences()
  }
  function refreshReferences() {
    setReferences([]); setReferenceError(''); setReferenceLoading(true); setReferenceRevision(n => n + 1)
  }
  function changeTargets(next: typeof targets) {
    if (next.on !== targets.on) { setReferences([]); setReferenceError(''); setReferenceLoading(true) }
    setTargets(next)
  }
  async function refreshWeather() {
    try { setWeather(await recordWeather()); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : '저장 기상 목록을 읽지 못했습니다.') }
  }
  async function showIntegration() {
    try { setIntegration(await integrationStatus()); setIntegrationError('') }
    catch (e) { setIntegrationError(e instanceof Error ? e.message : '연동 상태를 확인하지 못했습니다.') }
  }
  function showTrash(target: { survey: Survey; observationId: number | null } | null = null) {
    setDeleteTarget(target); setTrashOpen(true)
  }
  async function reloadAfterTrash() {
    const version = ++snapshot.current
    const [nextSurveys, nextWeather] = await Promise.all([listSurveys(), recordWeather()])
    if (version !== snapshot.current) { await load(); return }
    setSurveys(nextSurveys); setWeather(nextWeather); setSelectedId(null); setSelectedRecord(null)
    refreshReferences(); void refreshTags(); setNotice('휴지통 변경을 반영했습니다.')
  }
  const form = (creating || !!editing) && <SurveyForm sourcePaper={paperSource || undefined} tagOptions={tags} onTagCreated={rememberTag} tagsError={tagsError} onRetryTags={() => void refreshTags()} key={editing ? `edit-${editing.id}-${editing.updated_at}` : 'new'} initial={editing} species={species} onCancel={() => { setCreating(false); setEditing(undefined); setPaperSource(null); setPaperRevision(n => n + 1) }} onSaved={saved => {
    snapshot.current++
    setSurveys(current => [saved, ...current.filter(item => item.id !== saved.id)].sort((a, b) => b.survey_date.localeCompare(a.survey_date) || b.id - a.id))
    setSelectedId(saved.id); refreshReferences(); void refreshTags(); setTargets(emptyTargets()); setMapFocus(saved.latitude !== null && saved.longitude !== null ? { latitude: saved.latitude, longitude: saved.longitude } : null)
    setCreating(false); setEditing(undefined); setPaperSource(null); setPaperRevision(n => n + 1); setQuery(''); setFilters(emptyFilters()); void refreshWeather(); setNotice(editing ? '수정을 저장했습니다. 기존 기상자료는 보존했습니다.' : '탐사를 저장했습니다. 상세 화면에서 기상자료를 연결할 수 있습니다.')
  }} />
  return <div className="app-shell"><ScrollToTop />
    <div className="workspace">
      <aside className="sidebar">
        <header className="app-header"><span className="eyebrow">BUTTERFLY ARCHIVE</span><h1>나비 관찰 기록</h1></header>
        {mode !== 'collection' && <div className="sidebar-tools"><label className="sidebar-search"><span className="sr-only">{mode === 'info' ? '나비 검색' : holdingShown ? '소장 검색' : '기록 검색'}</span><input type="search" disabled={referenceEditing || formOpen} placeholder={mode === 'info' ? '국명·학명·태그·지역 검색' : holdingShown ? '국명·학명·취득 근거·메모' : '기록 검색'} value={mode === 'info' ? infoQuery : holdingShown ? holdingQuery : query} onChange={e => mode === 'info' ? setInfoQuery(e.target.value) : holdingShown ? setHoldingQuery(e.target.value) : setQuery(e.target.value)} /></label>{mode === 'records' && !holdingShown ? <button className="icon-button has-tooltip" aria-label="필터 전체 초기화" data-tooltip="필터 전체 초기화" disabled={formOpen || referenceEditing} onClick={() => { setQuery(''); setFilters(emptyFilters()); setFilterRevision(n => n + 1) }}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'translateY(1px)' }}><path d="M3 3.5h18l-7 8v7l-4 2v-9L3 3.5Zm14 12 4 4m0-4-4 4" /></svg></button> : <button className="icon-button has-tooltip" aria-label="새로고침" data-tooltip="새로고침" disabled={loading || formOpen || referenceEditing} onClick={() => { if (holdingShown) setHoldingRevision(n => n + 1); setLoading(true); void load() }}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 7V3m0 4h-4m4 0a8 8 0 1 0 1 8" /></svg></button>}<button className="icon-button has-tooltip" aria-label={mode === 'info' ? '나비 등록 열기' : holdingShown ? '소장 등록' : '새 탐사'} data-tooltip={mode === 'info' ? '나비 등록' : holdingShown ? '소장 등록' : '새 탐사'} disabled={referenceEditing || formOpen || loading || (mode === 'records' && !!error)} onClick={() => { if (mode === 'info') { setRegisterOpen(true); requestAnimationFrame(() => document.getElementById('catalog-new-name')?.focus()) } else if (holdingShown) { setHoldingRegisterOpen(true); setReferenceEditing(true) } else { setCreating(true); setNotice('') } }}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 4v16M4 12h16" /></svg></button></div>}
        <div className="sidebar-scroll" role="region" aria-label="왼쪽 정보" tabIndex={0}>
        <div className="sidebar-card">
        {mode === 'collection' && <section className="collection-sidebar"><h2>수집처 선택</h2><div className="collection-source-list" role="group" aria-label="자료 수집처">{collectionSources.map(source => <button key={source.id} aria-pressed={collectionSource === source.id} onClick={() => setCollectionSource(source.id)}>{source.name}</button>)}</div></section>}
        <div ref={setCollectionRemote} hidden={mode !== 'collection' || !['naturing', 'inaturalist'].includes(collectionSource)} />
        <div ref={setInfoSidebar} hidden={mode !== 'info'} />
        {mode === 'records' && tab === 'table' && <label className="record-view-select"><span className="sr-only">표 종류</span><select aria-label="표 종류" value={tableMode} disabled={referenceEditing || formOpen} onChange={e => changeTableMode(e.target.value)}><option value="records">관찰 기록</option><option value="surveys">탐사 목록</option><option value="holdings">소장 목록</option></select></label>}
        <div ref={setHoldingSidebar} hidden={!holdingShown} />
        <div hidden={mode !== 'records' || holdingShown}>
        <SearchFilters key={filterRevision} tags={tags} tagsError={tagsError} retryTags={() => void refreshTags()} value={filters} onChange={setFilters} species={species} disabled={referenceEditing || formOpen} expanded={false} />
        <p className="hint">종별 기록 {rows.length}건 · 좌표 있음 {rows.filter(r => r.record.effective_latitude !== null).length}건 · 좌표 없음 {rows.filter(r => r.record.effective_latitude === null).length}건</p>
        <details open><summary style={{cursor: 'pointer', marginBottom: 12}}><strong>종별 기록</strong><small style={{float: 'right'}}>관찰 {observedSpeciesCount}종</small></summary>
        {loading && <p role="status">목록을 불러오는 중입니다.</p>}
        {error && <div role="alert" className="error">{error} <button type="button" disabled={loading} onClick={() => void load()}>기록 다시 불러오기</button></div>}
        {!loading && !error && filtered.length === 0 && !(query.trim()&&matchedCandidates.length) && <p className="empty">{surveys.length ? '검색 결과가 없습니다.' : '첫 탐사를 등록해 주세요.'}</p>}
        {surveyList}</details></div>
        <button className="trash-open" disabled={formOpen || referenceEditing} onClick={() => showTrash()}>휴지통</button>
        <details className="integration-status"><summary onClick={() => void showIntegration()}>연동 상태·로컬 사용량</summary>
          <p className="hint">네이버 무료 대표 계정과 콘솔 사용 제한을 유지해야 합니다. 아래 숫자는 이 DB의 호출 시도이며 제공자 전체 사용량과 다를 수 있습니다.</p>
          {integration && <><p>지도 {integration.maps_ready ? '설정됨' : '비활성'} · 기상 {integration.weather_ready ? '설정됨' : '비활성'}</p>{[...integration.usage].sort((a, b) => (a.service === 'map' ? 0 : 1) - (b.service === 'map' ? 0 : 1)).map(u => <div key={u.service}>
            <p><strong>{({ map: 'Dynamic Map', geocode: 'Geocoding', reverse: 'Reverse Geocoding', kma: '기상청' })[u.service] || u.service}</strong><br />
              앱 집계: 오늘 {u.today.toLocaleString('ko-KR')}{u.daily_limit !== null && ` / ${u.daily_limit.toLocaleString('ko-KR')}`}회 · 이번 달 {u.month.toLocaleString('ko-KR')}{u.monthly_limit !== null && ` / ${u.monthly_limit.toLocaleString('ko-KR')}`}회<br />
              한도: {u.daily_limit !== null ? `일 ${u.daily_limit.toLocaleString('ko-KR')}회` : `월 ${u.monthly_limit?.toLocaleString('ko-KR')}회`}
            </p>
            {u.reported_count !== null && <p className="hint">사용자 확인: {u.reported_count.toLocaleString('ko-KR')}회 / 월 {u.monthly_limit?.toLocaleString('ko-KR')}회 ({u.reported_date} 기준 · 자동 갱신 아님)</p>}
          </div>)}</>}
          {integrationError && <p className="error">{integrationError}</p>}
        </details>

        </div>
        </div>
        <nav className="tabs" aria-label="화면 선택"><button disabled={referenceEditing || formOpen} aria-pressed={tab === 'map' && mode === 'records'} onClick={() => { setSelectedId(null); setSelectedRecord(null); setMode('records'); setTab('map'); setMapVisited(true) }}>지도</button><button disabled={referenceEditing || formOpen} aria-pressed={tab === 'table' && mode === 'records'} onClick={() => { setMode('records'); setTab('table') }}>기록</button><button disabled={referenceEditing || formOpen} aria-pressed={mode === 'info'} onClick={() => { setMode('info'); setTab('table') }}>나비 도감</button><button disabled={referenceEditing || formOpen} aria-pressed={mode === 'collection'} onClick={() => { setMode('collection'); setTab('table') }}>자료 수집</button></nav>
      </aside>
      <div className="main-shell">
      <main className={`main-pane${tab === 'map' && mode === 'records' ? ' map-pane' : mode === 'info' ? ' catalog-pane' : ' record-pane'}`}>
        {notice && mode === 'records' && <p role="status" className="notice">{notice}</p>}
        {mode === 'collection' && <section className="collection-view"><div className="catalog-toolbar"><h2>자료 수집</h2></div><div className="collection-panel"><span className="eyebrow">{selectedSource.method}</span><h3>{selectedSource.name}</h3><p>{selectedSource.description}</p>{collectionSource === 'naturing' || collectionSource === 'inaturalist' ? <CollectionInbox key={collectionSource} source={collectionSource} remoteTarget={collectionRemote} onRegistered={registered} /> : collectionSource === 'mobile' ? <MobileInbox onRegistered={registered} onEditing={setReferenceEditing} onAddObservation={survey=>{setMode('records');setTab('table');setTableMode('surveys');selectSurvey(survey);setDetailOpen(true);setDetailEditing(true)}} /> : collectionSource === 'papers' ? <PaperBrowser species={species} revision={paperRevision} onRegister={paper => { setPaperSource(paper); setCreating(true) }} /> : <WebResearch species={species} revision={paperRevision} onRegister={source => {setPaperSource({...source, kind:'web'}); setCreating(true)}} />}</div></section>}
        {mode === 'info' && <ButterflyInfo currentReferences={referencesReady && references.length ? references : undefined} targets={targets} onTargets={changeTargets} species={species} onCreated={s => { setSpecies(current => [...current, s]); setInfoQuery(''); refreshReferences() }} onUpdated={s => referenceUpdated(s.id, s.host_plants)} onEditing={setReferenceEditing} sidebar={infoSidebar} query={infoQuery} revision={referenceRevision} surveys={surveys} registerOpen={registerOpen} onRegisterOpen={setRegisterOpen} />}
        {mapVisited && <div className="map-workspace" hidden={tab !== 'map' || mode !== 'records'}><MapView infoContainer={mapInfoFooter} distribution={distribution} shown={tab === 'map' && mode === 'records'} pins={pins} onOpen={pin=>{
          const survey=surveys.find(s=>s.id===pin.surveyId)
          if(!survey)return
          setMode('records');setTab('table');setTableMode(survey.observations.some(o=>o.source_type==='indirect')?'records':'surveys')
          openRecordDetail(survey,pin.id.startsWith('record-')?Number(pin.id.slice(7)):undefined)
        }} focus={mapFocus} onSelect={pin => { setSelectedId(pin.surveyId); setSelectedRecord(pin.id.startsWith('record-') ? Number(pin.id.slice(7)) : null); setMapFocus(pin) }} />
          {selected && !pins.some(p => p.surveyId === selected.id) && <p>선택한 기록에는 좌표가 없습니다. 지도에 임의 위치를 표시하지 않습니다.</p>}
          {!pins.length && <p className="hint">현재 검색 결과에 표시할 관찰 핀 좌표가 없습니다.</p>}</div>}
        {mode === 'records' && tab === 'table' && <>

          {referenceLoading && <p role="status">종 참고자료를 읽는 중입니다.</p>}
          {referenceError && <p role="alert" className="error">{referenceError}<button disabled={referenceEditing || formOpen} onClick={refreshReferences}>참고자료 다시 읽기</button></p>}
          {tableMode !== 'holdings' ? recordTable : <RecordTable mode={tableMode} holdingsView={<HoldingsView species={species} surveys={surveys} query={holdingQuery} sidebar={holdingSidebar} revision={holdingRevision} registerOpen={holdingRegisterOpen} onRegisterOpen={setHoldingRegisterOpen} onEditing={setReferenceEditing} onChanged={() => refreshReferences()} />} rows={rows} surveys={filtered} references={referenceMap} candidates={candidates} ranks={ranks} onSelect={selectSurvey} onOpen={openRecordDetail} selectedId={selectedId} />}

        </>}
      </main>
      <footer className="workspace-status"><span>개인 기록 · 로컬 저장</span><span>기상은 저장 후 재사용 · 자동 갱신 없음</span>{tab === 'map' && mode === 'records' && <><span>네이버 지도 · 위치 조회는 외부 연결을 사용합니다.</span><div className="distribution-footer" ref={setMapInfoFooter}/></>}</footer>
      </div>
    </div>
    {form}
          {detailOpen && detailSurvey && <dialog className={`record-detail-dialog${detailEditing ? ' survey-dialog' : ''}`} aria-labelledby="record-detail-title" ref={node => { if (node && !node.open) { node.showModal(); node.querySelector<HTMLButtonElement>('[data-detail-close]')?.focus() } }} onCancel={event => { event.preventDefault(); closeRecordDetail() }}>
            <header className="record-detail-header"><h2 id="record-detail-title">{detailEditing ? '관찰 기록 수정' : '관찰 기록 상세'}</h2><div className="record-detail-actions">{!detailEditing && <><button type="button" className="danger" onClick={()=>{setDetailOpen(false);showTrash({survey:detailSurvey,observationId:null})}}>탐사 전체 삭제</button><button type="button" onClick={()=>{setDetailCloseConfirm(false);setDetailEditing(true)}}>기록 수정</button></>}<>{detailEditing && detailCloseConfirm ? <CloseConfirmation onContinue={() => detailForm.current?.cancelClose()} onDiscard={() => { setDetailCloseConfirm(false); setDetailEditing(false) }} /> : <button type="button" autoFocus data-detail-close onClick={closeRecordDetail}>닫기</button>}</></div></header>
            {detailEditing ? <SurveyForm embedded onCloseConfirmationChange={setDetailCloseConfirm} closeRef={detailForm} selectedObservationId={selectedRecord} initial={detailSurvey} species={species} tagOptions={tags} onTagCreated={rememberTag} tagsError={tagsError} onRetryTags={() => void refreshTags()} onCancel={() => { setDetailCloseConfirm(false); setDetailEditing(false) }} onSaved={saved => void saveDetail(saved)} /> : <Detail key={`${detailSurvey.id}-${detailSurvey.updated_at}`} species={species} tagOptions={tags} survey={detailSurvey} selectedRecord={selectedRecord} onDelete={id => { setDetailOpen(false); showTrash({ survey: detailSurvey, observationId: id }) }} onWeatherChanged={() => void refreshWeather()} onEdit={() => { setDetailCloseConfirm(false); setDetailEditing(true) }} />}
          </dialog>}
    {trashOpen && <TrashDialog target={deleteTarget} onClose={() => setTrashOpen(false)} onChanged={reloadAfterTrash} />}
  </div>
}
