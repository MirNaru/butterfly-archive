// 실제 Supercluster로 건수 보존·직접 관찰 분리·축척과 화면 경계를 검사합니다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {buildPinIndex, clusterZoom, markerBounds} from '../src/mapClusters.ts'
import {clusterAppearance} from '../src/mapPinStyle.ts'
const world=[-180,-90,180,90]
const pin=(id,longitude,source='naturing',latitude=37)=>({id,longitude,latitude,source})

test('통합 관찰 수와 위치 수를 구분하고 출처 수와 직접 관찰을 보존',()=>{
  const pins=[pin('a',127),pin('b',127,'inaturalist'),pin('c',127.001),pin('d',127,'direct'),pin('e',127.002,'direct')]
  const index=buildPinIndex(pins),low=index.query(world,7,1),high=index.query(world,22,1)
  assert.equal(low.length,3)
  const cluster=low.find(p=>p.expansionZoom!==undefined)
  assert.equal(cluster.count,3);assert.equal(cluster.locations,2)
  assert.deepEqual(cluster.sources,{direct:0,naturing:2,inaturalist:1,other:0})
  assert.equal(high.length,4)
  assert.equal(high.reduce((s,p)=>s+p.count,0),5)
  assert.equal(low.reduce((s,p)=>s+p.count,0),5)
  assert.equal(low.filter(p=>p.sources.direct).length,2)
  assert(index.query(world,cluster.expansionZoom,1).length>low.length)
  assert(clusterAppearance(cluster.count,cluster.locations,cluster.sources).title.includes('3건 · 2개 위치'))
})

test('같은 좌표는 최대 확대에도 한 위치이며 필터 인덱스가 서로 섞이지 않음',()=>{
  const pins=[pin('a',127),pin('b',127)]
  const index=buildPinIndex(pins)
  for(const z of [0,7,18,22]){
    const points=index.query(world,z,1)
    assert.equal(points.length,1);assert.equal(points[0].count,2);assert.equal(points[0].expansionZoom,undefined)
  }
  assert.equal(buildPinIndex([pins[0]]).query(world,7,2)[0].count,1)
  assert.equal(index.query(world,7,1)[0].count,2)
  assert.deepEqual(buildPinIndex([]).query(world,7,3),[])
})

test('날짜 변경선·세계 화면·경계 여유와 잘못된 좌표 처리',()=>{
  const index=buildPinIndex([pin('a',179,'direct'),pin('b',-179,'direct'),pin('c',0,'direct'),pin('bad',NaN)])
  assert.equal(index.query([170,-90,-170,90],22,1).length,2)
  assert.deepEqual(markerBounds(world),world)
  const padded=markerBounds([175,35,-175,37])
  assert.equal(padded[0],173);assert.equal(padded[2],-173)
  assert.equal(index.query(padded,22,1).length,2)
  assert.equal(index.query([1,30,2,40],22,1).length,0)
  assert.equal(clusterZoom([-180,-85,180,85],256),0)
  assert.equal(clusterZoom([126,36,127,37],256*128/360),7)
})

test('대량 데이터에서도 단계별 관찰 수 보존과 출력 키 중복 없음',()=>{
  const pins=Array.from({length:10000},(_,i)=>pin(String(i),124+(i%100)*.05,i%7===0?'direct':'naturing',33+Math.floor(i/100)*.05))
  const index=buildPinIndex(pins)
  for(const z of [0,7,10,15,22]){
    const result=index.query(world,z,5)
    assert.equal(result.reduce((sum,p)=>sum+p.count,0),pins.length)
    assert(result.every(p=>Object.values(p.sources).reduce((sum,n)=>sum+n,0)===p.count))
    assert.equal(new Set(result.map(p=>p.key)).size,result.length)
    assert.equal(result.filter(p=>p.sources.direct).length,pins.filter(p=>p.source==='direct').length)
  }
})
