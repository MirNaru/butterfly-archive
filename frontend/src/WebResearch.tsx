// Gemini 검색 결과를 표시하고 직접 확인한 웹 원문을 검수 대기함에 저장합니다.
import { useEffect, useState, type FormEvent } from 'react'
import type { Species } from './models'
import { listWebSources, researchStatus, saveWebSource, searchWeb, type GroundedSearch, type WebSource } from './api'

export default function WebResearch({ species, revision, onRegister }: {
  species: Species[]; revision: number; onRegister: (source: WebSource) => void
}) {
  const [ready, setReady] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<GroundedSearch | null>(null)
  const [page, setPage] = useState(0)
  const [reload, setReload] = useState(0)
  const [sources, setSources] = useState<{items: WebSource[]; total: number}>({items:[], total:0})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    researchStatus().then(value => { if (active) { setReady(value.gemini_ready); setRemaining(value.remaining) } })
      .catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    listWebSources(page).then(value => { if (active) setSources(value) })
      .catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [page, revision, reload])

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.confirm('공개 자료 검색어를 Google Gemini에 전송합니다. 검색어에 개인 정보나 비공개 위치를 포함하지 마세요. 전송하시겠습니까?')) return
    setBusy(true); setError(''); setResult(null)
    try { setResult(await searchWeb(query.trim())) }
    catch (e) { setError(e instanceof Error ? e.message : '검색에 실패했습니다.') }
    finally { setBusy(false); void researchStatus().then(value => setRemaining(value.remaining)).catch(() => {}) }
  }

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true); setError(''); setNotice('')
    try {
      const saved = await saveWebSource({title: String(data.get('title')), url: String(data.get('url')), species_id: Number(data.get('species')) || null})
      setNotice(saved.duplicate ? '같은 주소와 종이 이미 보관되어 있습니다.' : '원문을 검수 대기함에 저장했습니다.')
      form.reset(); setPage(0); setReload(n => n + 1)
    } catch (e) { setError(e instanceof Error ? e.message : '원문을 저장하지 못했습니다.') }
    finally { setBusy(false) }
  }

  return <section className="paper-browser">
    <form className="paper-control-row" onSubmit={runSearch}>
      <label>공개 자료 검색<input value={query} onChange={e => setQuery(e.target.value)} minLength={2} maxLength={300} required /></label>
      <button disabled={!ready || remaining === 0 || busy || query.trim().length < 2}>Gemini 검색</button>
    </form>
    {ready && remaining !== null && <p className="hint">오늘 앱의 Gemini 호출 {remaining}회 남음</p>}
    {!ready && <p className="hint">Gemini 무료 프로젝트 설정 후 검색할 수 있습니다. 원문 주소는 직접 보관할 수 있습니다.</p>}
    {result && <section aria-label="Gemini 검색 결과">
      <p className="memo">{result.answer}</p>
      <ul>{result.links.map((item, index) => <li key={index}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || '원문 열기'}</a></li>)}</ul>
      <iframe title="Google 검색 제안" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
        srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><base target="_blank">${result.entry}`} />
    </section>}
    <h3>확인한 웹 원문 보관</h3>
    <form className="paper-control-row" onSubmit={saveSource}>
      <label>원문 주소<input type="url" name="url" required maxLength={1000} /></label>
      <label>원문 제목<input name="title" required maxLength={300} /></label>
      <label>관련 종<select name="species"><option value="">미지정</option>{species.map(item => <option key={item.id} value={item.id}>{item.korean_name}</option>)}</select></label>
      <button disabled={busy}>대기함에 보관</button>
    </form>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <h3>웹 자료 대기함 · {sources.total}건</h3>
    {sources.items.map(source => <article className="toolbar" key={source.id}>
      <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
      <small>{source.species_name || '종 미지정'} · {new Date(source.saved_at).toLocaleDateString('ko-KR')} · 등록 {source.registered_count}건</small>
      <button type="button" onClick={() => onRegister(source)}>간접 관찰 등록</button>
    </article>)}
    <div className="toolbar">
      <button disabled={page === 0} onClick={() => setPage(n => n - 1)}>이전</button>
      <button disabled={(page + 1) * 25 >= sources.total} onClick={() => setPage(n => n + 1)}>다음</button>
    </div>
  </section>
}
