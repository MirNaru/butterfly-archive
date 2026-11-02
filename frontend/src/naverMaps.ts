// SDK를 페이지당 한 번만 로드하며 Secret을 브라우저로 가져오지 않습니다.
export interface LatLng { lat(): number; lng(): number }
export interface NaverMap { getZoom():number; getBounds():{getSW():LatLng;getNE():LatLng}; setCenter(point: LatLng): void; setSize(size: { width: number; height: number }): void; setMapTypeId(type: string): void; fitBounds(points: LatLng[], options?: {top:number;right:number;bottom:number;left:number;maxZoom:number}): void }
export interface PolygonStyle {strokeColor:string;strokeWeight:number;strokeOpacity:number;fillColor:string;fillOpacity:number;clickable:boolean}
export interface NaverPolygon {setMap(map:NaverMap|null):void;setOptions(options:PolygonStyle):void}
export interface MarkerIcon { content: string; anchor: { x: number; y: number } }
export interface NaverMarker { setMap(map: NaverMap | null): void; setIcon(icon: MarkerIcon): void; setTitle(title: string): void }
export interface MapClick { coord: LatLng }
export interface NaverMaps {
  Polygon: new (options: PolygonStyle & { map:NaverMap|null; paths:LatLng[][] }) => NaverPolygon
  MapTypeId: { NORMAL: string; SATELLITE: string }
  LatLng: new (lat: number, lon: number) => LatLng
  Point: new (x: number, y: number) => { x: number; y: number }
  Map: new (element: HTMLElement, options: { center: LatLng; zoom: number }) => NaverMap
  Marker: new (options: { map: NaverMap | null; position: LatLng; title: string; icon?: MarkerIcon }) => NaverMarker
  Event: {
    addListener(target: NaverMap | NaverMarker | {setMap:(map:NaverMap|null)=>void}, name: string, callback: (event: MapClick) => void): object
    removeListener(listener: object): void
    clearInstanceListeners(target: NaverMap | NaverMarker | {setMap:(map:NaverMap|null)=>void}): void
  }
}
declare global {
  interface Window { naver?: { maps: NaverMaps }; navermap_authFailure?: () => void }
}
let loading: Promise<NaverMaps> | undefined
let authenticationFailed = false
const authListeners = new Set<() => void>()
export function onMapAuthFailure(callback: () => void) {
  authListeners.add(callback)
  if (authenticationFailed) callback()
  return () => { authListeners.delete(callback) }
}
export function loadMaps(clientId: string): Promise<NaverMaps> {
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const timer = window.setTimeout(() => reject(new Error('지도 연결 시간이 초과되었습니다. 표와 직접 입력은 사용할 수 있습니다.')), 15000)
    window.navermap_authFailure = () => {
      authenticationFailed = true
      window.clearTimeout(timer)
      for (const callback of authListeners) callback()
      reject(new Error('지도 인증을 확인해 주세요.'))
    }
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`
    script.onload = () => {
      window.clearTimeout(timer)
      if (window.naver?.maps && !authenticationFailed) resolve(window.naver.maps)
      else reject(new Error('지도 SDK를 사용할 수 없습니다.'))
    }
    script.onerror = () => { window.clearTimeout(timer); reject(new Error('지도 서버에 연결할 수 없습니다.')) }
    document.head.appendChild(script)
  })
  return loading
}
