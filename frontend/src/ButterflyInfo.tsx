// 나비 기본 정보 등록·검색과 기존 출현·분포 참고자료 편집을 연결합니다.
import { useState } from 'react'
import type { FormEvent } from 'react'
import { addSpecies, getReference } from './api'
import type { Species, ReferenceDocument } from './models'
import ReferenceEditor from './ReferenceEditor'
export default function ButterflyInfo({ species, onCreated, onUpdated, onEditing }: { species: Species[]; onCreated: (s: Species) => void; onUpdated: (s: Species) => void; onEditing: (v: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<{ species: Species; document: ReferenceDocument } | null>(null)
  async function open(s: Species) {
    setBusy(true); setError(''); onEditing(true)
    try { setEditing({ species: s, document: await getReference(s.id) }) }
    catch (e) { onEditing(false); setError(e instanceof Error ? e.message : '기본 정보를 읽지 못했습니다.') }
    finally { setBusy(false) }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return
    const form = e.currentTarget, data = new FormData(form)
    setBusy(true); setError(''); setNotice('')
    try {
      const s = await addSpecies(String(data.get('korean_name') || ''), String(data.get('scientific_name') || ''))
      onCreated(s); form.reset(); setQuery(''); setNotice(`${s.korean_name} 기본 항목을 등록했습니다. 출현 기간과 분포 등은 기본 정보 편집에서 입력하세요.`)
    } catch (e) { setError(e instanceof Error ? e.message : '종 등록에 실패했습니다.') }
    finally { setBusy(false) }
  }
  if (editing) return <ReferenceEditor species={editing.species} initial={editing.document} onClose={() => { setEditing(null); onEditing(false) }} onSaved={reference => { onUpdated({ ...editing.species, host_plants: reference.host_plants }); setEditing(null); onEditing(false); setNotice('나비 기본 정보를 저장했습니다.') }} />
  const filtered = species.filter(s => `${s.korean_name} ${s.scientific_name || ''}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="butterfly-info"><h2>나비 기본 정보</h2><p className="hint">국명·학명과 종의 성충 출현 기간, 분포, 미접 목격 연도 및 출처를 관리합니다. 현장에서 남긴 조사·관찰 기록과 구분됩니다.</p>
    <form onSubmit={create} className="species-create"><fieldset disabled={busy}><div className="field-grid"><label>국명<input name="korean_name" required maxLength={100} /></label><label>학명 · 선택<input name="scientific_name" maxLength={200} /></label></div><button className="primary">나비 등록</button></fieldset></form>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <label>기본 정보 검색<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="국명 또는 학명" /></label>
    <div className="table-wrap"><table><thead><tr><th>국명</th><th>학명</th><th>기본 정보</th><th>기주식물</th></tr></thead><tbody>{filtered.map(s => <tr key={s.id}><td>{s.korean_name}</td><td>{s.scientific_name || '미등록'}</td><td><button disabled={busy} onClick={() => void open(s)}>기본 정보 편집</button></td><td>{s.host_plants || '미등록'}</td></tr>)}</tbody></table></div>
    {!filtered.length && <p className="empty">{species.length ? '검색 결과가 없습니다.' : '먼저 나비 이름을 등록하고 출현·분포 정보를 채워 주세요.'}</p>}
  </section>
}
