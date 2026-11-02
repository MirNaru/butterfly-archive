// 상태 요약에서 알려진 연도와 지역, 미확인을 혼동하지 않는지 검증합니다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { speciesStatuses } from '../src/speciesStatus.ts'
const reference = { protections: [], protected: null, protection_review: '', vagrant: null, north_only: null, sighting_years: [], source: '시험 출처' }
test('지역·최신 목격 연도·북한 서식과 출처 표시', () => {
  const badges = speciesStatuses({ ...reference, protections: [{ kind: 'regional', region: '경기도', designation: '', source: '가상 지정', checked: '2026-10-27' }], vagrant: true, sighting_years: [2025, 2008, 2025], north_only: true })
  assert.deepEqual(badges.map(b => b.label), ['지역보호[경기도]', '미접[2025]', '북한 서식'])
  assert(badges[0].detail.includes('가상 지정'))
  assert(badges[1].detail.includes('마지막 목격 연도로 단정하지 않습니다'))
})
test('국가 지정 중복 요약 방지와 미확인 보존', () => {
  assert.deepEqual(speciesStatuses(reference), [])
  const badges = speciesStatuses({ ...reference, protected: true, protections: [{ kind: 'monument', designation: '458호', source: '시험 자료', checked: '2026-10-27' }], vagrant: true, protection_review: '과거 자료 확인 필요' })
  assert.deepEqual(badges.map(b => b.label), ['천연기념물[458호]', '보호정보 확인 필요', '미접[연도 미상]'])
})
test('절멸 표시는 국내 기준과 사용자 출처를 보존', () => {
  const badges = speciesStatuses({ ...reference, domestic_extinct: true, extinction_source: '사용자 지정 · 시험 근거' })
  assert.equal(badges[0].label, '절멸')
  assert(badges[0].detail.includes('국내 기준'))
  assert(badges[0].detail.includes('사용자 지정'))
})
