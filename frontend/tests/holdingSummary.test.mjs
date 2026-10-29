// 소장 종 수·알려진 수량·수량 미상과 취득 경로 검색을 따로 검증합니다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { holdingSummary, holdingMatches, groupHoldings, holdingGroupMatches } from '../src/holdingSummary.ts'
const holding = (species_id, extra={}) => ({species_id,korean_name:'가상 나비',scientific_name:'Test species',possession:'owned',quantity:null,male_quantity:null,female_quantity:null,photo_ids:[],acquisition:'unknown',sex:'unknown',notes:'',source_note:'',acquired_date:null,...extra})
test('같은 종의 여러 취득 건은 종 수를 늘리지 않으며 수량 미상을 1로 바꾸지 않음',()=>{
 const rows=[holding(1),holding(1,{quantity:3,acquisition:'purchase'}),holding(2,{quantity:2}),holding(3,{possession:'not_owned'})]
 assert.deepEqual(holdingSummary(rows),{species:2,knownQuantity:5,unknownRecords:1})
 assert.deepEqual(holdingSummary([holding(1)]),{species:1,knownQuantity:null,unknownRecords:1})
 assert.deepEqual(holdingSummary([]),{species:0,knownQuantity:null,unknownRecords:0})
})

test('암수 원래 내역을 보존한 한 행과 수량 도움말, 사진 중복 제거',()=>{
 const rows=[holding(1,{sex:'male',quantity:1,photo_ids:[2]}),holding(1,{sex:'female',quantity:3,photo_ids:[2,3]})]
 const groups=groupHoldings(rows)
 assert.equal(groups.length,1)
 assert.equal(groups[0].sex,'mixed')
 assert.equal(groups[0].quantityText,'4')
 assert.equal(groups[0].quantityHint,'수컷 1개체 / 암컷 3개체')
 assert.deepEqual(groups[0].rows,rows)
 assert.deepEqual(groups[0].photoIds,[2,3])
 assert(holdingGroupMatches(groups[0],'','','','male'))
 assert(holdingGroupMatches(groups[0],'','','','female'))
 assert(holdingGroupMatches(groups[0],'','','','mixed'))
 assert(!holdingGroupMatches(groups[0],'','','','unknown'))
 assert.equal(holdingSummary(rows).knownQuantity,4)
})

test('구매와 직접 채집 분리, 수량 미상과 일부만 아는 수량을 정확하게 표시',()=>{
 const groups=groupHoldings([holding(1,{sex:'male',quantity:2}),holding(1,{sex:'female'}),holding(1,{acquisition:'purchase',sex:'female',quantity:1})])
 assert.equal(groups.length,2)
 assert.equal(groups[0].quantityText,'2 + 미상')
 assert.equal(groups[0].quantityHint,'수컷 2개체 / 암컷 미상')
 assert.equal(groups[1].quantityText,'1')
 assert.equal(groupHoldings([holding(1,{sex:'male'}),holding(1,{sex:'female'})])[0].quantityText,'수량 미상')
})

test('암수 동시 등록의 총수량과 세부 수량을 중복 합산하지 않음',()=>{
 const mixed=holding(1,{sex:'mixed',quantity:4,male_quantity:1,female_quantity:3})
 assert.equal(groupHoldings([mixed])[0].quantityHint,'수컷 1개체 / 암컷 3개체')
 assert.equal(holdingSummary([mixed]).knownQuantity,4)
 assert(holdingMatches(mixed,'','','','male'))
 assert(holdingMatches(mixed,'','','','female'))
 assert.equal(groupHoldings([holding(1,{sex:'mixed',quantity:4})])[0].quantityHint,'수컷 미상 / 암컷 미상')
 const unknown=groupHoldings([holding(1,{quantity:3})])[0]
 assert.equal(unknown.quantityHint,'수컷 0개체 / 암컷 0개체 / 성별 미상 3개체')
 assert.equal(groupHoldings([holding(1,{possession:'not_owned',sex:'male'})])[0].quantityText,'해당 없음')
})
test('소지 미확인과 미소지 기록은 현재 소장 집계에서 제외',()=>{
 assert.equal(holdingSummary([holding(1,{possession:'unknown'}),holding(2,{possession:'not_owned'})]).species,0)
})
test('취득 경로·성별·소지 필터와 국명·학명·근거·메모 검색 조합',()=>{
 const row=holding(1,{acquisition:'purchase',sex:'female',source_note:'가상 구입 자료',notes:'라벨 확인',acquired_date:'2026-10-28'})
 assert(holdingMatches(row,'TEST','purchase','owned','female'))
 assert(holdingMatches(row,'라벨','','',''))
 assert(holdingMatches(row,'구입','','',''))
 assert(!holdingMatches(row,'','own_capture','',''))
 assert(!holdingMatches(row,'없음','','',''))
})
