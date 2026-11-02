// 지도 객체를 탭 전환 시 유지하고 좌표별 마커를 필요한 만큼만 갱신합니다.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { mapPermit } from './api'
import { loadMaps, onMapAuthFailure } from './naverMaps'
import type { NaverMap, NaverMarker, NaverMaps } from './naverMaps'
import type { Coordinate, MapPin, SpeciesReference } from './models'
import { PIN_STYLE, pinAppearance } from './mapPinStyle'

interface BoundaryFeature {properties:{code:string;label:string;detail?:string};bbox:number[];geometry:{type:string;coordinates:number[][][]|number[][][][]}}
let boundaryRequest:Promise<{features:BoundaryFeature[];source:string;source_url:string}>|undefined
export default function MapView({ shown, pins, focus, onSelect, onPick, distribution, infoContainer }: {
  infoContainer?: HTMLElement | null
  distribution?:{name:string;reference:SpeciesReference}|null
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
  const appearances = useRef(new Map<string, string>())
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [satellite, setSatellite] = useState(false)
  const [regionsOn,setRegionsOn]=useState(false)
  const [boundaryData,setBoundaryData]=useState<Awaited<NonNullable<typeof boundaryRequest>>|null>(null)
  const [boundaryError,setBoundaryError]=useState('')
  const [regionInfo,setRegionInfo]=useState<{name:string;species:string;details:string[]}|null>(null)
  const [regionRetry,setRegionRetry]=useState(0)
  const selectedRegionCodes=distribution?.reference.region_codes?.join(',')||''
  useEffect(()=>{
    if(!regionsOn||!distribution)return
    let active=true
    if(!boundaryRequest)boundaryRequest=fetch('/api/regions/boundaries',{signal:AbortSignal.timeout(30000)}).then(async r=>{if(!r.ok)throw new Error('지역 경계를 읽지 못했습니다.');return r.json()}).catch(e=>{boundaryRequest=undefined;throw e})
    boundaryRequest!.then(data=>{if(active){setBoundaryData(data);setBoundaryError('')}}).catch(e=>{if(active)setBoundaryError(e.message)})
    return()=>{active=false}
  },[regionsOn,distribution,regionRetry])
  useEffect(()=>{
    if(!ready||!regionsOn||!boundaryData||!distribution||!map.current||!sdk.current)return
    const api=sdk.current, polygons:{setMap:(map:NaverMap|null)=>void}[]=[], codes=new Set(selectedRegionCodes.split(','))
    for(const f of boundaryData.features) {
      if(!codes.has(f.properties.code)||(f.properties.code.length>2&&codes.has(f.properties.code.slice(0,2))))continue
      const evidence=(distribution.reference.region_evidence||[]).filter(e=>e.code===f.properties.code)
      const confirmed=evidence.some(e=>e.origin==='observation')
      const shapes=f.geometry.type==='Polygon'?[f.geometry.coordinates as number[][][]]:f.geometry.coordinates as number[][][][]
      for(const rings of shapes) {
        const polygon=new api.Polygon({map:map.current,paths:rings.map(r=>r.map(p=>new api.LatLng(p[1],p[0]))),strokeColor:confirmed?'#137333':'#188038',strokeWeight:confirmed?2:1,strokeOpacity:0.9,fillColor:'#34a853',fillOpacity:confirmed?0.38:0.24,clickable:true})
        api.Event.addListener(polygon,'click',()=>setRegionInfo({name:f.properties.label,species:distribution.name,details:[...(f.properties.detail?[f.properties.detail]:[]),...evidence.map(e=>`${({excel:'엑셀',manual:'사용자 지정',observation:'관찰 확인'})[e.origin]} · ${e.detail}`)]}))
        polygons.push(polygon)
      }
    }
    return()=>{for(const p of polygons){p.setMap(null);api.Event.clearInstanceListeners(p)}}
  },[ready,regionsOn,boundaryData,selectedRegionCodes,distribution])
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
    if (ready && map.current && sdk.current) {
      map.current.setMapTypeId(satellite ? sdk.current.MapTypeId.SATELLITE : sdk.current.MapTypeId.NORMAL)
    }
  }, [ready, satellite])
  useEffect(() => {
    if (!ready || !map.current || !sdk.current) return
    const api = sdk.current
    const groups = new Map<string, MapPin[]>()
    for (const pin of pins) {
      const key = `${pin.latitude},${pin.longitude}`
      groups.set(key, [...(groups.get(key) || []), pin])
    }
    for (const [key, marker] of markers.current) if (!groups.has(key)) {
      marker.setMap(null); api.Event.clearInstanceListeners(marker); markers.current.delete(key); appearances.current.delete(key)
    }
    for (const [key, values] of groups) {
      const appearance = pinAppearance(values.map(pin => pin.source || 'direct'))
      if (markers.current.has(key)) {
        if (appearances.current.get(key) !== appearance.signature) {
          markers.current.get(key)!.setIcon({content: appearance.content, anchor: new api.Point(15, 33)})
          markers.current.get(key)!.setTitle(appearance.title)
          appearances.current.set(key, appearance.signature)
        }
        continue
      }
      const marker = new api.Marker({ map: hidden ? null : map.current, position: new api.LatLng(values[0].latitude, values[0].longitude), title: appearance.title, icon: {content: appearance.content, anchor: new api.Point(15, 33)} })
      api.Event.addListener(marker, 'click', () => {
        setGroup(key)
        const first = latest.current.pins.find(p => `${p.latitude},${p.longitude}` === key)
        if (first) latest.current.onSelect?.(first)
      })
      markers.current.set(key, marker)
      appearances.current.set(key, appearance.signature)
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
    appearances.current.clear()
    if (map.current) sdk.current?.Event.clearInstanceListeners(map.current)
  }, [])
  const grouped = hidden ? [] : pins.filter(p => `${p.latitude},${p.longitude}` === group)
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
      {boundaryData&&<span>{boundaryData.source} · <a href={boundaryData.source_url} target="_blank" rel="noreferrer">경계 출처</a></span>}
      {regionInfo&&distribution&&regionInfo.species===distribution.name&&<div className="distribution-evidence"><strong>{regionInfo.name}</strong><button type="button" onClick={()=>setRegionInfo(null)}>닫기</button><ul>{regionInfo.details.map((d,i)=><li key={i}>{d}</li>)}</ul></div>}
    </>,infoContainer)}
    {error && <p role="alert" className="error">{error}</p>}
    {!ready && !error && shown && <p role="status">지도를 불러오는 중입니다.</p>}
    <div className="map-frame"><div className="map-canvas" ref={element} aria-label="네이버 지도" /></div>
    {grouped.length > 0 && <div className="map-records"><strong>이 위치의 기록 {grouped.length}건</strong>{grouped.map(pin => <button type="button" key={pin.id} onClick={() => onSelect?.(pin)}><span style={{color:PIN_STYLE[pin.source || 'direct'].color}}>●</span> {PIN_STYLE[pin.source || 'direct'].label} · {pin.label}</button>)}</div>}
  </section>
}
