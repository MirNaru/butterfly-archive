// 표시 전용 경계를 화면 범위와 축척으로 선택하고 지도 도형을 재사용합니다.
import type { NaverMap, NaverMaps, NaverPolygon, PolygonStyle } from './naverMaps'

export type Bounds = [number, number, number, number]
export type BoundaryLevel = 'coarse' | 'medium' | 'full'
export interface BoundaryFeature {properties:{code:string;label:string;detail?:string};bbox:Bounds;parts:{id:number;bbox:Bounds;rings:number[][][]}[]}
export interface BoundaryData {level:BoundaryLevel;features:BoundaryFeature[];source:string;source_url:string}
export interface RegionPart {key:string;feature:BoundaryFeature;rings:number[][][];confirmed:boolean}
export const boundaryLevel = (zoom:number):BoundaryLevel => zoom <= 8 ? 'coarse' : zoom <= 11 ? 'medium' : 'full'
export function intersects(a:Bounds,b:Bounds) {return a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1]}
export function paddedBounds(b:Bounds):Bounds {
  const x=(b[2]-b[0])*0.2,y=(b[3]-b[1])*0.2
  return [b[0]-x,b[1]-y,b[2]+x,b[3]+y]
}
export function visibleParts(data:BoundaryData,codes:Set<string>,confirmed:Set<string>,bounds:Bounds):RegionPart[] {
  const result:RegionPart[]=[]
  for(const feature of data.features) {
    const code=feature.properties.code
    if(!codes.has(code)||(code.length>2&&codes.has(code.slice(0,2)))||!intersects(feature.bbox,bounds))continue
    for(const part of feature.parts)if(intersects(part.bbox,bounds))result.push({key:`${data.level}:${code}:${part.id}`,feature,rings:part.rings,confirmed:confirmed.has(code)})
  }
  return result
}
const requests=new Map<BoundaryLevel,Promise<BoundaryData>>()
export function loadBoundaries(level:BoundaryLevel) {
  if(!requests.has(level))requests.set(level,fetch(`/api/regions/boundaries?level=${level}`,{signal:AbortSignal.timeout(30000)}).then(async r=>{
    if(!r.ok)throw new Error('지역 경계를 읽지 못했습니다.')
    return await r.json() as BoundaryData
  }).catch(error=>{requests.delete(level);throw error}))
  return requests.get(level)!
}
function style(confirmed:boolean):PolygonStyle {
  return {strokeColor:confirmed?'#137333':'#188038',strokeWeight:confirmed?2:1,strokeOpacity:0.9,fillColor:'#34a853',fillOpacity:confirmed?0.38:0.24,clickable:true}
}
interface Entry {polygon:NaverPolygon;visible:boolean;confirmed:boolean;points:number}
interface Scheduler {request(callback:()=>void):number;cancel(id:number):void;now():number}
const frames:Scheduler={request:callback=>requestAnimationFrame(callback),cancel:id=>cancelAnimationFrame(id),now:()=>performance.now()}

export class RegionLayer {
  private entries=new Map<string,Entry>()
  private frame:number|null=null
  private generation=0
  private disposed=false
  private map:NaverMap
  private sdk:NaverMaps
  private onClick:(feature:BoundaryFeature)=>void
  private scheduler:Scheduler
  constructor(map:NaverMap,sdk:NaverMaps,onClick:(feature:BoundaryFeature)=>void,scheduler=frames) {
    this.map=map;this.sdk=sdk;this.onClick=onClick;this.scheduler=scheduler
  }
  cancel() {
    this.generation++
    if(this.frame!==null)this.scheduler.cancel(this.frame)
    this.frame=null
  }
  update(parts:RegionPart[]) {
    this.cancel()
    if(this.disposed)return
    const generation=this.generation,wanted=new Set(parts.map(p=>p.key)),jobs:(()=>void)[]=[]
    for(const [key,entry] of this.entries)if(entry.visible&&!wanted.has(key))jobs.push(()=>{entry.polygon.setMap(null);entry.visible=false})
    for(const part of parts) {
      const existing=this.entries.get(part.key)
      if(existing?.visible&&existing.confirmed===part.confirmed)continue
      jobs.push(()=>{
        let entry=this.entries.get(part.key)
        if(!entry) {
          const polygon=new this.sdk.Polygon({...style(part.confirmed),map:this.map,paths:part.rings.map(r=>r.map(p=>new this.sdk.LatLng(p[1],p[0])))})
          entry={polygon,visible:true,confirmed:part.confirmed,points:part.rings.reduce((n,r)=>n+r.length,0)}
          this.sdk.Event.addListener(polygon,'click',()=>this.onClick(part.feature))
        } else {
          if(entry.confirmed!==part.confirmed)entry.polygon.setOptions(style(part.confirmed))
          if(!entry.visible)entry.polygon.setMap(this.map)
          entry.visible=true;entry.confirmed=part.confirmed
        }
        this.entries.delete(part.key);this.entries.set(part.key,entry)
      })
    }
    // 숨긴 도형만 오래된 순서로 정리합니다.
    let cursor=0
    const run=()=>{
      this.frame=null
      if(this.disposed||generation!==this.generation)return
      const start=this.scheduler.now()
      let count=0
      while(cursor<jobs.length&&count++<12) {
        jobs[cursor++]()
        if(this.scheduler.now()-start>=5)break
      }
      if(cursor<jobs.length)this.frame=this.scheduler.request(run)
      else this.prune()
    }
    if(jobs.length)this.frame=this.scheduler.request(run)
    else this.prune()
  }
  private prune() {
    let count=this.entries.size,points=0
    for(const entry of this.entries.values())points+=entry.points
    for(const [key,entry] of this.entries) {
      if(count<=600&&points<=100000)break
      if(entry.visible)continue
      this.sdk.Event.clearInstanceListeners(entry.polygon)
      this.entries.delete(key);count--;points-=entry.points
    }
  }
  dispose() {
    this.cancel();this.disposed=true
    for(const entry of this.entries.values()) {
      if(entry.visible)entry.polygon.setMap(null)
      this.sdk.Event.clearInstanceListeners(entry.polygon)
    }
    this.entries.clear()
  }
}
