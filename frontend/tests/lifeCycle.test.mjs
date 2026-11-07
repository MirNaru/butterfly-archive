// 한살이 통계의 표본 단위와 연말·윤일·구간 경계를 검증합니다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxStats, dayOfYear, dayLabel, slotEnd, observationGroups, collectLifeSamples, stageData, lifeWindows, rangeParts, densityShape, adultExtremes, inLifePeriod, isOutlier, BOX_MINIMUM } from '../src/lifeCycle.ts'
const window = (start, end, extra={}) => ({id:'test',stage:'adult',start,end,source:'시험 도감',edition:'2026',region:'',enabled:true,...extra})
const reference = {lifecycle:[],periods:[],source:'시험 도감'}
const filter = {year:'',region:'',source:''}
const sample = (date, extra={}) => ({speciesId:1,stage:'adult',date,day:dayOfYear(date),place:'서울',sourceType:'direct',observationIds:[1],...extra})
test('사분위수·이상치·최소 표본·동일 날짜', () => {
 assert.equal(boxStats([1,2,3,4]),null)
 assert.equal(BOX_MINIMUM,20)
 assert.equal(boxStats(Array(19).fill(5)),null)
 assert.deepEqual(boxStats([1,2,3,4,5,100].flatMap(v=>Array(4).fill(v))),{n:24,q1:2,median:3.5,q3:5,low:1,high:5,outliers:[100,100,100,100]})
 assert.deepEqual(boxStats(Array(20).fill(5)),{n:20,q1:5,median:5,q3:5,low:5,high:5,outliers:[]})
})
test('윤일과 월말, 연말 구간을 같은 날짜 축으로 처리', () => {
 assert.equal(dayOfYear('2024-02-29'),60)
 assert.equal(slotEnd(6),60)
 assert.equal(dayLabel(367),'1월 1일')
 const group=observationGroups([sample('2026-12-11'),sample('2027-01-20')])[0]
 assert.equal(group.start,dayOfYear('2026-12-11'))
 assert.equal(group.end,dayOfYear('2027-01-20')+366)
 assert.equal(rangeParts(350,380).length,2)
})
test('도감의 분리 구간과 범위 밖 여부로 관찰을 제외하거나 나누지 않음', () => {
 const result=stageData({...reference,lifecycle:[window(13,15),window(25,27)]},[sample('2026-05-10'),sample('2026-09-10'),sample('2026-07-10')],'adult',filter)
 assert.equal(result.groups.length,1)
 assert.equal(result.groups[0].samples.length,3)
 assert.equal(result.groups[0].box,null)
})
test('겨울을 넘는 상자는 한 구간에서 계산', () => {
 const dates=['2026-12-12','2026-12-20','2027-01-01','2027-01-10','2027-01-15']
 const result=stageData({...reference,lifecycle:[window(35,2)]},dates.flatMap(d=>Array.from({length:4},()=>sample(d))),'adult',filter)
 assert.equal(result.groups[0].box.n,20)
 assert.equal(dayLabel(result.groups[0].box.median),'1월 1일')
 assert.equal(result.groups[0].samples.length,20)
})
test('도감 없이도 19건은 점, 20건은 상자로 자동 표시',()=>{
 const ref={...reference,lifecycle:[window(13,17,{start_day:dayOfYear('2000-05-06'),end_day:dayOfYear('2000-06-15')})]}
 assert.equal(stageData(ref,Array.from({length:19},()=>sample('2026-05-06')),'adult',filter).groups[0].box,null)
 assert.equal(stageData(ref,Array.from({length:20},()=>sample('2026-05-06')),'adult',filter).groups[0].box.n,20)
 const data=stageData(ref,['2026-05-05','2026-05-06','2026-06-15','2026-06-16'].map(d=>sample(d)),'adult',filter)
 assert.deepEqual(data.groups[0].samples.map(s=>s.date),['2026-05-05','2026-05-06','2026-06-15','2026-06-16'])
 assert.equal(stageData(reference,Array.from({length:20},()=>sample('2026-05-06')),'adult',filter).groups[0].box.n,20)
})
test('연간 관찰 분포를 집계하며 도감에서 발생 차수를 추론하지 않음',()=>{
 const ref={...reference,lifecycle:[window(13,15),window(25,27)]}
 const data=stageData(ref,[...Array.from({length:10},()=>sample('2026-05-10')),...Array.from({length:10},()=>sample('2026-09-10'))],'adult',filter)
 assert.equal(data.groups.length,1)
 assert.equal(data.groups[0].box.n,20)
})

