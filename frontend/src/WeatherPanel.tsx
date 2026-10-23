// 저장한 기상만 자동으로 읽고 외부 조회와 재조회는 버튼으로만 실행합니다.
import { useEffect, useState } from 'react'
import { findStations, getWeather, queryWeather } from './api'
import type { SavedWeather, Station } from './models'

function displayTime(value: string) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}${value.length > 8 ? ` ${value.slice(8, 10)}:${value.slice(10, 12)} KST` : ' 일자료'}`
}
export default function WeatherPanel({ targetType, targetId }: { targetType: 'survey' | 'observation'; targetId: number }) {
  const [data, setData] = useState<SavedWeather | null>(null)
  const [stations, setStations] = useState<Station[]>([])
  const [station, setStation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    getWeather(targetType, targetId).then(value => { if (active) setData(value) }).catch(e => { if (active) setError(e instanceof Error ? e.message : '저장된 기상을 읽지 못했습니다.') })
    return () => { active = false }
  }, [targetType, targetId])
  async function candidates() {
    setBusy(true); setError('')
    try { setStations(await findStations(targetType, targetId)); setStation('') }
    catch (e) { setError(e instanceof Error ? e.message : '관측소를 조회하지 못했습니다.') }
    finally { setBusy(false) }
  }
  async function fetchWeather(refresh = false) {
    const id = refresh ? data?.weather?.station.id : Number(station)
    if (!id || (refresh && !window.confirm('기상청에 다시 조회하여 이 기록의 연결을 변경하시겠습니까? 실패하면 기존 자료를 유지합니다.'))) return
    setBusy(true); setError('')
    try { setData(await queryWeather(targetType, targetId, id, refresh)) }
    catch (e) { setError(e instanceof Error ? e.message : '기상 조회에 실패했습니다.') }
    finally { setBusy(false) }
  }
  const saved = data?.weather
  return <details className="weather-panel"><summary>기상 · {saved ? '저장된 자료' : '미연결'}</summary>
    <p className="hint">관측소의 기상자료이며 현장 실측값은 아닙니다. 한 번 저장한 값은 자동 갱신하지 않습니다.</p>
    {data && <p>연결 기준: {displayTime(data.context.target_time)}{data.context.time && ` · 관찰 ${data.context.time}`}</p>}
    {saved && <>
      {saved.stale && <p className="error">기록 조건이 달라졌습니다. 아래는 이전 조건으로 저장한 자료입니다.</p>}
      <p><strong>{saved.station.name} 관측소 ({saved.station.id})</strong>{saved.distance_km !== null ? ` · 직선거리 ${saved.distance_km} km` : ' · 기록 좌표가 없어 거리 미상'}</p>
      <p>{displayTime(saved.target_time)}</p>
      <dl>{saved.values.map(v => <div className="weather-value" key={v.code}><dt>{v.label}</dt><dd>{v.value === null ? '자료 없음' : `${v.value} ${v.unit}`}</dd></div>)}</dl>
      <p className="hint">출처: <a href="https://apihub.kma.go.kr/" target="_blank" rel="noreferrer">{saved.source}</a> · 조회 {new Date(saved.fetched_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
      <button type="button" disabled={busy} onClick={() => void fetchWeather(true)}>기상자료 다시 조회</button>
    </>}
    <button type="button" disabled={busy || !data} onClick={() => void candidates()}>관측소 찾기</button>
    {stations.length > 0 && <>
      <label>관측소 선택<select disabled={busy} value={station} onChange={e => setStation(e.target.value)}><option value="">관측소를 선택해 주세요</option>{stations.map(s => <option key={s.id} value={s.id}>{s.name} ({s.id}){s.distance_km !== null ? ` · ${s.distance_km} km` : ''}</option>)}</select></label>
      <p className="hint">해당 시점에 존재하는 관측소 목록입니다. 거리만으로 현장 날씨를 확정할 수 없으며 실제 자료는 누락될 수 있습니다.</p>
      <button type="button" disabled={busy || !station} onClick={() => void fetchWeather()}>기상 조회하여 저장</button>
    </>}
    {busy && <p role="status">기상자료를 확인하는 중입니다.</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </details>
}
