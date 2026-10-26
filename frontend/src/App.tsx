// 조사 등록과 지도·표 보기의 선택 상태를 관리합니다.
import { useEffect, useState } from 'react'
import { listSpecies, listSurveys, integrationStatus, recordWeather } from './api'
import { CAPTURE, IDENTIFICATION, PURPOSE, RESULT, SEX, STAGE } from './models'
import type { Species, Survey, MapPin, Coordinate, IntegrationStatus, SavedWeather } from './models'
import SurveyForm from './SurveyForm'
import MapView from './MapView'
import WeatherPanel from './WeatherPanel'
import SearchFilters from './SearchFilters'
import RecordTable from './RecordTable'
import Exploration from './Exploration'
import ButterflyInfo from './ButterflyInfo'
import { emptyFilters, rowsFor, matches, emptySurveyMatches } from './recordSearch'
import './App.css'

function Detail({ survey, onEdit, onWeatherChanged, selectedRecord }: { survey: Survey; onEdit: () => void; onWeatherChanged: () => void; selectedRecord: number | null }) {
  return <article className="detail"><span className="eyebrow">조사 기록 #{survey.id}</span>
    <button type="button" onClick={onEdit}>기록 수정</button><h2>{survey.place_name || '좌표로 등록한 장소'}</h2>
    <p>{survey.survey_date} · {PURPOSE[survey.purpose]}</p>
    <p className="hint">{survey.latitude === null ? '조사 좌표 미지정' : `위도 ${survey.latitude} · 경도 ${survey.longitude}`}</p>
    {survey.notes && <p className="memo">{survey.notes}</p>}
    <WeatherPanel key={`survey-${survey.id}`} targetType="survey" targetId={survey.id} />
    <h3>종별 기록 {survey.observations.length}건</h3>
    {survey.observations.length === 0 && <p className="empty">종별 기록이 없는 조사입니다. 특정 종의 미발견을 뜻하지 않습니다.</p>}
    {survey.observations.map(record => <section className={`observation${selectedRecord === record.id ? ' selected' : ''}`} key={record.id}>
      <div className="record-title"><h3>{record.species_name || '동정 미확정'}</h3><span className={`badge ${record.result}`}>{RESULT[record.result]}</span></div>
      <p>{record.effective_date} · {record.observation_time || '시각 미상'}</p>
      <p>{record.effective_place || '좌표 지정 위치'}{record.effective_latitude !== null && ` · ${record.effective_latitude}, ${record.effective_longitude}`}</p>
      {record.result === 'observed' && <dl>
        <dt>발육 단계 · 성별</dt><dd>{STAGE[record.stage]} · {SEX[record.sex]}</dd>
        <dt>관찰 개체 수</dt><dd>{record.count === null ? '미상' : `${record.count}마리${record.count_estimated ? ' (추정)' : ''}`}</dd>
        <dt>채집</dt><dd>{CAPTURE[record.capture_status]}{record.capture_status === 'captured' && ` · ${record.captured_count === null ? '수량 미상' : `${record.captured_count}마리`}`}</dd>
        <dt>동정 상태</dt><dd>{IDENTIFICATION[record.identification]}</dd>
      </dl>}
      {record.notes && <p className="memo">{record.notes}</p>}
      <WeatherPanel key={`observation-${record.id}`} targetType="observation" targetId={record.id} onChanged={onWeatherChanged} />
    </section>)}
    <p className="hint">등록 {new Date(survey.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 개인 조사</p>
    <p className="hint">최근 수정 {new Date(survey.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
  </article>
}

export default function App() {
  const [species, setSpecies] = useState<Species[]>([])
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
  const [filters, setFilters] = useState(emptyFilters)
  const [weather, setWeather] = useState<Record<number, SavedWeather>>({})
  const [referenceEditing, setReferenceEditing] = useState(false)
  const [explorationSidebar, setExplorationSidebar] = useState<HTMLDivElement | null>(null)
  const [mode, setMode] = useState<'records' | 'exploration' | 'info'>('records')
  const [selectedRecord, setSelectedRecord] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  async function load() {
    try {
      const [nextSpecies, nextSurveys, nextWeather] = await Promise.all([listSpecies(), listSurveys(), recordWeather()])
      setSpecies(nextSpecies); setSurveys(nextSurveys); setWeather(nextWeather); setError('')
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
  const rows = rowsFor(surveys, species, weather).filter(row => matches(row, filters, query))
  const surveyIds = new Set(rows.map(row => row.survey.id))
  const emptySurveys = surveys.filter(s => emptySurveyMatches(s, filters, query))
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
  async function refreshWeather() {
    try { setWeather(await recordWeather()); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : '저장 기상 목록을 읽지 못했습니다.') }
  }
  async function showIntegration() {
    try { setIntegration(await integrationStatus()); setIntegrationError('') }
    catch (e) { setIntegrationError(e instanceof Error ? e.message : '연동 상태를 확인하지 못했습니다.') }
  }
  const form = formOpen && <SurveyForm key={editing ? `edit-${editing.id}-${editing.updated_at}` : 'new'} initial={editing} species={species} onCancel={() => { setCreating(false); setEditing(undefined) }} onSaved={saved => {
    setSurveys(current => [saved, ...current.filter(item => item.id !== saved.id)].sort((a, b) => b.survey_date.localeCompare(a.survey_date) || b.id - a.id))
    setSelectedId(saved.id); setMapFocus(saved.latitude !== null && saved.longitude !== null ? { latitude: saved.latitude, longitude: saved.longitude } : null)
    setCreating(false); setEditing(undefined); setQuery(''); setFilters(emptyFilters()); void refreshWeather(); setNotice(editing ? '수정을 저장했습니다. 기존 기상자료는 보존했습니다.' : '조사를 저장했습니다. 상세 화면에서 기상자료를 연결할 수 있습니다.')
  }} />
  return <div className="app-shell">
    <header className="app-header"><div><span className="eyebrow">BUTTERFLY ARCHIVE</span><h1>나비 관찰 기록</h1></div><span className="local-label">개인 기록 · 로컬 저장</span></header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="toolbar"><h2>조사 목록</h2><button className="primary" disabled={referenceEditing || formOpen || loading || !!error} onClick={() => { setMode('records'); setCreating(true); setNotice('') }}>새 조사</button></div>
        <div className="search-modes"><button disabled={referenceEditing || formOpen} aria-pressed={mode === 'records'} onClick={() => setMode('records')}>관찰 기록 검색</button><button disabled={referenceEditing || formOpen} aria-pressed={mode === 'exploration'} onClick={() => { setMode('exploration'); setTab('table') }}>탐사 대상 찾기</button></div>
        <div ref={setExplorationSidebar} hidden={mode !== 'exploration'} />
        <div hidden={mode !== 'records'}><label>기록 검색<input type="search" disabled={referenceEditing || formOpen} placeholder="국명·학명·장소·날짜·메모" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <SearchFilters value={filters} onChange={setFilters} species={species} disabled={referenceEditing || formOpen} reset={() => setQuery('')} />
        <p className="hint">종별 기록 {rows.length}건 · 좌표 있음 {rows.filter(r => r.record.effective_latitude !== null).length}건 · 좌표 없음 {rows.filter(r => r.record.effective_latitude === null).length}건</p>
        <div className="toolbar"><small>조사 {filtered.length}건</small><button className="quiet" disabled={loading || formOpen} onClick={() => { setLoading(true); void load() }}>새로고침</button></div>
        {loading && <p role="status">목록을 불러오는 중입니다.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {!loading && !error && filtered.length === 0 && <p className="empty">{surveys.length ? '검색 결과가 없습니다.' : '첫 조사를 등록해 주세요.'}</p>}
        <nav aria-label="조사 목록" className="survey-list">{filtered.map(s => <button key={s.id} disabled={referenceEditing || formOpen} className={s.id === selectedId ? 'selected' : ''} onClick={() => selectSurvey(s)}>
          <strong>{s.place_name || '좌표 지정 장소'}</strong><span>{s.survey_date} · 종별 기록 {s.observations.length}건</span>
        </button>)}</nav></div>
        <details className="integration-status"><summary onClick={() => void showIntegration()}>연동 상태·로컬 사용량</summary>
          <p className="hint">네이버 무료 대표 계정과 콘솔 사용 제한을 유지해야 합니다. 아래 숫자는 이 DB의 호출 시도이며 제공자 전체 사용량과 다를 수 있습니다.</p>
          {integration && <><p>지도 {integration.maps_ready ? '설정됨' : '비활성'} · 기상 {integration.weather_ready ? '설정됨' : '비활성'}</p>{integration.usage.map(u => <div key={u.service}>
            <p><strong>{({ map: 'Dynamic Map', geocode: 'Geocoding', reverse: 'Reverse Geocoding', kma: '기상청' })[u.service] || u.service}</strong><br />
              앱 집계: 오늘 {u.today.toLocaleString('ko-KR')}{u.daily_limit !== null && ` / ${u.daily_limit.toLocaleString('ko-KR')}`}회 · 이번 달 {u.month.toLocaleString('ko-KR')}{u.monthly_limit !== null && ` / ${u.monthly_limit.toLocaleString('ko-KR')}`}회<br />
              한도: {u.daily_limit !== null ? `일 ${u.daily_limit.toLocaleString('ko-KR')}회` : `월 ${u.monthly_limit?.toLocaleString('ko-KR')}회`}
            </p>
            {u.reported_count !== null && <p className="hint">사용자 확인: {u.reported_count.toLocaleString('ko-KR')}회 / 월 {u.monthly_limit?.toLocaleString('ko-KR')}회 ({u.reported_date} 기준 · 자동 갱신 아님)</p>}
          </div>)}</>}
          {integrationError && <p className="error">{integrationError}</p>}
        </details>
        {tab === 'map' && selected && <Detail key={`${selected.id}-${selected.updated_at}`} survey={selected} selectedRecord={selectedRecord} onWeatherChanged={() => void refreshWeather()} onEdit={() => { setEditing(selected); setNotice('') }} />}
      </aside>
      <main className={`main-pane${tab === 'map' && mode === 'records' ? ' map-pane' : ''}`}>
        {notice && <p role="status" className="notice">{notice}</p>}
        {mode === 'info' && <ButterflyInfo species={species} onCreated={s => setSpecies(current => [...current, s])} onUpdated={s => setSpecies(current => current.map(item => item.id === s.id ? s : item))} onEditing={setReferenceEditing} />}
        {mode === 'exploration' && <Exploration sidebar={explorationSidebar} onEditing={setReferenceEditing} onUpdated={(id, hostPlants) => setSpecies(current => current.map(item => item.id === id ? { ...item, host_plants: hostPlants } : item))} />}
        {mapVisited && <div className="map-workspace" hidden={tab !== 'map' || mode !== 'records'}><MapView shown={tab === 'map' && mode === 'records'} pins={pins} focus={mapFocus} onSelect={pin => { setSelectedId(pin.surveyId); setSelectedRecord(pin.id.startsWith('record-') ? Number(pin.id.slice(7)) : null); setMapFocus(pin) }} />
          {selected && !pins.some(p => p.surveyId === selected.id) && <p>선택한 기록에는 좌표가 없습니다. 지도에 임의 위치를 표시하지 않습니다.</p>}
          {!pins.length && <p className="hint">현재 검색 결과에 지도에 표시할 좌표가 없습니다.</p>}</div>}
        {mode === 'records' && tab === 'table' && <>
          <RecordTable rows={rows} surveys={filtered} onSelect={selectSurvey} selectedId={selectedId} />
          {selected ? <Detail key={`${selected.id}-${selected.updated_at}`} survey={selected} selectedRecord={selectedRecord} onWeatherChanged={() => void refreshWeather()} onEdit={() => { setEditing(selected); setNotice('') }} /> : <section className="welcome"><h2>한 번의 조사, 여러 나비의 기록</h2><p>조사 날짜와 장소를 정하고 관찰한 종을 추가해 주세요.<br />찾았지만 발견하지 못한 종도 구분해서 남길 수 있습니다.</p></section>}
        </>}
      </main>
    </div>
    {form}
    <footer className="tabs" aria-label="화면 선택"><button disabled={referenceEditing || formOpen} aria-pressed={tab === 'map' && mode === 'records'} onClick={() => { setMode('records'); setTab('map'); setMapVisited(true) }}>지도</button><button disabled={referenceEditing || formOpen} aria-pressed={tab === 'table' && mode !== 'info'} onClick={() => { setMode('records'); setTab('table') }}>표</button><button disabled={referenceEditing || formOpen} aria-pressed={mode === 'info'} onClick={() => { setMode('info'); setTab('table') }}>나비 기본 정보</button><span>기상은 저장 후 재사용 · 자동 갱신 없음</span></footer>
  </div>
}
