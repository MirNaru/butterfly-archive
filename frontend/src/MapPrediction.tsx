/* 지도에서 선택한 좌표의 입력과 상대 적합도를 표시합니다. */
import { useEffect, useRef, useState } from 'react'
import { listSpecies, predictButterfly } from './api'
import type { Coordinate, Species } from './models'
import type { Prediction } from './api'

function points(value: number | null | undefined, scale = 100) {
  return value == null ? '자료 부족' : `${(value * scale).toFixed(1)}점`
}

function distance(value: number) {
  return value > 0 && value < 0.1 ? '0.1km 미만' : `${value.toFixed(1)}km`
}

export default function MapPrediction({ point, close }: { point: Coordinate & { x: number; y: number }; close: () => void }) {
  const [species, setSpecies] = useState<Species[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Species | null>(null)
  const [result, setResult] = useState<Prediction | null>(null)
  const [busy, setBusy] = useState(false)
  const activeRequest = useRef<AbortController | null>(null)
  useEffect(() => () => activeRequest.current?.abort(), [])
  function clearPrediction() {
    activeRequest.current?.abort()
    activeRequest.current = null
    setBusy(false)
    setError('')
    setResult(null)
  }

  const [error, setError] = useState('')
  useEffect(() => { listSpecies().then(setSpecies).catch(e => setError(e.message)) }, [])
  const matches = query.trim() && !selected ? species.filter(item =>
    [item.korean_name,item.scientific_name].some(name => name?.toLowerCase().includes(query.trim().toLowerCase()))).slice(0,8) : []
  return <div className="map-prediction" style={{ left: point.x, top: point.y }}>
    <form onSubmit={async e => {
      e.preventDefault()
      if (!selected) return
      const data = new FormData(e.currentTarget)
      clearPrediction()
      const request = new AbortController()
      activeRequest.current = request
      setBusy(true)
      try {
        const prediction = await predictButterfly(selected.id, point, String(data.get('date')), request.signal)
        if (!request.signal.aborted) setResult(prediction)
      } catch (e) {
        if (!request.signal.aborted) setError(e instanceof Error ? e.message : '예측을 불러오지 못했습니다.')
      } finally {
        if (activeRequest.current === request) {
          activeRequest.current = null
          setBusy(false)
        }
      }
    }}>
      <div className="map-prediction-title"><strong>어른벌레 출현 예측</strong><button type="button" aria-label="예측 창 닫기" onClick={close}>×</button></div>
      <label>종 검색<input type="search" value={query} onChange={e => {setQuery(e.target.value);setSelected(null);clearPrediction()}} /></label>
      {matches && matches.map(item => <button key={item.id} type="button" onClick={() => {setSelected(item);setQuery(item.korean_name)}}>{item.korean_name}</button>)}
      <label>날짜<input type="date" name="date" onChange={clearPrediction} required /></label>
      <button disabled={!selected || busy}>{busy ? '계산 중' : '예측'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
    {result && <section aria-label="예측 결과"><strong>상대 출현 적합도</strong>
      <p>{result.date} 상세</p>
      {([['종합 적합도',result.occurrence_score,1],['시기 적합도',result.temporal_score,100],
         ['공간 적합도',result.habitat_score,100],['기상 적합도',result.weather_score,100]] as const).map(([label,value,scale]) =>
        <div key={label}><span>{label} · {points(value, scale)}</span>
          {value !== null && <meter aria-label={label} min={0} max={100} value={value*scale} />}</div>)}
      <small>관찰 {result.sample_count}건 · {result.year_count}개 연도</small>
      {result.located_case_count !== undefined && <details open>
        <summary>공간 점수의 근거</summary>
        <p>도감 분포 · {points(result.guide_distribution_score)}<br />
          {result.guide_distance_km === 0 ? '선택 지점이 도감 분포 안에 있음'
            : result.guide_distance_km != null ? `가장 가까운 분포까지 ${distance(result.guide_distance_km)}`
              : '도감 분포 지역 자료 없음'}</p>
        <p>실제 관찰 · {points(result.observation_location_score)}<br />
          위치 근거가 있는 사례 {result.located_case_count}건
          {result.observation_distance_km != null && ` · 가장 가까운 관찰점까지 ${distance(result.observation_distance_km)}`}</p>
        <small>공간 적합도에는 두 점수 중 높은 값을 사용합니다.</small>
      </details>}
      <p>시기 계산 · {result.gdd_applied ? '날짜 KDE + GDD' : '날짜 KDE'}</p>
      <p>기온 {result.temperature_c == null ? '자료 없음' : `${result.temperature_c.toFixed(1)}°C`}
        {' · '}강수량 {result.rain_mm == null ? '자료 없음' : `${result.rain_mm.toFixed(1)}mm`}
        {' · '}풍속 {result.wind_m_s == null ? '자료 없음' : `${result.wind_m_s.toFixed(1)}m/s`}</p>
      {result.weather_source && <p>기상 출처 · {result.weather_source}</p>}
      {result.warnings.map(warning => <p key={warning}>{warning}</p>)}
    </section>}
  </div>
}
