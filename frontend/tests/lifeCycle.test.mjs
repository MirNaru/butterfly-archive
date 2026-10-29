// 한살이 통계의 표본 단위와 연말·윤일·구간 경계를 검증합니다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxStats, dayOfYear, dayLabel, slotEnd, coverageGroups, collectLifeSamples, stageData, lifeWindows, rangeParts, BOX_MINIMUM } from '../src/lifeCycle.ts'
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
 assert.deepEqual(coverageGroups([window(35,2)]),[{start:dayOfYear('2026-12-11'),end:dayOfYear('2026-01-20')+366}])
 assert.equal(rangeParts(350,380).length,2)
})
test('분리된 참고 구간과 범위 밖 관찰을 보존', () => {
 const result=stageData({...reference,lifecycle:[window(13,15),window(25,27)]},[sample('2026-05-10'),sample('2026-09-10'),sample('2026-07-10')],'adult',filter)
 assert.equal(result.groups.length,2)
 assert.deepEqual(result.groups.map(g=>g.samples.length),[1,1])
 assert.equal(result.outside[0].date,'2026-07-10')
 assert.equal(result.groups[0].box,null)
})
test('겨울을 넘는 상자는 한 구간에서 계산', () => {
 const dates=['2026-12-12','2026-12-20','2027-01-01','2027-01-10','2027-01-15']
 const result=stageData({...reference,lifecycle:[window(35,2)]},dates.flatMap(d=>Array.from({length:4},()=>sample(d))),'adult',filter)
 assert.equal(result.groups[0].box.n,20)
 assert.equal(dayLabel(result.groups[0].box.median),'1월 1일')
 assert.equal(result.outside.length,0)
})
test('초중 일 경계와 19건·20건 자동 표시',()=>{
 const ref={...reference,lifecycle:[window(13,17,{start_day:dayOfYear('2000-05-06'),end_day:dayOfYear('2000-06-15')})]}
 assert.equal(stageData(ref,Array.from({length:19},()=>sample('2026-05-06')),'adult',filter).groups[0].box,null)
 assert.equal(stageData(ref,Array.from({length:20},()=>sample('2026-05-06')),'adult',filter).groups[0].box.n,20)
 const data=stageData(ref,['2026-05-05','2026-05-06','2026-06-15','2026-06-16'].map(d=>sample(d)),'adult',filter)
 assert.deepEqual(data.groups[0].samples.map(s=>s.date),['2026-05-06','2026-06-15'])
 assert.equal(data.outside.length,2)
})
test('분리된 발생 기간은 각각 20사례가 필요',()=>{
 const ref={...reference,lifecycle:[window(13,15),window(25,27)]}
 const data=stageData(ref,[...Array.from({length:10},()=>sample('2026-05-10')),...Array.from({length:10},()=>sample('2026-09-10'))],'adult',filter)
 assert(data.groups.every(g=>g.box===null))
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
