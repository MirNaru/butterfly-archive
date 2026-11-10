// 지도 객체를 탭 전환 시 유지하고 좌표별 마커를 필요한 만큼만 갱신합니다.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { mapPermit } from './api'
import { loadMaps, onMapAuthFailure } from './naverMaps'
import type { NaverMap, NaverMarker, NaverMaps } from './naverMaps'
import type { Coordinate, MapPin, SpeciesReference } from './models'
import { PIN_STYLE, pinAppearance, directPinsFirst, clusterAppearance } from './mapPinStyle'
import { buildPinIndex, clusterZoom, markerBounds, locationKey } from './mapClusters'
import type { DisplayPin } from './mapClusters'
import type { PinSource } from './models'

import { boundaryLevel, loadBoundaries, paddedBounds, RegionLayer, visibleParts } from './regionLayer'
import type { BoundaryData, Bounds } from './regionLayer'

// 현재 약 6천 위치의 필터 왕복을 보관하되, 숨긴 핀은 이 수를 넘기지 않습니다.
const MAX_HIDDEN_MARKERS = 8000
export default function MapView({ shown, pins, focus, onSelect, onOpen, onPick, distribution, infoContainer }: {
  infoContainer?: HTMLElement | null
  distribution?:{name:string;reference:SpeciesReference}|null
  shown: boolean; pins: MapPin[]; focus?: Coordinate | null
  onOpen?: (pin: MapPin) => void; onSelect?: (pin: MapPin) => void; onPick?: (point: Coordinate) => void
}) {
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<NaverMap | null>(null)
  const sdk = useRef<NaverMaps | null>(null)
  const started = useRef<Promise<void> | null>(null)
  const latest = useRef({ pins, onSelect, onPick, focus })
  useEffect(() => { latest.current = { pins, onSelect, onPick, focus } }, [pins, onSelect, onPick, focus])
  const markers = useRef(new Map<string, NaverMarker>())
  const appearances = useRef(new Map<string, string>())
  const attached = useRef(new Set<string>())
  const hiddenMarkers = useRef(new Map<string, true>())
  const pinIndex = useRef<{pins: MapPin[]; index: ReturnType<typeof buildPinIndex>; generation: number} | null>(null)
  const targets = useRef(new Map<string, DisplayPin>())
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [hidden, setHidden] = useState(true)
  const [satellite, setSatellite] = useState(false)
  const [regionsOn,setRegionsOn]=useState(false)
  const [boundaryData,setBoundaryData]=useState<BoundaryData|null>(null)
  const layer=useRef<RegionLayer|null>(null)
  const distributionRef=useRef(distribution)
  useEffect(()=>{distributionRef.current=distribution},[distribution])
  const [viewport,setViewport]=useState<{zoom:number;bounds:Bounds;width:number}|null>(null)
  const [boundaryError,setBoundaryError]=useState('')
  const [regionInfo,setRegionInfo]=useState<{name:string;species:string;details:string[]}|null>(null)
  const [regionRetry,setRegionRetry]=useState(0)
  const [mapRetry, setMapRetry] = useState(0)
  const selectedRegionCodes=distribution?.reference.region_codes?.join(',')||''
  const confirmedCodes=(distribution?.reference.region_evidence||[]).filter(e=>e.origin==='observation').map(e=>e.code).sort().join(',')
  const level=boundaryLevel(viewport?.zoom??7)
  useEffect(()=>{
    if(!ready||!map.current||!sdk.current)return
    const currentMap=map.current,api=sdk.current
    layer.current=new RegionLayer(currentMap,api,f=>{
      const current=distributionRef.current
      if(!current?.reference.region_codes?.includes(f.properties.code))return
      const evidence=(current.reference.region_evidence||[]).filter(e=>e.code===f.properties.code)
      setRegionInfo({name:f.properties.label,species:current.name,details:[...(f.properties.detail?[f.properties.detail]:[]),...evidence.map(e=>`${({excel:'엑셀',manual:'사용자 지정',observation:'관찰 확인'})[e.origin]} · ${e.detail}`)]})
    })
    const update=()=>{
      const bounds=currentMap.getBounds(),sw=bounds.getSW(),ne=bounds.getNE()
      const next={zoom:currentMap.getZoom(),bounds:[sw.lng(),sw.lat(),ne.lng(),ne.lat()] as Bounds,width:currentMap.getSize().width}
      setViewport(old=>old&&old.zoom===next.zoom&&old.width===next.width&&old.bounds.every((v,i)=>Math.abs(v-next.bounds[i])<0.000001)?old:next)
    }
    const idle=api.Event.addListener(currentMap,'idle',update)
    const size=api.Event.addListener(currentMap,'size_changed',update)
    update()
    return()=>{api.Event.removeListener(idle);api.Event.removeListener(size);layer.current?.dispose();layer.current=null}
  },[ready])
  useEffect(()=>{
    if(!shown||!regionsOn||!selectedRegionCodes)return
    let active=true
    loadBoundaries(level).then(data=>{if(active){setBoundaryData(data);setBoundaryError('')}}).catch(e=>{if(active)setBoundaryError(e.message)})
    return()=>{active=false}
  },[shown,regionsOn,selectedRegionCodes,level,regionRetry])
  useEffect(()=>{
    if(!layer.current)return
    const parts=shown&&regionsOn&&boundaryData&&viewport?visibleParts(boundaryData,new Set(selectedRegionCodes.split(',')),new Set(confirmedCodes.split(',')),paddedBounds(viewport.bounds)):[]
    layer.current.update(parts)
    return()=>layer.current?.cancel()
  },[ready,shown,regionsOn,boundaryData,selectedRegionCodes,confirmedCodes,viewport])
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
    }).catch(e => { if (active) { started.current = null; setError(e instanceof Error ? e.message : '지도를 표시하지 못했습니다.') } })
    return () => { active = false }
  }, [shown, mapRetry])
  useEffect(() => onMapAuthFailure(() => setError('지도 인증에 실패했습니다. 등록 URL·키·한도를 확인해 주세요.')), [])
  useEffect(() => {
    if (ready && map.current && sdk.current) {
      map.current.setMapTypeId(satellite ? sdk.current.MapTypeId.SATELLITE : sdk.current.MapTypeId.NORMAL)
    }
  }, [ready, satellite])
  useEffect(() => {
    if (!shown || !ready || !map.current || !sdk.current) return
    const api = sdk.current
    const detach = (key: string) => {
      if (!attached.current.delete(key)) return
      markers.current.get(key)!.setMap(null)
      hiddenMarkers.current.set(key, true)
    }
    const trimHidden = () => {
      for (const key of hiddenMarkers.current.keys()) {
        if (hiddenMarkers.current.size <= MAX_HIDDEN_MARKERS) break
        api.Event.clearInstanceListeners(markers.current.get(key)!)
        markers.current.delete(key)
        appearances.current.delete(key)
        hiddenMarkers.current.delete(key)
      }
    }
    if (hidden) {
      for (const key of attached.current) detach(key)
      targets.current.clear()
      trimHidden()
      return
    }
    if (!viewport) return
    if (pinIndex.current?.pins !== pins) {
      const generation = (pinIndex.current?.generation || 0) + 1
      pinIndex.current = {pins, index: buildPinIndex(pins), generation}
      // 통합 번호는 인덱스 안에서만 유효하므로 이전 통합 객체·클릭 연결은 폐기합니다.
      for (const key of markers.current.keys()) if (key.startsWith('c:')) {
        detach(key)
        api.Event.clearInstanceListeners(markers.current.get(key)!)
        markers.current.delete(key); appearances.current.delete(key); hiddenMarkers.current.delete(key)
      }
    }
    const zoom = clusterZoom(viewport.bounds, viewport.width)
    const groups = new Map(pinIndex.current.index.query(markerBounds(viewport.bounds), zoom, pinIndex.current.generation).map(item => [item.key, item]))
    targets.current = groups
    for (const key of attached.current) if (!groups.has(key)) detach(key)
    for (const [key, item] of groups) {
      const isCluster = item.expansionZoom !== undefined
      const isGroup = isCluster || item.count > 1
      const appearance = isGroup ? clusterAppearance(item.count, item.locations, item.sources, item.surveyCount, item.directSurveyCount, isCluster) : pinAppearance((Object.keys(PIN_STYLE) as PinSource[]).filter(source => item.sources[source] > 0))
      const anchor = isGroup ? new api.Point(22, 29) : new api.Point(17, 17)
      hiddenMarkers.current.delete(key)
      if (markers.current.has(key)) {
        if (appearances.current.get(key) !== appearance.signature) {
          markers.current.get(key)!.setIcon({content: appearance.content, anchor})
          markers.current.get(key)!.setTitle(appearance.title)
          markers.current.get(key)!.setZIndex(appearance.zIndex)
          appearances.current.set(key, appearance.signature)
        }
        if (!attached.current.has(key)) {
          markers.current.get(key)!.setMap(map.current)
          attached.current.add(key)
        }
        continue
      }
      const marker = new api.Marker({ map: map.current, position: new api.LatLng(item.latitude, item.longitude), title: appearance.title, zIndex: appearance.zIndex, icon: {content: appearance.content, anchor} })
      api.Event.addListener(marker, 'click', () => {
        const target = targets.current.get(key)
        if (!target || !map.current) return
        if (target.expansionZoom !== undefined) {
          setGroup(null)
          const bounds = map.current.getBounds(), sw = bounds.getSW(), ne = bounds.getNE()
          const currentZoom = clusterZoom([sw.lng(), sw.lat(), ne.lng(), ne.lat()], map.current.getSize().width)
          map.current.updateBy(new api.LatLng(target.latitude, target.longitude), Math.min(21, map.current.getZoom() + Math.max(1, target.expansionZoom - currentZoom)))
          return
        }
        setGroup(target.locationKey!)
        const first = directPinsFirst(latest.current.pins.filter(p => locationKey(p) === target.locationKey))[0]
        if (first) latest.current.onSelect?.(first)
      })
      markers.current.set(key, marker)
      appearances.current.set(key, appearance.signature)
      attached.current.add(key)
    }
    trimHidden()
  }, [pins, hidden, ready, shown, viewport])
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
    for (const [key, marker] of markers.current) {
      if (attached.current.has(key)) marker.setMap(null)
      sdk.current?.Event.clearInstanceListeners(marker)
    }
    markers.current.clear()
    appearances.current.clear()
    attached.current.clear()
    hiddenMarkers.current.clear()
    targets.current.clear()
    pinIndex.current = null
    if (map.current) sdk.current?.Event.clearInstanceListeners(map.current)
  }, [])
  const grouped = hidden ? [] : directPinsFirst(pins.filter(p => `${p.latitude},${p.longitude}` === group))
  return <section className="map-view">
    <div className="toolbar"><h2 className="map-title">지도</h2><div className="map-actions">
      {distribution!==undefined&&<button type="button" aria-pressed={regionsOn} onClick={()=>{setRegionsOn(v=>!v);setRegionInfo(null)}}>{regionsOn?'출현지역 숨기기':'출현지역 보기'}</button>}
      <button type="button" aria-pressed={hidden} onClick={() => setHidden(v => !v)}>{hidden ? '핀 표시' : '핀 숨기기'}</button>
      <div className="map-types" role="group" aria-label="지도 종류">
        <button type="button" disabled={!ready || !!error} aria-pressed={!satellite} onClick={() => setSatellite(false)}>일반지도</button>
        <button type="button" disabled={!ready || !!error} aria-pressed={satellite} onClick={() => setSatellite(true)}>위성지도</button>
      </div>
    </div></div>
    {distribution!==undefined&&regionsOn&&infoContainer&&createPortal(<>
      <span>출현지역 · {distribution?.name||'왼쪽에서 한 종을 선택해 주세요'} · 녹색: 엑셀·사용자 지정은 옅게, 관찰 확인 지역은 진하게 표시합니다. 지역 전체의 서식을 뜻하지 않습니다. {distribution&&!selectedRegionCodes&&'등록된 출현지역이 없습니다.'}{selectedRegionCodes.includes('special-hallasan')&&' 한라산: 해발 1,000m 이상 등고선 참고 영역 · Mapzen Terrain Tiles / USGS SRTM. 실제 서식 고도 하한을 뜻하지 않습니다.'}</span>
      {boundaryError&&<span role="alert">{boundaryError}<button type="button" onClick={()=>setRegionRetry(n=>n+1)}>경계 다시 읽기</button></span>}
      {boundaryData&&<span>축척에 따라 표시 경계를 단순화하며 확대하면 세부 섬을 표시합니다. {boundaryData.source} · <a href={boundaryData.source_url} target="_blank" rel="noreferrer">경계 출처</a></span>}
      {regionInfo&&distribution&&regionInfo.species===distribution.name&&<div className="distribution-evidence"><strong>{regionInfo.name}</strong><button type="button" onClick={()=>setRegionInfo(null)}>닫기</button><ul>{regionInfo.details.map((d,i)=><li key={i}>{d}</li>)}</ul></div>}
    </>,infoContainer)}
    {error && <div role="alert" className="error">{error} {!ready && <button type="button" onClick={() => { setError(''); setMapRetry(n => n + 1) }}>지도 다시 불러오기</button>}</div>}
    {!ready && !error && shown && <p role="status">지도를 불러오는 중입니다.</p>}
    <div className="map-frame"><div className="map-canvas" ref={element} aria-label="네이버 지도" /></div>
    {grouped.length > 0 && <div className="map-records"><strong>이 위치의 기록 {grouped.length}건</strong>{grouped.map(pin => <button type="button" key={pin.id} onClick={() => onSelect?.(pin)} onDoubleClick={() => onOpen?.(pin)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();onOpen?.(pin)}}} title="더블클릭하면 기록 탭에서 탐사 상세를 엽니다"><span style={{color:PIN_STYLE[pin.source || 'direct'].color}}>●</span> {PIN_STYLE[pin.source || 'direct'].label} · {pin.label}</button>)}</div>}
  </section>
}
