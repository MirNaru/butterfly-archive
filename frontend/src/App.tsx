// 조사 등록과 지도·표 보기의 선택 상태를 관리합니다.
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { addSpecies, listSpecies, listSurveys, integrationStatus } from './api'
import { CAPTURE, IDENTIFICATION, PURPOSE, RESULT, SEX, STAGE } from './models'
import type { Species, Survey, MapPin, Coordinate, IntegrationStatus } from './models'
import SurveyForm from './SurveyForm'
import MapView from './MapView'
import WeatherPanel from './WeatherPanel'
import './App.css'

function Detail({ survey }: { survey: Survey }) {
  return <article className="detail"><span className="eyebrow">조사 기록 #{survey.id}</span>
    <h2>{survey.place_name || '좌표로 등록한 장소'}</h2>
    <p>{survey.survey_date} · {PURPOSE[survey.purpose]}</p>
    <p className="hint">{survey.latitude === null ? '조사 좌표 미지정' : `위도 ${survey.latitude} · 경도 ${survey.longitude}`}</p>
    {survey.notes && <p className="memo">{survey.notes}</p>}
    <WeatherPanel key={`survey-${survey.id}`} targetType="survey" targetId={survey.id} />
    <h3>종별 기록 {survey.observations.length}건</h3>
    {survey.observations.length === 0 && <p className="empty">종별 기록이 없는 조사입니다. 특정 종의 미발견을 뜻하지 않습니다.</p>}
    {survey.observations.map(record => <section className="observation" key={record.id}>
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
      <WeatherPanel key={`observation-${record.id}`} targetType="observation" targetId={record.id} />
    </section>)}
    <p className="hint">등록 {new Date(survey.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 개인 조사</p>
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
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [speciesBusy, setSpeciesBusy] = useState(false)
  const [speciesError, setSpeciesError] = useState('')
  async function load() {
    try {
      const [nextSpecies, nextSurveys] = await Promise.all([listSpecies(), listSurveys()])
      setSpecies(nextSpecies); setSurveys(nextSurveys); setError('')
    } catch (error) { setError(error instanceof Error ? error.message : '목록을 불러오지 못했습니다.') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let active = true
    Promise.all([listSpecies(), listSurveys()])
      .then(([nextSpecies, nextSurveys]) => {
        if (active) { setSpecies(nextSpecies); setSurveys(nextSurveys); setError('') }
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : '목록을 불러오지 못했습니다.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const filtered = surveys.filter(s => `${s.place_name} ${s.survey_date} ${s.observations.map(o => o.species_name || '동정 미확정').join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = filtered.find(s => s.id === selectedId)
  const pins: MapPin[] = filtered.flatMap(s => {
    const result: MapPin[] = s.latitude !== null && s.longitude !== null ? [{ id: `survey-${s.id}`, surveyId: s.id, latitude: s.latitude, longitude: s.longitude, label: `${s.survey_date} · ${s.place_name || '조사 위치'}` }] : []
    for (const r of s.observations) if (r.effective_latitude !== null && r.effective_longitude !== null) result.push({
      id: `record-${r.id}`, surveyId: s.id, latitude: r.effective_latitude, longitude: r.effective_longitude,
      label: `${r.effective_date} · ${r.species_name || '동정 미확정'} · ${RESULT[r.result]}`,
    })
    return result
  })
  function selectSurvey(s: Survey) {
    setSelectedId(s.id)
    const point = pins.find(p => p.surveyId === s.id)
    setMapFocus(point || null)
  }
  async function showIntegration() {
    try { setIntegration(await integrationStatus()); setIntegrationError('') }
    catch (e) { setIntegrationError(e instanceof Error ? e.message : '연동 상태를 확인하지 못했습니다.') }
  }
  const form = creating && <SurveyForm species={species} onCancel={() => setCreating(false)} onSaved={saved => {
    setSurveys(current => [saved, ...current].sort((a, b) => b.survey_date.localeCompare(a.survey_date) || b.id - a.id))
    setSelectedId(saved.id); setMapFocus(saved.latitude !== null && saved.longitude !== null ? { latitude: saved.latitude, longitude: saved.longitude } : null)
    setCreating(false); setQuery(''); setNotice('조사를 저장했습니다. 상세 화면에서 기상자료를 연결할 수 있습니다.')
  }} />
  async function saveSpecies(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (speciesBusy) return
    const form = event.currentTarget
    const data = new FormData(form)
    setSpeciesBusy(true); setSpeciesError('')
    try {
      const value = await addSpecies(String(data.get('korean_name') || ''), String(data.get('scientific_name') || ''))
      setSpecies(current => [...current, value].sort((a, b) => a.korean_name.localeCompare(b.korean_name)))
      form.reset(); setNotice(`${value.korean_name} 종을 등록했습니다.`)
    } catch (error) { setSpeciesError(error instanceof Error ? error.message : '종 등록에 실패했습니다.') }
    finally { setSpeciesBusy(false) }
  }
  return <div className="app-shell">
    <header className="app-header"><div><span className="eyebrow">BUTTERFLY ARCHIVE</span><h1>나비 관찰 기록</h1></div><span className="local-label">개인 기록 · 로컬 저장</span></header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="toolbar"><h2>조사 목록</h2><button className="primary" disabled={creating || loading || !!error} onClick={() => { setCreating(true); setNotice('') }}>새 조사</button></div>
        <label>기록 검색<input type="search" placeholder="장소, 날짜, 종 이름" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className="toolbar"><small>{filtered.length}건</small><button className="quiet" disabled={loading} onClick={() => { setLoading(true); void load() }}>새로고침</button></div>
        {loading && <p role="status">목록을 불러오는 중입니다.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {!loading && !error && filtered.length === 0 && <p className="empty">{surveys.length ? '검색 결과가 없습니다.' : '첫 조사를 등록해 주세요.'}</p>}
        <nav aria-label="조사 목록" className="survey-list">{filtered.map(s => <button key={s.id} className={s.id === selectedId ? 'selected' : ''} onClick={() => selectSurvey(s)}>
          <strong>{s.place_name || '좌표 지정 장소'}</strong><span>{s.survey_date} · 종별 기록 {s.observations.length}건</span>
        </button>)}</nav>
        <details className="species-editor"><summary>종 수동 등록 · {species.length}개</summary><p className="hint">엑셀 자료는 아직 가져오지 않았습니다. 종을 먼저 등록하거나 동정 미확정으로 관찰을 남길 수 있습니다.</p>
          <form onSubmit={saveSpecies}><fieldset disabled={speciesBusy}><label>국명<input name="korean_name" required maxLength={100} /></label><label>학명 · 선택<input name="scientific_name" maxLength={200} /></label><button type="submit">{speciesBusy ? '저장 중…' : '종 등록'}</button></fieldset>{speciesError && <p role="alert" className="error">{speciesError}</p>}</form>
        </details>
        <details className="integration-status"><summary onClick={() => void showIntegration()}>연동 상태·로컬 사용량</summary>
          <p className="hint">네이버 무료 대표 계정과 콘솔 사용 제한을 유지해야 합니다. 아래 숫자는 이 DB의 호출 시도이며 제공자 전체 사용량과 다를 수 있습니다.</p>
          {integration && <><p>지도 {integration.maps_ready ? '설정됨' : '비활성'} · 기상 {integration.weather_ready ? '설정됨' : '비활성'}</p>{integration.usage.map(u => <p key={u.service}>{({ map: '지도 생성', geocode: '주소 검색', reverse: '좌표 주소 확인', kma: '기상청' })[u.service] || u.service}: 오늘 {u.today}/{u.daily_limit} · 이번 달 {u.month}/{u.monthly_limit}</p>)}</>}
          {integrationError && <p className="error">{integrationError}</p>}
        </details>
        {tab === 'map' && form}
        {tab === 'map' && selected && !creating && <Detail key={selected.id} survey={selected} />}
      </aside>
      <main className="main-pane">
        {notice && <p role="status" className="notice">{notice}</p>}
        {mapVisited && <div hidden={tab !== 'map'}><MapView shown={tab === 'map'} pins={pins} focus={mapFocus} onSelect={pin => { setSelectedId(pin.surveyId); setMapFocus(pin) }} />
          {selected && !pins.some(p => p.surveyId === selected.id) && <p>선택한 기록에는 좌표가 없습니다. 지도에 임의 위치를 표시하지 않습니다.</p>}
          {!pins.length && <p className="hint">현재 검색 결과에 지도에 표시할 좌표가 없습니다.</p>}</div>}
        {tab === 'table' && (creating ? form : <>
          <section><div className="toolbar"><h2>조사 기록표</h2><small>날짜 최신순 · 행을 선택하면 상세 표시</small></div>
            <div className="table-wrap"><table><thead><tr><th>날짜</th><th>장소</th><th>종별 기록</th><th>좌표</th></tr></thead><tbody>{filtered.map(s => <tr key={s.id} className={s.id === selectedId ? 'selected' : ''}><td><button className="link" onClick={() => selectSurvey(s)}>{s.survey_date}</button></td><td>{s.place_name || '좌표 지정 장소'}</td><td>{s.observations.length}</td><td>{s.latitude === null ? '미지정' : `${s.latitude}, ${s.longitude}`}</td></tr>)}</tbody></table></div>
            {!loading && !error && filtered.length === 0 && <p className="empty">표시할 조사 기록이 없습니다.</p>}
          </section>
          {selected ? <Detail key={selected.id} survey={selected} /> : <section className="welcome"><h2>한 번의 조사, 여러 나비의 기록</h2><p>조사 날짜와 장소를 정하고 관찰한 종을 추가해 주세요.<br />찾았지만 발견하지 못한 종도 구분해서 남길 수 있습니다.</p></section>}
        </>)}
      </main>
    </div>
    <footer className="tabs" aria-label="화면 선택"><button disabled={creating} aria-pressed={tab === 'map'} onClick={() => { setTab('map'); setMapVisited(true) }}>지도</button><button disabled={creating} aria-pressed={tab === 'table'} onClick={() => setTab('table')}>표</button><span>기상은 저장 후 재사용 · 자동 갱신 없음</span></footer>
  </div>
}
