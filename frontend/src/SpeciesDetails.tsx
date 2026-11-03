// 종별 세부 정보를 항목별 태그로 읽고 출처 있는 여러 사례를 편집합니다.
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { SpeciesDetail } from './models'

const categories: Record<SpeciesDetail['category'], string> = {
  host_rearing: '기주식물(사육)', activity: '활동 시간', traits: '관찰된 특징',
  diapause: '월동·휴면', rearing: '사육 환경', breeding: '번식·산란',
  specimen: '표본 제작·보존', memo: '기타 메모',
}
const evidenceLabels: Record<SpeciesDetail['evidence'], string> = {
  field: '야외 관찰', rearing: '사육 기록', literature: '문헌 정리', inferred: '추정',
}
const categoryKeys = Object.keys(categories) as SpeciesDetail['category'][]

export function SpeciesDetails({ entries, legacy, legacySource }: { entries: SpeciesDetail[]; legacy: string; legacySource: string }) {
  if (!entries.length && !legacy) return <span className="catalog-unregistered">미등록</span>
  return <div className="species-details">{categoryKeys.map((category, index) => {
    const items = entries.filter(item => item.category === category)
    const oldText = category === 'memo' ? legacy : ''
    if (!items.length && !oldText) return null
    const preview = items[0] ? `${items[0].title} · ${items[0].body}` : oldText
    return <details key={category} className="species-detail" style={{ '--detail-color': `hsl(45 ${90 - index * 4}% ${88 - index * 2}%)` } as CSSProperties}>
      <summary title={preview.slice(0, 180)}>{categories[category]}{items.length > 1 && ` · ${items.length}`}</summary>
      <div className="species-detail-content">{items.map(item => <article key={item.id}>
        <strong>{item.title}</strong>{item.category !== 'host_rearing' && <><small>{evidenceLabels[item.evidence]}{item.scope && ` · ${item.scope}`}{item.timing && ` · ${item.timing}`}</small>
        <p>{item.body}</p></>}<small className="detail-source">출처 · {item.source}</small>
      </article>)}{oldText && <article><strong>기존 기타 메모</strong><p>{oldText}</p>{legacySource && <small className="detail-source">출처 · {legacySource}</small>}</article>}</div>
    </details>
  })}</div>
}

export function SpeciesDetailsEditor({ value, onChange }: { value: SpeciesDetail[]; onChange: (entries: SpeciesDetail[]) => void }) {
  const [category, setCategory] = useState<SpeciesDetail['category']>('host_rearing')
  const edit = (id: string, next: Partial<SpeciesDetail>) => onChange(value.map(item => item.id === id ? { ...item, ...next } : item))
  return <section className="species-details-editor"><h3>세부 정보</h3>
    <p className="hint">야외 이용과 사육 기록을 구분해 적어 주세요. 자료 발행 시점과 실제 관찰·사육 시점을 함께 적을 수 있습니다.</p>
    <div className="actions"><label>추가할 항목<select value={category} onChange={e => setCategory(e.target.value as SpeciesDetail['category'])}>{categoryKeys.map(key => <option key={key} value={key}>{categories[key]}</option>)}</select></label>
      <button type="button" disabled={value.length >= 100} onClick={() => onChange([...value, { id: crypto.randomUUID(), category, title: category === 'host_rearing' ? '' : categories[category], body: '', source: '', evidence: 'literature', scope: '', timing: '' }])}>항목 추가</button></div>
    {value.map(item => <fieldset key={item.id} className="species-detail-entry"><legend>{categories[item.category]}</legend>
      <div className="field-grid"><label>항목<select value={item.category} onChange={e => edit(item.id, { category: e.target.value as SpeciesDetail['category'] })}>{categoryKeys.map(key => <option key={key} value={key}>{categories[key]}</option>)}</select></label>
        <label>{item.category === 'host_rearing' ? '식물 이름' : '제목'}<input required maxLength={200} value={item.title} onChange={e => edit(item.id, { title: e.target.value })}/></label>
        {item.category !== 'host_rearing' && <><label>근거 유형<select value={item.evidence} onChange={e => edit(item.id, { evidence: e.target.value as SpeciesDetail['evidence'] })}>{Object.entries(evidenceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>적용 범위 · 선택<input maxLength={500} value={item.scope} onChange={e => edit(item.id, { scope: e.target.value })} placeholder="국가·지역·성장 단계 등"/></label>
        <label>자료·관찰 시점 · 선택<input maxLength={500} value={item.timing} onChange={e => edit(item.id, { timing: e.target.value })} placeholder="발행 연도·관찰일·사육 기간 등"/></label></>}</div>
      {item.category !== 'host_rearing' && <label>내용<textarea required maxLength={5000} rows={3} value={item.body} onChange={e => edit(item.id, { body: e.target.value })}/></label>}
      <label>출처·자료 연도<input required maxLength={2000} value={item.source} onChange={e => edit(item.id, { source: e.target.value })}/></label>
      <button type="button" onClick={() => onChange(value.filter(entry => entry.id !== item.id))}>이 항목 제거</button>
    </fieldset>)}
  </section>
}
