// 기록별 환경 태그를 선택하고 새 이름을 로컬 목록에 기억합니다.
import { useState } from 'react'
import { addTag, moveTag } from './api'
import type { Tag } from './models'

export default function TagPicker({ label, name, value, onChange, options, onCreated, inherited = [], onBusyChange, category = 'environment' }: { category?:'environment'|'individual'; label: string; name: string; value: string[]; onChange: (names: string[]) => void; options: Tag[]; onCreated: (tag: Tag) => void; inherited?: string[]; onBusyChange: (busy: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const names = [...new Set([...options.map(t => t.name), ...value])]
  const matchesCategory = (name:string) => (options.find(t=>t.name===name)?.category || 'environment') === category
  const picked = value.filter(matchesCategory)
  const inheritedHere=inherited.filter(matchesCategory)
  const visible = names.filter(matchesCategory).filter(tag => tag.toLowerCase().includes(query.trim().toLowerCase()))
  async function create() {
    const next = query.trim()
    if (!next || busy) return
    setBusy(true); setError(''); onBusyChange(true)
    try {
      const tag = await addTag(next,category)
      onCreated(tag); onChange([...new Set([...value, tag.name])]); setQuery('')
    } catch (e) { setError(e instanceof Error ? e.message : '태그를 기억하지 못했습니다.') }
    finally { setBusy(false); onBusyChange(false) }
  }
  return <details className="tag-picker"><summary>{label} · {picked.length}개</summary>
    {picked.map(tag => <input type="hidden" key={tag} name={name} value={tag} />)}
    {inheritedHere.length > 0 && <p className="hint">탐사 공통에서 적용: {inheritedHere.join(', ')}</p>}
    <div className="tag-create"><label>{label} 찾기·추가<input value={query} maxLength={60} onChange={e => setQuery(e.target.value)} placeholder="목록 검색 또는 새 이름" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void create() } }} /></label><button type="button" disabled={busy || !query.trim()} onClick={() => void create()}>{busy ? '추가 중…' : '태그 추가'}</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="tag-options">{visible.map(tag => <div className="tag-choice" key={tag}><label className="check"><input type="checkbox" checked={value.includes(tag)} onChange={e => onChange(e.target.checked ? [...value, tag] : value.filter(n => n !== tag))} />{tag}</label>{options.find(t=>t.name===tag) && <button type="button" title="기존 연결을 유지하며 모든 기록에서 이 태그의 분류를 변경합니다" disabled={busy} onClick={async()=>{setBusy(true);onBusyChange(true);try{onCreated(await moveTag(options.find(t=>t.name===tag)!.id,category==='environment'?'individual':'environment'))}catch(e){setError(e instanceof Error?e.message:'태그 분류 변경 실패')}finally{setBusy(false);onBusyChange(false)}}}>{category==='environment'?'개체로 이동':'환경으로 이동'}</button>}</div>)}{!visible.length && <p className="hint">일치하는 태그가 없습니다. 직접 추가할 수 있습니다.</p>}</div>
    <p className="hint">새 이름은 목록에 기억됩니다. 기록을 취소해도 목록에 남습니다. 미선택은 조건이 없었다는 뜻이 아닙니다.</p>
  </details>
}
