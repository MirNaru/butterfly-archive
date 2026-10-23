// 지도 객체를 탭 전환 시 유지하고 좌표별 마커를 필요한 만큼만 갱신합니다.
import { useEffect, useRef, useState } from 'react'
import { mapPermit } from './api'
import { loadMaps, onMapAuthFailure } from './naverMaps'
import type { NaverMap, NaverMarker, NaverMaps } from './naverMaps'
import type { Coordinate, MapPin } from './models'

export default function MapView({ shown, pins, focus, onSelect, onPick }: {
  shown: boolean; pins: MapPin[]; focus?: Coordinate | null
  onSelect?: (pin: MapPin) => void; onPick?: (point: Coordinate) => void
}) {
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<NaverMap | null>(null)
  const sdk = useRef<NaverMaps | null>(null)
  const started = useRef<Promise<void> | null>(null)
  const latest = useRef({ pins, onSelect, onPick, focus })
  useEffect(() => { latest.current = { pins, onSelect, onPick, focus } }, [pins, onSelect, onPick, focus])
  const markers = useRef(new Map<string, NaverMarker>())
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (!shown || map.current) return
    let active = true
    if (!started.current) started.current = mapPermit().then(p => loadMaps(p.client_id)).then(api => { sdk.current = api })
    started.current.then(() => {
      if (!active || !element.current || map.current || !sdk.current) return
      const api = sdk.current
      const center = latest.current.focus || { latitude: 36.5, longitude: 127.8 }
      map.current = new api.Map(element.current, { center: new api.LatLng(center.latitude, center.longitude), zoom: latest.current.focus ? 13 : 7 })
      api.Event.addListener(map.current, 'click', e => latest.current.onPick?.({ latitude: e.coord.lat(), longitude: e.coord.lng() }))
      setReady(true)
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '지도를 표시하지 못했습니다.') })
    return () => { active = false }
  }, [shown])
  useEffect(() => onMapAuthFailure(() => setError('지도 인증에 실패했습니다. 등록 URL·키·한도를 확인해 주세요.')), [])
  useEffect(() => {
    if (!ready || !map.current || !sdk.current) return
    const api = sdk.current
    const groups = new Map<string, MapPin[]>()
    for (const pin of pins) {
      const key = `${pin.latitude},${pin.longitude}`
      groups.set(key, [...(groups.get(key) || []), pin])
    }
    for (const [key, marker] of markers.current) if (!groups.has(key)) {
      marker.setMap(null); api.Event.clearInstanceListeners(marker); markers.current.delete(key)
    }
    for (const [key, values] of groups) if (!markers.current.has(key)) {
      const marker = new api.Marker({ map: hidden ? null : map.current, position: new api.LatLng(values[0].latitude, values[0].longitude), title: '기록 위치 선택' })
      api.Event.addListener(marker, 'click', () => {
        setGroup(key)
        const first = latest.current.pins.find(p => `${p.latitude},${p.longitude}` === key)
        if (first) latest.current.onSelect?.(first)
      })
      markers.current.set(key, marker)
    }
    for (const marker of markers.current.values()) marker.setMap(hidden ? null : map.current)
  }, [pins, hidden, ready])
  const latitude = focus?.latitude
  const longitude = focus?.longitude
  useEffect(() => {
    if (ready && shown && latitude != null && longitude != null && map.current && sdk.current) map.current.setCenter(new sdk.current.LatLng(latitude, longitude))
  }, [latitude, longitude, shown, ready])
  useEffect(() => {
    if (!ready || !element.current?.parentElement || !map.current) return
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (width && height) map.current?.setSize({ width, height })
    })
    observer.observe(element.current.parentElement)
    return () => observer.disconnect()
  }, [ready])
  useEffect(() => () => {
    for (const marker of markers.current.values()) { marker.setMap(null); sdk.current?.Event.clearInstanceListeners(marker) }
    markers.current.clear()
    if (map.current) sdk.current?.Event.clearInstanceListeners(map.current)
  }, [])
  const grouped = hidden ? [] : pins.filter(p => `${p.latitude},${p.longitude}` === group)
  return <section className="map-view">
    <div className="toolbar"><span>네이버 지도 · 위치 조회는 외부 연결을 사용합니다.</span><button type="button" aria-pressed={hidden} onClick={() => setHidden(v => !v)}>{hidden ? '핀 표시' : '핀 숨기기'}</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    {!ready && !error && shown && <p role="status">지도를 불러오는 중입니다.</p>}
    <div className="map-frame"><div className="map-canvas" ref={element} aria-label="네이버 지도" /></div>
    {grouped.length > 0 && <div className="map-records"><strong>이 위치의 기록 {grouped.length}건</strong>{grouped.map(pin => <button type="button" key={pin.id} onClick={() => onSelect?.(pin)}>{pin.label}</button>)}</div>}
  </section>
}
