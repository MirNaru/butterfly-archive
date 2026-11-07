// 실제 MapView의 마커 갱신을 모의 SDK로 실행해 출처 변경과 재사용을 확인합니다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from '../node_modules/typescript/lib/typescript.js'
import * as pinStyle from '../src/mapPinStyle.ts'
import * as clusters from '../src/mapClusters.ts'

const compiled=ts.transpileModule(readFileSync(new URL('../src/MapView.tsx',import.meta.url),'utf8'),{
  compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText

function harness() {
  let refs=[],effects=[],refIndex=0,stateIndex=0,hidden=false
  const markers=[]
  const selected=[]
  let viewport={zoom:22,bounds:[-180,-90,180,90],width:1e12}
  const map={getZoom:()=>viewport.zoom,getSize:()=>({width:viewport.width}),getBounds:()=>({getSW:()=>({lng:()=>viewport.bounds[0],lat:()=>viewport.bounds[1]}),getNE:()=>({lng:()=>viewport.bounds[2],lat:()=>viewport.bounds[3]})}),updateBy:(point,zoom)=>{map.expansion={point,zoom}}}
  const calls={setMap:0,icon:0,cleared:0}
  class Marker {
    constructor(options){this.options=options;this.zIndex=options.zIndex;this.map=options.map;markers.push(this)}
    setMap(value){calls.setMap++;this.map=value}
    setIcon(value){calls.icon++;this.icon=value}
    setTitle(value){this.title=value}
    setZIndex(value){this.zIndex=value}
  }
  const sdk={Marker,LatLng:class{},Point:class{},Event:{addListener(target,event,callback){target[event]=callback},clearInstanceListeners(target){calls.cleared++;delete target.click}}}
  const react={
    useRef(value){const index=refIndex++;return refs[index]??(refs[index]={current:value})},
    useState(value){const index=stateIndex++;return [index===0?true:index===3?hidden:index===7?viewport:value,()=>{}]},
    useEffect(callback,deps){effects.push({callback,deps})},
  }
  const exports={}
  const jsx=(type,props)=>({type,props})
  const dependencies={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-dom':{createPortal:()=>null},
    './api':{},'./naverMaps':{},'./mapPinStyle':pinStyle,'./mapClusters':clusters,'./regionLayer':{boundaryLevel:()=>0}}
  vm.runInNewContext(compiled,{exports,require:name=>{
    assert(name in dependencies,`Unexpected import: ${name}`)
    return dependencies[name]
  }})
  function render(pins,hide=false,shown=true){
    hidden=hide
    effects=[];refIndex=0;stateIndex=0
    exports.default({shown,pins,onSelect:pin=>selected.push(pin.id)})
    refs[1].current=map;refs[2].current=sdk
    refs[4].current={pins,onSelect:pin=>selected.push(pin.id)}
    effects.find(effect=>effect.deps?.[0]===pins&&effect.deps[2]===true&&effect.deps[3]===shown).callback()
  }
  return {render,markers,selected,map,calls,view:value=>{viewport=value},dispose:()=>effects.at(-1).callback()()}
}

test('직접 관찰은 같은 위치의 간접 핀보다 위에 표시하고 기존 간접 핀을 재사용', () => {
  const {render,markers,selected,map,calls}=harness()
  const indirect={id:'indirect',latitude:37,longitude:127,source:'naturing'}
  const direct={...indirect,id:'direct',source:'direct'}
  render([indirect])
  assert.equal(markers.length,1)
  const marker=markers[0],low=marker.zIndex
  render([indirect,direct])
  assert.equal(markers.length,2)
  assert(markers[1].zIndex>low)
  markers[1].click()
  assert.deepEqual(selected,['direct'])
  render([indirect])
  assert.equal(marker.zIndex,low)
  render([indirect],true);assert.equal(marker.map,null)
  render([indirect]);assert.equal(marker.map,map)
  assert.equal(markers.length,2)
  assert.equal(calls.setMap,3)
})

const pin=(id,latitude=30+id*0.0001)=>({id:String(id),latitude,longitude:127,source:'naturing'})

test('같은 결과는 지도 명령 없이 유지하고 필터 복원은 기존 객체를 재사용',()=>{
  const h=harness(), all=[pin(1),pin(2),pin(3)]
  h.render(all)
  assert.equal(h.calls.setMap,0)
  h.render(all.map(p=>({...p})))
  assert.equal(h.calls.setMap,0)
  assert.equal(h.calls.icon,0)
  h.render([all[0]])
  assert.equal(h.calls.setMap,2)
  h.render(all)
  assert.equal(h.calls.setMap,4)
  assert.equal(h.markers.length,3)
  assert.equal(h.calls.cleared,0)
})

test('숨김 중 필터 변경은 핀을 생성하지 않고 표시 시 최신 위치·내용만 사용',()=>{
  const h=harness(), a=pin(1)
  h.render([a]);h.render([a],true)
  h.render([pin(2)],true)
  assert.equal(h.markers.length,1)
  assert.equal(h.calls.setMap,1)
  h.render([pin(2)])
  assert.equal(h.markers[0].map,null)
  assert.equal(h.markers[1].map,h.map)
  h.markers[1].click()
  assert.deepEqual(h.selected,['2'])
  h.render([])
  assert(h.markers.every(m=>m.map===null))
  h.render([{...pin(2),id:'new',source:'direct'}])
  h.markers[2].click()
  assert.deepEqual(h.selected,['2','new'])
  assert.equal(h.markers.length,3)
})

test('통합 핀은 확대하고 필터 변경 뒤 이전 통합 클릭과 객체를 제거',()=>{
  const h=harness(),all=[pin(1),pin(2),{...pin(3),source:'direct'}]
  h.view({zoom:7,bounds:[124,32,132,40],width:800})
  // 합성 위치를 화면 안으로 옮깁니다.
  all.forEach(p=>p.latitude+=5)
  h.render(all)
  const cluster=h.markers.find(m=>m.options.title.includes('간접 관찰 2건'))
  const direct=h.markers.find(m=>m.zIndex===1000)
  assert(cluster&&direct)
  assert(direct.zIndex>cluster.zIndex)
  const oldClick=cluster.click
  cluster.click()
  assert(h.map.expansion.zoom>7)
  h.render([all[0],all[2]])
  assert.equal(cluster.map,null)
  assert.equal(cluster.click,undefined)
  const previous=h.map.expansion
  oldClick()
  assert.equal(h.map.expansion,previous)
})

test('화면 밖 핀은 만들지 않고 이동·복귀 때 재사용하며 숨김 중 이동은 생성하지 않음',()=>{
  const h=harness(),all=[pin(1,35),pin(2,38)]
  h.view({zoom:22,bounds:[126,34.9,128,35.1],width:1e12})
  h.render(all)
  assert.equal(h.markers.length,1)
  h.view({zoom:22,bounds:[126,37.9,128,38.1],width:1e12})
  h.render(all)
  assert.equal(h.markers.length,2)
  assert.equal(h.markers[0].map,null)
  h.render(all,true)
  h.view({zoom:22,bounds:[126,34.9,128,35.1],width:1e12})
  h.render(all,true)
  assert.equal(h.markers.length,2)
  h.render(all)
  assert.equal(h.markers[0].map,h.map)
  assert.equal(h.markers.length,2)
})

test('숨긴 핀 상한은 8000개이며 표시 중인 핀은 제거하지 않음',()=>{
  const h=harness(), all=Array.from({length:8002},(_,i)=>({...pin(i),source:'direct'}))
  h.render(all)
  h.render([all[0]])
  assert.equal(h.calls.cleared,1)
  assert.equal(h.markers[0].map,h.map)
  assert.equal(h.markers[1].click,undefined)
  h.render([all[0],all[2]])
  assert.equal(h.markers.length,8002)
  h.render([all[0],all[1],all[2]])
  assert.equal(h.markers.length,8003)
  h.dispose()
  assert(h.markers.every(m=>m.map===null&&m.click===undefined))
})

test('최근 재사용한 핀은 숨김 보관 순서 뒤로 이동',()=>{
  const h=harness(), all=Array.from({length:8000},(_,i)=>({...pin(i),source:'direct'}))
  h.render(all);h.render([])
  h.render([all[0]]);h.render([])
  h.render([pin(8000)]);h.render([])
  assert.equal(typeof h.markers[0].click,'function')
  assert.equal(h.markers[1].click,undefined)
  assert.equal(h.calls.cleared,1)
})

test('지도 탭 밖의 변경은 복귀 시 반영하고 그대로인 핀은 재연결하지 않음',()=>{
  const h=harness(), all=[pin(1),pin(2)]
  h.render(all)
  h.render(all,false,false)
  h.render(all)
  assert.equal(h.calls.setMap,0)
  h.render([all[0]],false,false)
  assert.equal(h.calls.setMap,0)
  h.render([all[0]])
  assert.equal(h.calls.setMap,1)
  assert.equal(h.markers[1].map,null)
  assert.equal(h.markers[0].map,h.map)
})