test('도감 수정·삭제가 통계와 이상값 판정에 영향을 주지 않음',()=>{
 const samples=[...Array.from({length:20},()=>sample('2026-05-10')),sample('2026-08-24')]
 const baseline=stageData(reference,samples,'adult',filter).groups[0].box
 for(const ref of [{...reference,lifecycle:[window(13,15)]},{...reference,lifecycle:[window(1,2)]},{...reference,periods:[{start:25,end:27}]}]) {
  assert.deepEqual(stageData(ref,samples,'adult',filter).groups[0].box,baseline)
 }
 assert.equal(baseline.n,21)
 assert.deepEqual(baseline.outliers,[dayOfYear('2026-08-24')])
})

test('표본이 없으면 상자나 가상 관찰을 만들지 않음',()=>{
 const data=stageData({...reference,lifecycle:[window(13,15)]},[],'adult',filter)
 assert.deepEqual(data.samples,[])
 assert.deepEqual(data.groups,[])
})
test('검수 생략 종도 가져온 도감 추정 근거가 있으면 집계',()=>{
 const record={id:1,species_id:1,result:'observed',stage:'adult',identification:'candidate',source_type:'indirect',source_note:'https://www.naturing.net/o/1',effective_date:'2026-05-10',effective_place:'서울',effective_latitude:null,effective_longitude:null,stage_inferred:true}
 assert.equal(collectLifeSamples([{id:1,observations:[record]}])[0].stageEstimated,true)
 assert.equal(collectLifeSamples([{id:1,observations:[{...record,stage_inferred:false}]}]).length,0)
 assert.equal(collectLifeSamples([{id:1,observations:[{...record,stage_inferred:false,collection_accepted:true}]}])[0].stageEstimated,false)
})
test('과거 기간은 성충에만 적용하고 관찰 조건별 분리', () => {
 const legacy={...reference,periods:[{start:13,end:15}]}
 assert.equal(lifeWindows(legacy,'egg','').length,0)
 assert.equal(lifeWindows(legacy,'adult','').length,1)
 const result=stageData(legacy,[sample('2025-05-01'),sample('2026-05-02'),sample('2026-05-03',{sourceType:'indirect'}),sample('2026-05-04',{place:'부산'})],'adult',{year:'2026',region:'서울',source:'direct'})
 assert.deepEqual(result.samples.map(s=>s.date),['2026-05-02'])
})
test('개체 수로 가중하지 않고 미확정·미발견·단계 미상 제외', () => {
 const record={id:1,species_id:1,result:'observed',stage:'adult',identification:'user_confirmed',source_type:'direct',source_note:'',effective_date:'2026-05-01',effective_place:'서울',effective_latitude:null,effective_longitude:null,count:100}
 const surveys=[{id:1,observations:[record,{...record,id:2,count:1},{...record,id:3,stage:'unknown'},{...record,id:4,result:'not_found'},{...record,id:5,identification:'unidentified'}]}]
 const result=collectLifeSamples(surveys)
 assert.equal(result.length,1)
 assert.deepEqual(result[0].observationIds,[1,2])
})


test('표시 밀도는 수염 안에 제한하고 원래 사분위수와 이상값을 바꾸지 않음',()=>{
 const samples=[...Array.from({length:30},(_,i)=>sample(`2026-05-${String(i%20+1).padStart(2,'0')}`)),sample('2026-09-20')]
 const group=observationGroups(samples)[0], before=structuredClone(group.box)
 const shape=densityShape(group)
 assert.deepEqual(group.box,before)
 assert.ok(shape.paths.length)
 for(const path of shape.paths){
  const points=[...path.curve.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])])
  assert.equal(points[0][0],group.box.low-1)
  assert.equal(points.at(-1)[0],group.box.high-1)
  assert.ok(points.every(([x,y])=>Number.isFinite(x)&&y>=5&&y<=20))
 }
 assert.ok(shape.medianY>=5&&shape.medianY<=20)
})

