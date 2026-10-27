// 기록별 환경 태그를 선택하고 새 이름을 로컬 목록에 기억합니다.
import { useState } from 'react'
import { addTag } from './api'
import type { Tag } from './models'

export default function TagPicker({ label, name, value, onChange, options, onCreated, inherited = [], onBusyChange }: { label: string; name: string; value: string[]; onChange: (names: string[]) => void; options: Tag[]; onCreated: (tag: Tag) => void; inherited?: string[]; onBusyChange: (busy: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const names = [...new Set([...options.map(t => t.name), ...value])]
  const visible = names.filter(tag => tag.toLowerCase().includes(query.trim().toLowerCase()))
  async function create() {
    const next = query.trim()
    if (!next || busy) return
    setBusy(true); setError(''); onBusyChange(true)
    try {
      const tag = await addTag(next)
      onCreated(tag); onChange([...new Set([...value, tag.name])]); setQuery('')
    } catch (e) { setError(e instanceof Error ? e.message : '태그를 기억하지 못했습니다.') }
    finally { setBusy(false); onBusyChange(false) }
  }
  return <details className="tag-picker"><summary>{label} · {value.length}개</summary>
    {value.map(tag => <input type="hidden" key={tag} name={name} value={tag} />)}
    {inherited.length > 0 && <p className="hint">조사 공통에서 적용: {inherited.join(', ')}</p>}
    <div className="tag-create"><label>{label} 찾기·추가<input value={query} maxLength={60} onChange={e => setQuery(e.target.value)} placeholder="목록 검색 또는 새 이름" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void create() } }} /></label><button type="button" disabled={busy || !query.trim()} onClick={() => void create()}>{busy ? '추가 중…' : '태그 추가'}</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="tag-options">{visible.map(tag => <label className="check" key={tag}><input type="checkbox" checked={value.includes(tag)} onChange={e => onChange(e.target.checked ? [...value, tag] : value.filter(n => n !== tag))} />{tag}</label>)}{!visible.length && <p className="hint">일치하는 태그가 없습니다. 직접 추가할 수 있습니다.</p>}</div>
    <p className="hint">새 이름은 목록에 기억됩니다. 기록을 취소해도 목록에 남습니다. 미선택은 조건이 없었다는 뜻이 아닙니다.</p>
  </details>
}
