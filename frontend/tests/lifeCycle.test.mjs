// 한살이 통계의 표본 단위와 연말·윤일·구간 경계를 검증합니다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxStats, dayOfYear, dayLabel, slotEnd, observationGroups, collectLifeSamples, stageData, lifeWindows, rangeParts, BOX_MINIMUM } from '../src/lifeCycle.ts'
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