test('겨울 밀도는 연말 경계에서 두 조각으로 이어지고 높이가 일치함',()=>{
 const group=observationGroups(['2026-12-15','2026-12-25','2027-01-05','2027-01-15'].flatMap(d=>Array.from({length:10},()=>sample(d))))[0]
 const shape=densityShape(group)
 assert.equal(shape.paths.length,2)
 const points=shape.paths.map(path=>[...path.curve.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]))
 assert.equal(points[0].at(-1)[0],366)
 assert.equal(points[1][0][0],0)
 assert.equal(points[0].at(-1)[1],points[1][0][1])
 assert.ok(points.flat().every(([x,y])=>x>=0&&x<=366&&y>=5&&y<=20))
})

test('동일 날짜 20사례도 유한한 표시를 만들고 19사례는 밀도를 만들지 않음',()=>{
 const same=observationGroups(Array.from({length:20},()=>sample('2026-05-10')))[0]
 const shape=densityShape(same)
 assert.equal(shape.medianY,5)
 assert.equal(shape.paths.length,1)
 assert.ok(!JSON.stringify(shape).match(/NaN|Infinity/))
 assert.equal(densityShape(observationGroups(Array.from({length:19},()=>sample('2026-05-10')))[0]),null)
})


test('전체 높이 밀도에서 채움은 사분위 구간만 차지하며 피크와 골이 남음',()=>{
 const samples=[...Array.from({length:40},(_,i)=>sample('2026-04-15',{day:100+i%20})),...Array.from({length:60},(_,i)=>sample('2026-08-15',{day:220+i%20}))]
 const group=observationGroups(samples)[0],shape=densityShape(group)
 const curve=shape.paths.flatMap(path=>[...path.curve.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]))
 assert.equal(Math.min(...curve.map(([,y])=>y)),5)
 const near=day=>curve.reduce((a,b)=>Math.abs(a[0]-(day-1))<Math.abs(b[0]-(day-1))?a:b)[1]
 assert.ok(near(110)<near(170)&&near(230)<near(170))
 const fill=shape.paths.filter(p=>p.fill).flatMap(path=>[...path.fill.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]))
 assert.equal(Math.min(...fill.map(([x])=>x)),group.box.q1-1)
 assert.equal(Math.max(...fill.map(([x])=>x)),group.box.q3-1)
 assert.ok(fill.some(([,y])=>y===20))
})

test('연말 이동한 이상값을 원본 사례에 다시 연결',()=>{
 const cases=[...Array.from({length:30},()=>sample('2025-07-01')),sample('2025-12-27'),sample('2024-01-13')]
 const groups=observationGroups(cases)
 assert.equal(cases.filter(p=>isOutlier(p,groups)).length,2)
 assert(isOutlier(cases.at(-1),groups))
 assert(!isOutlier(cases[0],groups))
})

test('지역별 어른벌레 최초·최후는 연도 대신 월일을 비교하고 동률 원본 보존',()=>{
 const records=[sample('2024-05-01',{region:'가'}),sample('2026-04-02',{region:'가'}),sample('2025-04-02',{region:'가'}),sample('2026-08-01',{region:'나'}),sample('2026-01-01',{region:'가',stage:'larva'})]
 const result=adultExtremes(records)
 assert.equal(result[0].region,'가');assert.equal(result[0].firstSamples.length,2);assert.equal(result[0].lastSamples[0].date,'2024-05-01')
 assert.equal(result[1].first,result[1].last)
 assert.deepEqual(adultExtremes([]),[])
})
test('사례 구간은 양끝을 포함하고 연말 구간 밖을 구분',()=>{
 const period={...window(1,1),start_day:dayOfYear('2000-12-01'),end_day:dayOfYear('2000-02-01')}
 assert(inLifePeriod(sample('2026-01-01'),period))
 assert(inLifePeriod(sample('2026-02-01'),period))
 assert(!inLifePeriod(sample('2026-06-01'),period))
})
