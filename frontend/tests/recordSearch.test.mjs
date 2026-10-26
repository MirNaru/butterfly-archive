// 개별 기록 필터와 표 정렬을 외부 요청 없이 검사합니다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyFilters, matches, emptySurveyMatches, sortRows, rowsFor } from '../src/recordSearch.ts'
const survey = { id: 1, survey_date: '2026-10-26', place_name: '조사 장소', notes: '조사 메모', latitude: 37, longitude: 127, observations: [] }
const row = { survey, scientificName: 'Test species', record: { id: 1, species_id: 1, species_name: '시험 나비', effective_date: '2026-10-25', observation_time: null, effective_place: '개별 장소', effective_latitude: null, effective_longitude: null, notes: '종별 메모', stage: 'adult', sex: 'female', result: 'observed', capture_status: 'captured', count: null } }
test('학명·메모 검색과 개별 날짜·장소 기준', () => {
 assert(matches(row, emptyFilters(), 'TEST Species'))
 assert(matches(row, emptyFilters(), '종별 메모'))
 assert(matches(row, { ...emptyFilters(), start: '2026-10-25', end: '2026-10-25', place: '개별' }, ''))
 assert(!matches(row, { ...emptyFilters(), start: '2026-10-26' }, ''))
 assert(!matches(row, { ...emptyFilters(), start: '2026-10-26', end: '2026-10-24' }, ''))
})
test('항목간 AND, 항목내 OR, 미발견 단계 제외', () => {
 const filter = { ...emptyFilters(), species: ['1','2'], stage: ['adult','larva'], capture: ['captured'] }
 assert(matches(row, filter, ''))
 assert(!matches({ ...row, record: { ...row.record, result: 'not_found' } }, filter, ''))
 assert(!matches(row, { ...filter, sex: ['male'] }, ''))
})
test('기상·좌표·시각 미상과 빈 조사 구분', () => {
 assert(matches(row, { ...emptyFilters(), weather: 'none', coordinates: 'no', time: 'no' }, ''))
 assert(matches({ ...row, weather: { weather: { stale: true } } }, { ...emptyFilters(), weather: 'stale' }, ''))
 assert(emptySurveyMatches(survey, emptyFilters(), '조사 메모'))
 assert(!emptySurveyMatches(survey, { ...emptyFilters(), result: ['not_found'] }, ''))
})
test('미상 수량은 정렬 방향과 무관하게 마지막', () => {
 const known = { ...row, record: { ...row.record, id: 2, count: 3 } }
 for(const dir of ['asc','desc']) assert.equal(sortRows([row,known], 'count', dir)[1].record.id, 1)
})
test('같은 조사에서 조건에 맞는 기록만 표·지도 원본에 남음', () => {
 const s = { ...survey, observations: [row.record, { ...row.record, id: 2, capture_status: 'not_captured' }] }
 const result = rowsFor([s], [{ id: 1, scientific_name: 'Test species' }], {}).filter(r => matches(r, { ...emptyFilters(), capture: ['captured'] }, ''))
 assert.deepEqual(result.map(r => r.record.id), [1])
})
