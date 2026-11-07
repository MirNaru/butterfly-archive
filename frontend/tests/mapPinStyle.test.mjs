// 직접 관찰 핀과 같은 좌표의 선택 순서가 다른 출처보다 앞서는지 확인합니다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { pinAppearance, directPinsFirst } from '../src/mapPinStyle.ts'

test('직접 관찰을 포함한 핀은 모든 간접 관찰 핀보다 위에 표시', () => {
  const direct=pinAppearance(['direct'])
  const mixed=pinAppearance(['naturing','direct','inaturalist'])
  for (const sources of [['naturing'],['inaturalist'],['other'],['naturing','inaturalist']]) {
    assert(direct.zIndex>pinAppearance(sources).zIndex)
    assert(mixed.zIndex>pinAppearance(sources).zIndex)
  }
  assert(mixed.title.includes('직접 관찰') && mixed.title.includes('네이처링') && mixed.title.includes('iNaturalist'))
  assert.equal(pinAppearance(['direct','naturing']).signature,pinAppearance(['naturing','direct']).signature)
})

test('같은 위치에서 직접 관찰을 우선 선택하고 나머지 순서와 원본은 보존', () => {
  const pins=[{id:1,source:'naturing'},{id:2,source:'direct'},{id:3,source:'inaturalist'},{id:4,source:'direct'}]
  assert.deepEqual(directPinsFirst(pins).map(p=>p.id),[2,4,1,3])
  assert.deepEqual(pins.map(p=>p.id),[1,2,3,4])
  assert.equal(directPinsFirst([{id:1,source:'other'},{id:2}])[0].id,2)
})
