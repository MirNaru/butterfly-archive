// 지역 표시 범위, 도형 재사용, 취소, 캐시 수명과 프레임 분할을 검사합니다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {RegionLayer,boundaryLevel,paddedBounds,visibleParts,loadBoundaries} from '../src/regionLayer.ts'
function fixture() {
  let next=0,created=0,cleared=0
  const queue=new Map(),polygons=[]
  const scheduler={request:fn=>{queue.set(++next,fn);return next},cancel:id=>queue.delete(id),now:()=>0}
  const sdk={LatLng:class {constructor(lat,lng){this.lat=lat;this.lng=lng}},Polygon:class {
    constructor(options){created++;this.map=options.map;this.styles=0;polygons.push(this)}
    setMap(map){this.map=map} setOptions(){this.styles++}
  },Event:{addListener:(p,n,fn)=>{p.click=fn},clearInstanceListeners:p=>{p.click=null;cleared++}}}
  const step=()=>{const item=queue.entries().next().value;if(item){queue.delete(item[0]);item[1]()}}
  const flush=()=>{let n=0;while(queue.size){assert.ok(n++<1000);step()}}
  const layer=new RegionLayer({},sdk,()=>{},scheduler)
  return {layer,step,flush,polygons,stats:()=>({created,cleared,pending:queue.size,visible:polygons.filter(p=>p.map).length})}
}
const part=(key,confirmed=false)=>({key,confirmed,feature:{properties:{code:key,label:key}},rings:[[[0,0],[1,0],[1,1],[0,0]]]})
test('축척과 화면 여백을 적용하며 상위 지역과 하위 지역을 중복 표시하지 않음',()=>{
  assert.deepEqual([7,8,9,11,12,17].map(boundaryLevel),['coarse','coarse','medium','medium','full','full'])
  assert.deepEqual(paddedBounds([0,0,10,10]),[-2,-2,12,12])
  const f=(code,bbox)=>({properties:{code},bbox,parts:[{id:0,bbox,rings:[]}]})
  const data={level:'full',features:[f('11',[0,0,10,10]),f('11010',[0,0,2,2]),f('21',[20,20,30,30])]}
  const parts=visibleParts(data,new Set(['11','11010','21']),new Set(['11']),[1,1,3,3])
  assert.equal(parts.length,1);assert.equal(parts[0].key,'full:11:0');assert.ok(parts[0].confirmed)
  assert.equal(visibleParts(data,new Set(['21']),new Set(),[0,0,1,1]).length,0)
})
test('같은 선택과 숨김 후 다시 보기는 기존 도형 재사용, 근거 변경은 스타일만 갱신',()=>{
  const t=fixture();t.layer.update([part('a')]);t.flush();t.layer.update([part('a')]);t.flush()
  assert.equal(t.stats().created,1)
  t.layer.update([]);t.flush();assert.equal(t.stats().visible,0)
  t.layer.update([part('a',true)]);t.flush();assert.equal(t.stats().created,1);assert.equal(t.polygons[0].styles,1)
  t.layer.dispose();assert.equal(t.stats().visible,0);assert.equal(t.stats().cleared,1)
})
test('프레임 사이 숨김이나 종 변경은 미완료 생성을 취소하고 중복 도형을 만들지 않음',()=>{
  const t=fixture();t.layer.update(Array.from({length:100},(_,i)=>part('old'+i)));t.step()
  assert.equal(t.stats().created,12)
  t.layer.update([part('new')]);t.flush();assert.equal(t.stats().created,13);assert.equal(t.stats().visible,1)
  t.layer.update(Array.from({length:100},(_,i)=>part('pending'+i)));t.layer.update([]);t.flush()
  assert.equal(t.stats().created,13);assert.equal(t.stats().visible,0)
  t.layer.update([part('never')]);t.layer.dispose();t.flush();assert.equal(t.stats().created,13)
})
test('오래된 비표시 도형 캐시를 제한하고 화면 도형은 유지',()=>{
  const t=fixture();t.layer.update(Array.from({length:650},(_,i)=>part(String(i))));t.flush()
  assert.equal(t.stats().visible,650)
  t.layer.update([]);t.flush();assert.equal(t.stats().cleared,50)
  t.layer.update([part('649')]);t.flush();assert.equal(t.stats().created,650)
  t.layer.update([part('0')]);t.flush();assert.equal(t.stats().created,651)
})
test('경계 통신 실패 후 재시도하고 성공한 축척 요청은 재사용',async()=>{
  const original=globalThis.fetch
  let calls=0
  globalThis.fetch=async()=>{calls++;return calls===1?{ok:false}:{ok:true,json:async()=>({level:'medium',features:[]})}}
  try {
    await assert.rejects(loadBoundaries('medium'),/지역 경계/)
    const first=await loadBoundaries('medium'),second=await loadBoundaries('medium')
    assert.equal(first,second);assert.equal(calls,2)
  }finally{globalThis.fetch=original}
})


test('도 참고 영역이 있어도 관찰 시군은 진한 레이어로 남음',()=>{
  const f=code=>({properties:{code},bbox:[0,0,10,10],parts:[{id:0,bbox:[0,0,10,10],rings:[]}]})
  const parts=visibleParts({level:'full',features:[f('32'),f('32550')]},new Set(['32','32550']),new Set(['32550']),[1,1,3,3])
  assert.equal(parts.length,2)
  assert.equal(parts.find(p=>p.feature.properties.code==='32').confirmed,false)
  assert.equal(parts.find(p=>p.feature.properties.code==='32550').confirmed,true)
})
