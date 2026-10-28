// 조사 등록과 지도·표 보기의 선택 상태를 관리합니다.
import { useEffect, useState } from 'react'
import { listSpecies, listSurveys, integrationStatus, recordWeather, findExploration, listTags } from './api'
import { CAPTURE, IDENTIFICATION, PURPOSE, RESULT, SEX, STAGE, SOURCE_TYPE } from './models'
import type { Species, Survey, MapPin, Coordinate, IntegrationStatus, SavedWeather, ExplorationRow, Tag } from './models'
import SurveyForm from './SurveyForm'
import MapView from './MapView'
import WeatherPanel from './WeatherPanel'
import { PhotoGallery } from './PhotoPicker'
import SearchFilters from './SearchFilters'
import RecordTable from './RecordTable'
import ButterflyInfo from './ButterflyInfo'
import { emptyFilters, emptyTargets, rowsFor, matches, emptySurveyMatches, hasTargetConditions, targetMatches, referenceCandidates } from './recordSearch'
import './App.css'

function Detail({ survey, onEdit, onWeatherChanged, selectedRecord }: { survey: Survey; onEdit: () => void; onWeatherChanged: () => void; selectedRecord: number | null }) {
  return <article className="detail"><span className="eyebrow">조사 기록 #{survey.id}</span>
    <button type="button" onClick={onEdit}>기록 수정</button><h2>{survey.place_name || '좌표로 등록한 장소'}</h2>
    <p>{survey.survey_date} · {PURPOSE[survey.purpose]}</p>
    <p className="hint">{survey.latitude === null ? '조사 좌표 미지정' : `위도 ${survey.latitude} · 경도 ${survey.longitude}`}</p>
    {(survey.tags || []).length > 0 && <p className="tag-summary">조사 공통 태그: {survey.tags.join(', ')}</p>}
    {survey.notes && <p className="memo">{survey.notes}</p>}
    <PhotoGallery ids={survey.photo_ids || []} />
    <WeatherPanel key={`survey-${survey.id}`} targetType="survey" targetId={survey.id} />
    <h3>종별 기록 {survey.observations.length}건</h3>
    {survey.observations.length === 0 && <p className="empty">종별 기록이 없는 조사입니다. 특정 종의 미발견을 뜻하지 않습니다.</p>}
    {survey.observations.map(record => <section className={`observation${selectedRecord === record.id ? ' selected' : ''}`} key={record.id}>
      <div className="record-title"><h3>{record.species_name || '동정 미확정'}</h3><span className={`badge ${record.result}`}>{RESULT[record.result]}</span></div>
      <p>{record.effective_date} · {record.observation_time || '시각 미상'}</p>
      <p>{record.effective_place || '좌표 지정 위치'}{record.effective_latitude !== null && ` · ${record.effective_latitude}, ${record.effective_longitude}`}</p>
      <p className="hint">{SOURCE_TYPE[record.source_type]}{record.source_note && ` · ${record.source_note}`}</p>
      {record.result === 'observed' && <dl>
        <dt>발육 단계 · 성별</dt><dd>{STAGE[record.stage]} · {SEX[record.sex]}</dd>
        <dt>관찰 개체 수</dt><dd>{record.count === null ? '미상' : `${record.count}마리${record.count_estimated ? ' (추정)' : ''}`}</dd>
        <dt>채집</dt><dd>{CAPTURE[record.capture_status]}{record.capture_status === 'captured' && ` · ${record.captured_count === null ? '수량 미상' : `${record.captured_count}마리`}`}</dd>
        <dt>동정 상태</dt><dd>{IDENTIFICATION[record.identification]}</dd>
      </dl>}
      {(record.tags || []).length > 0 && <p className="tag-summary">종별 추가 태그: {record.tags.join(', ')}</p>}
      {record.notes && <p className="memo">{record.notes}</p>}
      <PhotoGallery ids={record.photo_ids || []} />
      <WeatherPanel key={`observation-${record.id}`} targetType="observation" targetId={record.id} onChanged={onWeatherChanged} />
    </section>)}
    <p className="hint">등록 {new Date(survey.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 로컬 보관</p>
    <p className="hint">최근 수정 {new Date(survey.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
  </article>
}

export default function App() {
  const [species, setSpecies] = useState<Species[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [tagsError, setTagsError] = useState('')
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [tab, setTab] = useState<'map' | 'table'>('table')
  const [mapVisited, setMapVisited] = useState(false)
  const [mapFocus, setMapFocus] = useState<Coordinate | null>(null)
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null)
  const [integrationError, setIntegrationError] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Survey | undefined>()
  const formOpen = creating || !!editing
  const [query, setQuery] = useState('')
  const [infoQuery, setInfoQuery] = useState('')
  const [infoSidebar, setInfoSidebar] = useState<HTMLDivElement | null>(null)
  const [registerOpen, setRegisterOpen] = useState(true)
  const [filters, setFilters] = useState(emptyFilters)
  const [weather, setWeather] = useState<Record<number, SavedWeather>>({})
  const [referenceEditing, setReferenceEditing] = useState(false)
  const [mode, setMode] = useState<'records' | 'info'>('records')
  const [targets, setTargets] = useState(emptyTargets)
  const [references, setReferences] = useState<ExplorationRow[]>([])
  const [referenceLoading, setReferenceLoading] = useState(true)
  const [referenceError, setReferenceError] = useState('')
  const [referenceRevision, setReferenceRevision] = useState(0)
  const [selectedRecord, setSelectedRecord] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  function rememberTag(tag: Tag) { setTags(current => current.some(t => t.name === tag.name) ? current : [...current, tag]) }
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
  async function load() {
    try {
      const [nextSpecies, nextSurveys, nextWeather] = await Promise.all([listSpecies(), listSurveys(), recordWeather()])
      setSpecies(nextSpecies); setSurveys(nextSurveys); setWeather(nextWeather); setError('')
      refreshReferences(); void refreshTags()
    } catch (error) { setError(error instanceof Error ? error.message : '목록을 불러오지 못했습니다.') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let active = true
    Promise.all([listSpecies(), listSurveys(), recordWeather()])
      .then(([nextSpecies, nextSurveys, nextWeather]) => {
        if (active) { setSpecies(nextSpecies); setSurveys(nextSurveys); setWeather(nextWeather); setError('') }
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : '목록을 불러오지 못했습니다.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    const request = targets.on ? findExploration(targets.on, targets.region) : Promise.reject(new Error('출현 기준일을 입력해 주세요.'))
    request.then(next => { if (active) setReferences(next) })
      .catch((e: unknown) => { if (active) setReferenceError(e instanceof Error ? e.message : '종 참고자료를 읽지 못했습니다.') })
      .finally(() => { if (active) setReferenceLoading(false) })
    return () => { active = false }
  }, [targets.on, targets.region, referenceRevision])
  const referencesReady = !referenceLoading && !referenceError
  const referenceMap = new Map(references.map(row => [row.id, row]))
  const ranks = new Map(species.map((s, index) => [s.id, index]))
  const allRecords = rowsFor(surveys, species, weather)
  const rows = allRecords.filter(row => {
    const ref = referenceMap.get(row.record.species_id ?? -1)
    return matches(row, filters, query) && (!hasTargetConditions(targets) || referencesReady && !!ref && targetMatches(ref, targets))
  })
  const candidates = referencesReady ? referenceCandidates(references, allRecords, filters, targets, query) : []
  const visibleSpecies = new Set([...rows.map(r => r.record.species_id), ...candidates.map(r => r.id)])
  const denominator = referencesReady ? references.filter(r => r.active === true).length : 0
  const numerator = referencesReady ? references.filter(r => visibleSpecies.has(r.id) && r.active === true && r.capture_history === 'not_captured' && r.permission === 'permitted' && r.reference.protected === false).length : 0
  const surveyIds = new Set(rows.map(row => row.survey.id))
  const emptySurveys = hasTargetConditions(targets) ? [] : surveys.filter(s => emptySurveyMatches(s, filters, query))
  const filtered = surveys.filter(s => surveyIds.has(s.id) || emptySurveys.includes(s))
  const selected = filtered.find(s => s.id === selectedId)
  const pins: MapPin[] = [
    ...rows.flatMap(({ survey, record: r }) => r.effective_latitude !== null && r.effective_longitude !== null ? [{ id: `record-${r.id}`, surveyId: survey.id, latitude: r.effective_latitude, longitude: r.effective_longitude, label: `${r.effective_date} · ${r.species_name || '동정 미확정'} · ${RESULT[r.result]}` }] : []),
    ...emptySurveys.flatMap(s => s.latitude !== null && s.longitude !== null ? [{ id: `survey-${s.id}`, surveyId: s.id, latitude: s.latitude, longitude: s.longitude, label: `${s.survey_date} · ${s.place_name || '조사 위치'} · 종별 기록 없음` }] : []),
  ]
  function selectSurvey(s: Survey, recordId?: number) {
    setSelectedId(s.id); setSelectedRecord(recordId ?? null)
    const point = recordId ? pins.find(p => p.id === `record-${recordId}`) : pins.find(p => p.surveyId === s.id)
    setMapFocus(point || null)
  }
  function referenceUpdated(id: number, hostPlants: string) {
    setSpecies(current => current.map(s => s.id === id ? { ...s, host_plants: hostPlants } : s))
    refreshReferences()
  }
  function refreshReferences() {
    setReferences([]); setReferenceError(''); setReferenceLoading(true); setReferenceRevision(n => n + 1)
  }
  function changeTargets(next: typeof targets) {
    if (next.on !== targets.on || next.region !== targets.region) { setReferences([]); setReferenceError(''); setReferenceLoading(true) }
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
  const form = formOpen && <SurveyForm tagOptions={tags} onTagCreated={rememberTag} tagsError={tagsError} onRetryTags={() => void refreshTags()} key={editing ? `edit-${editing.id}-${editing.updated_at}` : 'new'} initial={editing} species={species} onCancel={() => { setCreating(false); setEditing(undefined) }} onSaved={saved => {
    setSurveys(current => [saved, ...current.filter(item => item.id !== saved.id)].sort((a, b) => b.survey_date.localeCompare(a.survey_date) || b.id - a.id))
    setSelectedId(saved.id); refreshReferences(); void refreshTags(); setTargets(emptyTargets()); setMapFocus(saved.latitude !== null && saved.longitude !== null ? { latitude: saved.latitude, longitude: saved.longitude } : null)
    setCreating(false); setEditing(undefined); setQuery(''); setFilters(emptyFilters()); void refreshWeather(); setNotice(editing ? '수정을 저장했습니다. 기존 기상자료는 보존했습니다.' : '조사를 저장했습니다. 상세 화면에서 기상자료를 연결할 수 있습니다.')
  }} />
  return <div className="app-shell">
    <div className="workspace">
      <aside className="sidebar">
        <header className="app-header"><span className="eyebrow">BUTTERFLY ARCHIVE</span><h1>나비 관찰 기록</h1></header>
        <div className="sidebar-scroll">
        <div className="sidebar-tools"><label className="sidebar-search"><span className="sr-only">{mode === 'info' ? '나비 검색' : '기록 검색'}</span><input type="search" disabled={referenceEditing || formOpen} placeholder={mode === 'info' ? '국명·학명 검색' : '기록 검색'} value={mode === 'info' ? infoQuery : query} onChange={e => mode === 'info' ? setInfoQuery(e.target.value) : setQuery(e.target.value)} /></label><button className="icon-button has-tooltip" aria-label="새로고침" data-tooltip="새로고침" disabled={loading || formOpen || referenceEditing} onClick={() => { setLoading(true); void load() }}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 7V3m0 4h-4m4 0a8 8 0 1 0 1 8" /></svg></button><button className="icon-button has-tooltip" aria-label={mode === 'info' ? '나비 등록 열기' : '새 조사'} data-tooltip={mode === 'info' ? '나비 등록' : '새 조사'} disabled={referenceEditing || formOpen || loading || (mode === 'records' && !!error)} onClick={() => { if (mode === 'info') { setRegisterOpen(true); requestAnimationFrame(() => document.getElementById('catalog-new-name')?.focus()) } else { setCreating(true); setNotice('') } }}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 4v16M4 12h16" /></svg></button></div>
        <div className="sidebar-card">
        <div ref={setInfoSidebar} hidden={mode !== 'info'} />
        <div hidden={mode !== 'records'}>
        <SearchFilters tags={tags} tagsError={tagsError} retryTags={() => void refreshTags()} value={filters} onChange={setFilters} species={species} disabled={referenceEditing || formOpen} reset={() => setQuery('')} expanded={tab === 'table'} targets={targets} onTargets={changeTargets} />
        <p className="hint">종별 기록 {rows.length}건 · 좌표 있음 {rows.filter(r => r.record.effective_latitude !== null).length}건 · 좌표 없음 {rows.filter(r => r.record.effective_latitude === null).length}건</p>
        <div className="toolbar"><h2>조사 목록</h2><small>{filtered.length}건</small></div>
        {loading && <p role="status">목록을 불러오는 중입니다.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {!loading && !error && filtered.length === 0 && <p className="empty">{surveys.length ? '검색 결과가 없습니다.' : '첫 조사를 등록해 주세요.'}</p>}
        <nav aria-label="조사 목록" className="survey-list">{filtered.map(s => <button key={s.id} disabled={referenceEditing || formOpen} className={s.id === selectedId ? 'selected' : ''} onClick={() => selectSurvey(s)}>
          <strong>{s.place_name || '좌표 지정 장소'}</strong><span>{s.survey_date} · 종별 기록 {s.observations.length}건</span>
        </button>)}</nav></div>
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
        {tab === 'map' && selected && <Detail key={`${selected.id}-${selected.updated_at}`} survey={selected} selectedRecord={selectedRecord} onWeatherChanged={() => void refreshWeather()} onEdit={() => { setEditing(selected); setNotice('') }} />}
        </div>
        </div>
        <nav className="tabs" aria-label="화면 선택"><button disabled={referenceEditing || formOpen} aria-pressed={tab === 'map' && mode === 'records'} onClick={() => { setMode('records'); setTab('map'); setMapVisited(true) }}>지도</button><button disabled={referenceEditing || formOpen} aria-pressed={tab === 'table' && mode !== 'info'} onClick={() => { setMode('records'); setTab('table') }}>표</button><button disabled={referenceEditing || formOpen} aria-pressed={mode === 'info'} onClick={() => { setMode('info'); setTab('table') }}>나비 도감</button></nav>
      </aside>
      <div className="main-shell">
      <main className={`main-pane${tab === 'map' && mode === 'records' ? ' map-pane' : mode === 'info' ? ' catalog-pane' : ' record-pane'}`}>
        {notice && mode === 'records' && <p role="status" className="notice">{notice}</p>}
        {mode === 'info' && <ButterflyInfo species={species} onCreated={s => { setSpecies(current => [...current, s]); setInfoQuery(''); refreshReferences() }} onUpdated={s => referenceUpdated(s.id, s.host_plants)} onEditing={setReferenceEditing} sidebar={infoSidebar} query={infoQuery} revision={referenceRevision} surveys={surveys} registerOpen={registerOpen} onRegisterOpen={setRegisterOpen} />}
        {mapVisited && <div className="map-workspace" hidden={tab !== 'map' || mode !== 'records'}><MapView shown={tab === 'map' && mode === 'records'} pins={pins} focus={mapFocus} onSelect={pin => { setSelectedId(pin.surveyId); setSelectedRecord(pin.id.startsWith('record-') ? Number(pin.id.slice(7)) : null); setMapFocus(pin) }} />
          {selected && !pins.some(p => p.surveyId === selected.id) && <p>선택한 기록에는 좌표가 없습니다. 지도에 임의 위치를 표시하지 않습니다.</p>}
          {!pins.length && <p className="hint">현재 검색 결과에 지도에 표시할 좌표가 없습니다.</p>}</div>}
        {mode === 'records' && tab === 'table' && <>
          <div className="catalog-toolbar"><h2>관찰 기록표</h2></div>
          {referencesReady && <div className="record-ratio" aria-label="미채집·채집 가능 확인 종 비율">{denominator > 0 && <>조건에 맞는 미채집·채집 가능 확인 종 {numerator} / 현재 출현 참고 종 {denominator} · {(numerator / denominator * 100).toFixed(1)}%</>}</div>}
          {referenceLoading && <p role="status">종 참고자료를 읽는 중입니다.</p>}
          {referenceError && <p role="alert" className="error">{referenceError}<button disabled={referenceEditing || formOpen} onClick={refreshReferences}>참고자료 다시 읽기</button></p>}
          <RecordTable rows={rows} surveys={filtered} references={referenceMap} candidates={candidates} ranks={ranks} onSelect={selectSurvey} selectedId={selectedId} />
          {selected && <Detail key={`${selected.id}-${selected.updated_at}`} survey={selected} selectedRecord={selectedRecord} onWeatherChanged={() => void refreshWeather()} onEdit={() => { setEditing(selected); setNotice('') }} />}
        </>}
      </main>
      <footer className="workspace-status"><span>개인 기록 · 로컬 저장</span><span>기상은 저장 후 재사용 · 자동 갱신 없음</span>{tab === 'map' && mode === 'records' && <span>네이버 지도 · 위치 조회는 외부 연결을 사용합니다.</span>}</footer>
      </div>
    </div>
    {form}
  </div>
}
