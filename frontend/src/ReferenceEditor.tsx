// 종의 출처 있는 참고자료를 입력합니다. 소장 여부를 채집 사실로 바꾸지 않습니다.
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ReferenceDocument, Species, SpeciesReference } from './models'
import { saveReference } from './api'
import LifeCycleEditor from './LifeCycleEditor'
const slotName = (n: number) => `${Math.floor((n - 1) / 3) + 1}월 ${['상순', '중순', '하순'][(n - 1) % 3]}`
export default function ReferenceEditor({ species, initial, onClose, onSaved, onBusyChange }: { species: Species; initial: ReferenceDocument; onClose: () => void; onSaved: (reference: SpeciesReference) => void; onBusyChange?: (busy: boolean) => void }) {
  const [value, setValue] = useState(initial.reference)
  const [years, setYears] = useState(value.sighting_years.join(', '))
  const [regions, setRegions] = useState(value.regions.join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function update<K extends keyof SpeciesReference>(key: K, next: SpeciesReference[K]) { setValue(v => ({ ...v, [key]: next })) }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    const parts = years.trim() ? years.split(/[,\s]+/).filter(Boolean) : []
    if (parts.some(p => !/^\d{4}$/.test(p))) { setError('목격 연도는 네 자리 숫자로 입력해 주세요.'); return }
    setBusy(true); onBusyChange?.(true)
    try { const saved = await saveReference(species.id, { ...value, regions: regions.split(',').map(s => s.trim()).filter(Boolean), sighting_years: [...new Set(parts.map(Number))] }, initial.updated_at); onSaved(saved.reference) }
    catch (e) { setError(e instanceof Error ? e.message : '참고자료 저장에 실패했습니다.') }
    finally { setBusy(false); onBusyChange?.(false) }
  }
  const text = (key: 'source' | 'capture_source' | 'protection_source' | 'permission_region' | 'permission_source' | 'ecology_source', label: string) => <label>{label}<input value={value[key]} maxLength={key === 'source' || key === 'ecology_source' ? 2000 : key === 'permission_region' ? 100 : 1000} onChange={e => update(key, e.target.value)} /></label>
  const day = (key: 'protection_checked' | 'permission_start' | 'permission_end', label: string) => <label>{label}<input type="date" value={value[key] || ''} onChange={e => update(key, e.target.value || null)} /></label>
  const flag = (key: 'vagrant' | 'north_only' | 'protected', label: string) => <label>{label}<select value={value[key] === null ? '' : String(value[key])} onChange={e => update(key, e.target.value === '' ? null : e.target.value === 'true')}><option value="">미확인</option><option value="true">예</option><option value="false">아니요</option></select></label>
  return <form className="survey-form reference-editor" onSubmit={submit}><h2>{species.korean_name} · 나비 기본 정보</h2><p className="hint">실제 관찰 기록과 별도로 저장합니다. 구매 소장은 채집 이력이 아닙니다. 모르는 정보는 미확인으로 남겨 주세요.</p>{error && <p className="error" role="alert">{error}</p>}<fieldset disabled={busy}>
    {(value.family || value.subfamily) && <p className="hint">분류: {value.family || '과 미확인'} / {value.subfamily || '아과 미확인'}<br />분류·표시 순서 출처: {value.taxonomy_source}</p>}
    <h3>기주식물</h3><label>기주식물<textarea value={value.host_plants} maxLength={5000} rows={2} onChange={e => update('host_plants', e.target.value)} /></label><label>기주식물 자료 출처<input value={value.host_plants_source} maxLength={2000} onChange={e => update('host_plants_source', e.target.value)} /></label>
    <div className="field-grid">{(['habitat', 'habits', 'other_notes'] as const).map(key => <label key={key}>{({ habitat: '서식지', habits: '습성', other_notes: '기타' })[key]}<textarea value={value[key]} rows={2} maxLength={5000} onChange={e => update(key, e.target.value)} /></label>)}</div>{text('ecology_source', '서식지·습성·기타 자료 출처')}
    <LifeCycleEditor value={value.lifecycle} onChange={next => update('lifecycle', next)} history={initial.lifecycle_history || []} />
    <details><summary>기존 성충 출현 참고 기간</summary><p className="hint">기존 36구간 자료입니다. 새 한살이 성충 구간이 없을 때만 성충 그림과 탐사 계산에 사용합니다. 상순 1~10일 · 중순 11~20일 · 하순 21일~월말입니다.</p>
    {value.periods.map((p, index) => <div className="period-input" key={index}>{(['start', 'end'] as const).map(key => <label key={key}>{key === 'start' ? '시작 구간' : '끝 구간'}<select value={p[key]} onChange={e => update('periods', value.periods.map((x, i) => i === index ? { ...x, [key]: Number(e.target.value) } : x))}>{Array.from({ length: 36 }, (_, i) => <option value={i + 1} key={i}>{slotName(i + 1)}</option>)}</select></label>)}<button type="button" onClick={() => update('periods', value.periods.filter((_, i) => i !== index))}>구간 제거</button></div>)}
    <button type="button" disabled={value.periods.length >= 36} onClick={() => update('periods', [...value.periods, { start: 1, end: 1 }])}>출현 구간 추가</button>
    </details>
    <label>분포 지역 · 쉼표로 구분<input value={regions} onChange={e => setRegions(e.target.value)} /></label>
    <div className="field-grid">{flag('north_only', '북한에만 분포')}{flag('vagrant', '미접 여부')}</div>
    <label>확인된 목격 연도 · 쉼표로 구분<input value={years} onChange={e => setYears(e.target.value)} placeholder="2008, 2025" /></label>{text('source', '출현·분포·목격 자료 출처')}
    <h3>과거 채집 확인</h3><label>채집 이력<select value={value.capture_history} onChange={e => update('capture_history', e.target.value as SpeciesReference['capture_history'])}><option value="unknown">미확인</option><option value="captured">채집한 적 있음</option><option value="not_captured">채집한 적 없음 · 사용자 확인</option></select></label>{text('capture_source', '채집 여부 확인 근거')}<p className="hint">앱에 실제 채집 기록이 있으면 채집한 종으로 표시합니다.</p>
    <h3>보호종 참고 정보</h3>{flag('protected', '국가보호종 해당')}{text('protection_source', '보호종 정보 출처')}{day('protection_checked', '보호종 정보 확인일')}
    <details><summary>지역·기간별 채집 가능 여부 확인</summary><p className="hint">사용자가 확인한 근거를 기록합니다. 보호종 제외만으로 채집 가능을 판단하지 않습니다. 목표 지역과 정확히 일치하고 적용 기간 안에 있을 때만 비율에 반영합니다.</p>
      <label>채집 가능 판단<select value={value.permission} onChange={e => update('permission', e.target.value as SpeciesReference['permission'])}><option value="unknown">미확인</option><option value="permitted">가능 · 사용자 확인</option><option value="prohibited">불가 · 사용자 확인</option></select></label>
      {text('permission_region', '판단 대상 지역')}{day('permission_start', '적용 시작일')}{day('permission_end', '적용 종료일')}{text('permission_source', '확인 근거·조건')}
    </details><div className="actions"><button className="primary" disabled={busy}>기본 정보 저장</button><button type="button" onClick={onClose}>닫기 · 입력 취소</button></div>
  </fieldset></form>
}
