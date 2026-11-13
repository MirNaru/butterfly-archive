// 논문 서지 수집과 원문 확인, 논문 사례의 간접 관찰 등록 진입을 제공합니다.
import { useEffect, useState } from 'react'
import type { Species } from './models'
import { listPapers, paperStatus, refreshPapers, uploadPaperPdf, paperPdfText, organizePaper, researchStatus, extractBibliography, type Paper, type PaperQuery, type PaperRecommendation } from './api'

export default function PaperBrowser({ species, revision, onRegister }: { species: Species[]; revision: number; onRegister: (paper: Paper) => void }) {
  const [provider, setProvider] = useState<PaperQuery['provider'] | 'pdf'>('all')
  const [topic, setTopic] = useState<PaperQuery['topic']>('latest')
  const [query, setQuery] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [tag, setTag] = useState('')
  const [geminiReady, setGeminiReady] = useState(false)

  async function organize(paper: Paper, starred: boolean, tags: string[]) {
    setBusy(true); setError('')
    try { await organizePaper(paper.id, starred, tags); setReload(n => n + 1) }
    catch (e) { setError(e instanceof Error ? e.message : '논문 분류를 저장하지 못했습니다.') }
    finally { setBusy(false) }
  }

  async function extract(fileId: number) {
    if (!window.confirm('공개 PDF 첫 두 쪽의 텍스트를 최대 12,000자까지 Gemini에 전송합니다. 추출한 값은 이 논문의 서지 정보에 자동 저장됩니다. 무료 서비스 입력은 제품 개선에 사용될 수 있습니다. 진행하시겠습니까?')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await extractBibliography(fileId)
      setReload(n => n + 1)
      const labels: Record<string,string> = {title:'제목',authors:'저자',journal:'학술지',published:'발표일',doi:'DOI'}
      setNotice(result.updated.length ? ['서지 정보를 저장했습니다.', ...Object.entries(result.changes ?? {}).map(([field, value]) =>
        (labels[field] ?? field) + ' · ' + (value.before || '미기재') + ' → ' + value.after)].join('\n') : '새로 반영할 서지 정보가 없습니다.')
    } catch (e) { setError(e instanceof Error ? e.message : '서지 정보를 추출하지 못했습니다.') }
    finally { setBusy(false) }
  }
  const [speciesId, setSpeciesId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [language, setLanguage] = useState('preferred')
  const [remotePage, setRemotePage] = useState(1)
  const [page, setPage] = useState(0)
  const [items, setItems] = useState<Paper[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loadedKey, setLoadedKey] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [kciReady, setKciReady] = useState(false)
  const [reload, setReload] = useState(0)
  const [pdfs, setPdfs] = useState<File[]>([])
  const [pdfText, setPdfText] = useState<Record<number, string[]>>({})
  async function addPdfs() {
    if (!pdfs.length) return
    setBusy(true); setError(''); setNotice('')
    let added = 0, duplicate = 0
    try {
      for (const file of pdfs) {
        const result = await uploadPaperPdf(file)
        if (result.duplicate) duplicate++; else added++
      }
      setProvider('pdf'); setStart(''); setEnd(''); setTopic('latest'); setLanguage('all'); setQuery(''); setSpeciesId(''); setPage(0)
      setNotice(`PDF 추가 ${added}편 · 기존 파일 ${duplicate}편. 서지정보는 파일명·첫 쪽 DOI 기준입니다. 원문을 확인해 주세요. 관찰 사례는 자동 등록되지 않습니다.`)
    } catch (e) { setError(`${added}편 추가 · 기존 ${duplicate}편 확인 후 중단했습니다. ${e instanceof Error ? e.message : 'PDF 추가에 실패했습니다.'}`) }
    finally { setReload(n => n + 1); setBusy(false) }
  }
  async function readPdf(id: number) {
    if (pdfText[id]) return
    try { const result = await paperPdfText(id); setPdfText(old => ({...old, [id]:result.pages})) }
    catch (e) { setError(e instanceof Error ? e.message : 'PDF 텍스트를 읽지 못했습니다.') }
  }
  useEffect(() => {
    let active = true
    researchStatus().then(s => { if (active) setGeminiReady(s.gemini_ready) }).catch(() => {})
    paperStatus().then(s => { if (active) setKciReady(s.kci_ready) }).catch(() => { if (active) setKciReady(false) })
    return () => { active = false }
  }, [])
  const requestKey = `${page}:${topic}:${language}:${revision}:${reload}:${query}:${speciesId}:${start}:${end}:${provider}:${favorite}:${tag}`
  const loading = loadedKey !== requestKey
  useEffect(() => {
    let active = true
    listPapers(page * 25, query, topic, language, speciesId, start, end, provider, favorite, tag).then(result => {
      if (!active) return
      const last = Math.max(0, Math.ceil(result.total / 25) - 1)
      if (page > last) { setPage(last); return }
      setItems(result.items); setTotal(result.total); setError('')
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '논문 목록을 읽지 못했습니다.') })
      .finally(() => { if (active) setLoadedKey(requestKey) })
    return () => { active = false }
  }, [page, topic, language, revision, reload, requestKey, query, speciesId, start, end, provider, favorite, tag])
  function changed() { setRemotePage(1); setNotice('') }
  const [recommendations, setRecommendations] = useState<PaperRecommendation[]>([])
  const [recommendationBasis, setRecommendationBasis] = useState('')
  async function refresh(preview = false) {
    if (provider === 'pdf') return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await refreshPapers({ provider, topic, query, species_id: speciesId ? Number(speciesId) : null, start: start || null, end: end || null, page: preview ? 1 : remotePage, preview })
      setNotice(`검색 ${result.received} · 신규 ${result.created} · 기존 ${result.duplicate} · 관련 조건 제외 ${result.excluded}건\n${result.warnings.join('\n')}`)
      if (preview) {
        setRecommendations(result.recommendations ?? [])
        setRecommendationBasis([species.find(item => item.id === Number(speciesId))?.korean_name || '나비 전체', {latest:'최신 논문',new_record:'국내 미기록종',rearing:'사육·기주식물·생태'}[topic],query.trim()].filter(Boolean).join(' · '))
      } else { setReload(n => n + 1); setPage(0) }
    } catch (e) { setError(e instanceof Error ? e.message : '논문을 가져오지 못했습니다.') }
    finally { setBusy(false) }
  }
  const disabled = busy || loading
  return <section className="paper-browser">
    <details className="paper-controls"><summary>논문 검색·가져오기</summary>
      <p className="hint">논문 갱신을 누르면 검색 조건에 맞는 자료를 가져옵니다. Crossref는 키 없이 사용할 수 있고 KCI는 선택 연동입니다.</p>
      <fieldset disabled={busy} className="paper-fields">
        <div className="paper-control-row">
          <label>수집처<select value={provider} onChange={e => { setProvider(e.target.value as typeof provider); changed() }}><option value="all">전체 · API + PDF</option><option value="crossref">Crossref · 키 불필요</option><option value="kci" disabled={!kciReady}>KCI{kciReady ? '' : ' · 키 설정 필요'}</option><option value="pdf">직접 추가 PDF</option></select></label>
          <label>주제<select value={topic} onChange={e => { setTopic(e.target.value as PaperQuery['topic']); setPage(0); changed() }}><option value="latest">최신 나비 논문</option><option value="new_record">국내 미기록종 관련 후보</option><option value="rearing">사육·기주식물·생태</option></select></label>
          <label>종 · 선택<select value={speciesId} onChange={e => { setSpeciesId(e.target.value); changed() }}><option value="">나비 전체</option>{species.map(s => <option key={s.id} value={s.id}>{s.korean_name}</option>)}</select></label>
          <label>추가 검색어<input maxLength={200} value={query} onChange={e => { setQuery(e.target.value); changed() }} placeholder="예: diapause, 월동" /></label>
        </div>
        <div className="paper-control-row">
          <label>발표 시작일 · 선택<input type="date" value={start} onChange={e => { setStart(e.target.value); changed() }} /></label><label>발표 종료일 · 선택<input type="date" value={end} onChange={e => { setEnd(e.target.value); changed() }} /></label>
          <label>목록 언어<select value={language} onChange={e => { setLanguage(e.target.value); setPage(0) }}><option value="preferred">한국어·영어·미상</option><option value="ko">한국어</option><option value="en">영어</option><option value="all">전체</option></select></label>
          <label>가져올 검색 페이지<input type="number" min={1} max={100} value={remotePage} onChange={e => setRemotePage(Number(e.target.value))} /></label>
          <button type="button" disabled={provider === 'pdf' || !!(start && end && start > end) || remotePage < 1 || remotePage > 100 || !Number.isInteger(remotePage)} onClick={() => void refresh()}>논문 갱신</button>
          <button type="button" disabled={provider === 'pdf' || !!(start && end && start > end)} onClick={() => void refresh(true)}>추천 후보 보기</button>
        </div>
      </fieldset>
      <p className="hint">과거 자료는 시작일을 비워 검색합니다. 수집처별 최대 50건씩 확인하며 검색 페이지를 바꿔 더 가져올 수 있습니다. 국내 미기록종 관련 자료는 원문 확인이 필요한 후보입니다.</p>
      <div className="paper-pdf-upload"><label>PDF 직접 추가<input type="file" accept=".pdf,application/pdf" multiple disabled={busy} onChange={e => setPdfs(Array.from(e.target.files || []))} /></label><button type="button" disabled={busy || !pdfs.length} onClick={() => void addPdfs()}>PDF 추가</button><small>파일당 20MB · 로컬 보관 · 관찰 사례는 원문 확인 후 등록</small></div>
      {!geminiReady && <p className="hint">Gemini 미설정 · 공개 PDF 서지 추출은 무료 프로젝트 설정 후 사용할 수 있습니다.</p>}
      {!kciReady && <p className="hint">KCI는 미설정입니다. Crossref는 신청 없이 바로 사용할 수 있습니다.</p>}
    </details>
    <div className="toolbar"><h3>수집 논문 · {total}건</h3>
      <label><input type="checkbox" checked={favorite} onChange={e => {setFavorite(e.target.checked); setPage(0)}} /> 즐겨찾기만</label>
      <label>논문 태그 검색<input value={tag} maxLength={60} onChange={e => {setTag(e.target.value); setPage(0)}} /></label><button disabled={disabled} onClick={() => setReload(n => n + 1)}>목록 새로고침</button></div>
    {recommendationBasis && <section aria-label="논문 추천 후보"><h3>추천 후보</h3><p>{recommendationBasis}</p>
      {recommendations.length ? <ul>{recommendations.map((item,index) => <li key={index}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || '제목 미상'}</a> · {item.published || '발표일 미상'} · {item.provider === 'kci' ? 'KCI' : 'Crossref'}</li>)}</ul> : <p>조건에 맞는 후보가 없습니다.</p>}
    </section>}
    {notice && <p role="status" style={{ whiteSpace: 'pre-wrap' }}>{notice}</p>}{error && <p role="alert" className="error">{error}</p>}{disabled && <p role="status">처리 중입니다.</p>}
    <p className="hint">논문에 실린 관찰 사례는 해당 행의 간접 관찰 등록으로 입력합니다. 발표일은 관찰일이 아니며 원문 날짜·장소·근거 페이지를 직접 확인해 주세요.</p>
    <div className="table-wrap"><table className="paper-table"><thead><tr><th>논문·초록</th><th>저자·학술지</th><th>발표일·언어</th><th>출처</th><th>관찰 사례</th></tr></thead><tbody>{items.map(paper => <tr key={paper.id}>
      <td><button type="button" disabled={disabled} aria-pressed={paper.favorite} aria-label={paper.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'} onClick={() => void organize(paper, !paper.favorite, paper.tags ?? [])}>{paper.favorite ? '★' : '☆'}</button> <a href={paper.url} target="_blank" rel="noopener noreferrer">{paper.title || '제목 미상'}</a><form key={(paper.tags ?? []).join(',')} onSubmit={e => { e.preventDefault(); const raw = new FormData(e.currentTarget).get('tags'); void organize(paper, paper.favorite, String(raw ?? '').split(',').map(t => t.trim()).filter(Boolean)) }}>
        <label>논문 태그<input name="tags" defaultValue={(paper.tags ?? []).join(', ')} maxLength={1240} placeholder="쉼표로 구분" /></label><button disabled={disabled}>태그 저장</button>
      </form><details><summary>초록·서지정보</summary><p style={{ whiteSpace: 'pre-wrap' }}>{paper.abstract || '제공된 초록이 없습니다. 원문에서 확인해 주세요.'}</p><small>DOI: {paper.doi || '미제공'}<br />처음 수집: {paper.received_at}</small></details>{paper.files?.map(file => <div key={file.id}><a href={`/api/papers/pdf/${file.id}`} target="_blank" rel="noopener noreferrer">PDF 원문</a>{geminiReady && <button type="button" disabled={disabled} onClick={() => void extract(file.id)}>Gemini 서지 추출</button>}
<details onToggle={e => { if (e.currentTarget.open) void readPdf(file.id) }}><summary>쪽별 추출 텍스트</summary><small>표·다단 편집의 읽기 순서가 다를 수 있습니다. 스캔 이미지는 텍스트가 없을 수 있습니다.</small>{pdfText[file.id]?.map((text, index) => <details key={index}><summary>PDF {index + 1}쪽</summary><p className="paper-pdf-text">{text || '추출된 텍스트가 없습니다.'}</p></details>)}</details></div>)}</td>
      <td>{paper.authors || '저자 미상'}<br /><small>{paper.journal || '학술지 미상'}</small></td><td>{paper.published || '발표일 미상'}<br />{({ ko: '한국어', en: '영어', unknown: '언어 미상' })[paper.language] || paper.language}</td><td>{paper.providers.map(p => p === 'pdf' ? 'PDF 직접 추가' : p === 'kci' ? 'KCI' : 'Crossref').join(' · ')}</td>
      <td><button disabled={disabled} onClick={() => onRegister(paper)}>간접 관찰 등록</button><small>등록 사례 {paper.observations.length}건</small>{paper.observations.length > 0 && <details><summary>근거 보기</summary>{paper.observations.map(o => <p key={o.id}>관찰 {o.id} · {o.evidence}</p>)}</details>}</td>
    </tr>)}</tbody></table></div>
    {!disabled && !items.length && <p>조건에 맞는 수집 논문이 없습니다. 논문 갱신으로 자료를 가져오거나 목록 언어·주제를 확인해 주세요.</p>}
    <div className="toolbar"><button disabled={disabled || page === 0} onClick={() => setPage(p => p - 1)}>이전</button><span>{page + 1} / {Math.max(1, Math.ceil(total / 25))}</span><button disabled={disabled || (page + 1) * 25 >= total} onClick={() => setPage(p => p + 1)}>다음</button></div>
  </section>
}
