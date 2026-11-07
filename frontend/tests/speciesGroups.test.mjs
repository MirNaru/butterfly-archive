// 종별 목록의 중복 제거·출처별 건수·지역 우선순위를 검사합니다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {groupSpecies} from '../src/speciesGroups.ts'
const row=(id,source,region,date='2025-05-01',result='observed')=>({survey:{},scientificName:'',record:{id,species_id:1,species_name:'시험 나비',source_type:source,administrative_region:region,effective_date:date,result}})
test('같은 종은 한 번만 표시하고 개체 수와 무관하게 관찰 기록을 집계',()=>{
 const groups=groupSpecies([row(1,'direct','강원특별자치도 정선군'),row(2,'indirect','경기도 광주시'),row(3,'direct','강원특별자치도 정선군','2024-01-01','not_found')],'')
 assert.equal(groups.length,1);assert.equal(groups[0].observed,2);assert.equal(groups[0].direct,1);assert.equal(groups[0].indirect,1);assert.equal(groups[0].notFound,1);assert.equal(groups[0].regions.length,2)
})
test('검색한 지역이 직접 관찰 우선순위보다 먼저 표시',()=>{
 const group=groupSpecies([row(1,'direct','강원특별자치도 정선군'),row(2,'indirect','경기도 광주시')],'광주')[0]
 assert.equal(group.regions[0],'경기도 광주시')
})
test('미발견은 최근 관찰일에 포함하지 않고 종 미확정은 별도 묶음',()=>{
 const unknown=row(3,'direct','');unknown.record.species_id=null;unknown.record.species_name=null
 const groups=groupSpecies([row(1,'direct','정선','2024-05-01'),row(2,'direct','정선','2025-05-01','not_found'),unknown],'')
 assert.equal(groups.find(g=>g.id===1).latest,'2024-05-01');assert.equal(groups.find(g=>g.id===-1).name,'동정 미확정')
})
test('가나다보다 도감 표시 순서를 우선',()=>{
 const a=row(1,'direct','');a.record.species_name='가나다 나비'
 const b=row(2,'direct','');b.record.species_id=2;b.record.species_name='하늘 나비'
 assert.deepEqual(groupSpecies([a,b],'',new Map([[2,0],[1,1]])).map(g=>g.id),[2,1])
})

test('현재 명칭으로 표시해도 이전 명칭 검색 지역을 먼저 표시',()=>{
 const a=row(1,'direct','경기도 광주시'),b=row(2,'indirect','강원특별자치도 정선군')
 b.record.place_search='강원도 정선군 강원특별자치도 정선군'
 assert.equal(groupSpecies([a,b],'강원도')[0].regions[0],'강원특별자치도 정선군')
})

test('최다 실제 목격 지역을 먼저 표시하고 미발견은 건수에서 제외',()=>{
 const groups=groupSpecies([row(1,'direct','가 지역'),row(2,'indirect','나 지역'),row(3,'indirect','나 지역'),row(4,'direct','가 지역','2025-01-01','not_found')],'')
 assert.equal(groups[0].regions[0],'나 지역')
})
