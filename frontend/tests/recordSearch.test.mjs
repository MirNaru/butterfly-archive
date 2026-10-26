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

test('직접·간접 관찰 출처 필터와 빈 조사 구분', () => {
 const direct = { ...row, record: { ...row.record, source_type: 'direct' } }
 const indirect = { ...row, record: { ...row.record, source_type: 'indirect' } }
 assert(matches(direct, { ...emptyFilters(), source: ['direct'] }, ''))
 assert(!matches(indirect, { ...emptyFilters(), source: ['direct'] }, ''))
 assert(matches(indirect, { ...emptyFilters(), source: ['direct', 'indirect'] }, ''))
 assert(!emptySurveyMatches(survey, { ...emptyFilters(), source: ['direct'] }, ''))
})

const reference = (id, values = {}) => ({ id, korean_name: `시험 종 ${id}`, scientific_name: `Test species ${id}`, active: true, days_left: 4, year_round: false, region_match: true, old_vagrant: false, capture_history: 'not_captured', permission: 'unknown', reference: { north_only: null, protected: null }, ...values })
const { emptyTargets, targetMatches, referenceCandidates, sortEntries } = await import('../src/recordSearch.ts')

test('종 참고 행은 원래 기록의 필터 탈락을 대신하지 않음', () => {
 const refs = [reference(1), reference(2)]
 const stored = [{ ...row, record: { ...row.record, species_id: 1 } }]
 const targets = emptyTargets()
 assert.deepEqual(referenceCandidates(refs, stored, emptyFilters(), targets, '').map(r => r.id), [2])
 assert.equal(referenceCandidates(refs, stored, { ...emptyFilters(), start: '2026-01-01' }, targets, '').length, 0)
 assert.equal(referenceCandidates(refs, stored, { ...emptyFilters(), source: ['indirect'] }, targets, '').length, 0)
 assert.equal(referenceCandidates(refs, stored, { ...emptyFilters(), weather: 'none' }, targets, '').length, 0)
 assert.equal(referenceCandidates(refs, stored, emptyFilters(), { ...targets, includeUnrecorded: false }, '').length, 0)
 assert.equal(referenceCandidates(refs, stored, emptyFilters(), targets, 'species 2').length, 1)
})

test('탐사 조건에서 미확인을 임의의 확정값으로 취급하지 않음', () => {
 const targets = { ...emptyTargets(), active: true, captured: true, north: true, old: true, protected: true }
 assert(targetMatches(reference(1), targets))
 assert(!targetMatches(reference(1, { active: null }), targets))
 assert(!targetMatches(reference(1, { capture_history: 'captured' }), targets))
 assert(!targetMatches(reference(1, { old_vagrant: true }), targets))
 assert(!targetMatches(reference(1, { region_match: false }), targets))
 assert(!targetMatches(reference(1, { reference: { north_only: true, protected: null } }), targets))
})

test('통합 표는 분류 순서와 같은 종의 여러 관찰을 유지하고 미상 일수를 뒤에 둠', () => {
 const records = [{ kind: 'record', row: { ...row, record: { ...row.record, species_id: 1 } } }, { kind: 'record', row: { ...row, record: { ...row.record, id: 2, species_id: 1, effective_date: '2026-10-26' } } }]
 const refs = [reference(1), reference(2, { days_left: null }), reference(3, { days_left: 1 })]
 const entries = [...records, ...refs.slice(1).map(r => ({ kind: 'reference', reference: r }))]
 const byId = new Map(refs.map(r => [r.id, r]))
 const ranks = new Map([[2, 0], [1, 1], [3, 2]])
 const ordered = sortEntries(entries, byId, ranks, 'classification', 'asc')
 assert.equal(ordered[0].reference.id, 2)
 assert.equal(ordered[1].row.record.id, 2)
 assert.equal(ordered[2].row.record.id, 1)
 for (const direction of ['asc', 'desc']) assert.equal(sortEntries(entries, byId, ranks, 'days', direction).at(-1).reference.id, 2)
 assert.equal(sortEntries(entries, byId, ranks, 'days', 'asc')[0].reference.id, 3)
})
