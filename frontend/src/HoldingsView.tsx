// 소장 정보는 관찰과 분리해 입력하며 등록·검색은 왼쪽, 목록은 오른쪽에 둡니다.
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { addHolding, listHoldings, updateHolding } from './api'
import { ACQUISITION, POSSESSION } from './models'
import type { Holding, HoldingInput, Species, Survey } from './models'
import PhotoPicker from './PhotoPicker'
import { groupHoldings, holdingGroupMatches, holdingSummary, HOLDING_SEX } from './holdingSummary'
import type { HoldingGroup } from './holdingSummary'

const EMPTY: HoldingInput = { species_id: 0, sex: 'unknown', possession: 'unknown', quantity: null, male_quantity: null, female_quantity: null, acquisition: 'unknown', acquired_date: null, observation_id: null, source_note: '', notes: '', photo_ids: [] }
function HoldingQuantity({ group }: { group: HoldingGroup }) {
  const id = useId()
  const element = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  function show() {
    const rect = element.current?.getBoundingClientRect()
    if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 330)), top: rect.bottom + 6 > window.innerHeight - 60 ? rect.top - 50 : rect.bottom + 6 })
  }
  useEffect(() => {
    if (!position) return
    const hide = () => setPosition(null)
    window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide)
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide) }
  }, [position])
  return <><span ref={element} className="holding-quantity" tabIndex={0} aria-label={`${group.quantityText} · ${group.quantityHint}`} aria-describedby={position ? id : undefined} onMouseEnter={show} onFocus={show} onMouseLeave={() => setPosition(null)} onBlur={() => setPosition(null)} onKeyDown={event => { if (event.key === 'Escape') setPosition(null) }}>{group.quantityText}</span>{position && createPortal(<span id={id} className="holding-quantity-tooltip" role="tooltip" style={position}>{group.quantityHint}</span>, document.body)}</>
}
function HoldingForm({ initial, species, surveys, onClose, onSaved }: { initial: Holding | null; species: Species[]; surveys: Survey[]; onClose: () => void; onSaved: (value: Holding) => void }) {
  const [value, setValue] = useState<HoldingInput>(initial || EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  function update<K extends keyof HoldingInput>(key: K, next: HoldingInput[K]) { setValue(previous => ({ ...previous, [key]: next })) }
  function toggleSex(sex: 'male' | 'female', checked: boolean) {
    setValue(previous => {
      const male = sex === 'male' ? checked : previous.sex === 'male' || previous.sex === 'mixed'
      const female = sex === 'female' ? checked : previous.sex === 'female' || previous.sex === 'mixed'
      return { ...previous, sex: male && female ? 'mixed' : male ? 'male' : female ? 'female' : 'unknown', male_quantity: null, female_quantity: null }
    })
  }
  const eligible = surveys.flatMap(survey => survey.observations.filter(record => record.source_type === 'direct' && record.result === 'observed' && record.capture_status === 'captured' && record.species_id === value.species_id).map(record => ({ id: record.id, label: `${record.effective_date} · ${record.species_name || '미확정'} · ${record.effective_place || '좌표 지정 장소'}` })))
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || photoBusy) return
    const form = event.currentTarget
    if (value.sex === 'mixed' && (value.quantity === null || value.quantity < 2)) { setError('수컷과 암컷을 모두 선택하면 총 소장 개체 수를 2개체 이상 입력해 주세요.'); return }
    if (value.sex === 'mixed' && ((value.male_quantity === null) !== (value.female_quantity === null) || (value.male_quantity !== null && value.female_quantity !== null && value.male_quantity + value.female_quantity !== value.quantity))) { setError('성별 수량은 둘 다 비우거나, 수컷과 암컷의 합계가 총 소장 개체 수와 같도록 입력해 주세요.'); return }
    const invalid = Array.from(form.elements).find((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && !element.validity.valid)
    if (invalid) { setError(invalid.validationMessage); invalid.focus(); return }
    setBusy(true); setError('')
    try {
      const { species_id, sex, possession, quantity, male_quantity, female_quantity, acquisition, acquired_date, observation_id, source_note, notes } = value
      const body = { species_id, sex, possession, quantity, male_quantity, female_quantity, acquisition, acquired_date, observation_id, source_note, notes, photo_ids: new FormData(form).getAll('holding-photos').map(Number) }
      onSaved(initial ? await updateHolding(initial.id, body, initial.updated_at) : await addHolding(body))
    } catch (e) { setError(e instanceof Error ? e.message : '소장 정보를 저장하지 못했습니다.') }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="holding-dialog" aria-label={initial ? '소장 기록 수정' : '소장 기록 등록'} onCancel={event => { event.preventDefault(); if (!busy && !photoBusy) setConfirmClose(true) }}><form noValidate className="survey-form" onSubmit={submit}>
    <h2>{initial ? '소장 기록 수정' : '소장 기록 등록'}</h2><p className="hint">같은 종도 구매·직접 채집 자료를 각각 등록할 수 있습니다. 모르는 수량·성별·취득 경로는 미확인으로 남겨 주세요.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <fieldset disabled={busy}><div className="field-grid">
      <label>소장 종<select aria-label="소장 종" required value={value.species_id || ''} onChange={e => setValue(previous => ({ ...previous, species_id: Number(e.target.value), observation_id: null }))}><option value="">종 선택</option>{species.map(row => <option value={row.id} key={row.id}>{row.korean_name}</option>)}</select></label>
      <fieldset className="holding-sex"><legend>성별 · 중복 선택 가능</legend><label><input type="checkbox" checked={value.sex === 'male' || value.sex === 'mixed'} onChange={e => toggleSex('male', e.target.checked)} />수컷</label><label><input type="checkbox" checked={value.sex === 'female' || value.sex === 'mixed'} onChange={e => toggleSex('female', e.target.checked)} />암컷</label><small>{value.sex === 'unknown' ? '선택하지 않으면 성별 미상' : value.sex === 'mixed' ? '총수량 2개체 이상 필수' : ''}</small></fieldset>
      <label>소지 상태<select aria-label="소지 상태" value={value.possession} onChange={e => setValue(previous => ({ ...previous, possession: e.target.value as HoldingInput['possession'], quantity: e.target.value === 'owned' ? previous.quantity : null, male_quantity: e.target.value === 'owned' ? previous.male_quantity : null, female_quantity: e.target.value === 'owned' ? previous.female_quantity : null }))}>{Object.entries(POSSESSION).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>{value.sex === 'mixed' ? '총 소장 개체 수 · 필수' : '소장 개체 수 · 선택'}<input aria-label="소장 개체 수" type="number" min={value.sex === 'mixed' ? 2 : 1} required={value.sex === 'mixed'} max={1000000} step={1} disabled={value.possession !== 'owned'} value={value.quantity ?? ''} onChange={e => update('quantity', e.target.value === '' ? null : Number(e.target.value))} placeholder={value.possession === 'owned' ? value.sex === 'mixed' ? '2개체 이상 입력' : '수량 미상' : '소지함으로 확인한 경우 입력'} /></label>
      {value.sex === 'mixed' && <><label>수컷 개체 수 · 선택<input aria-label="수컷 개체 수" type="number" min={1} max={1000000} step={1} disabled={value.possession !== 'owned'} value={value.male_quantity ?? ''} onChange={e => update('male_quantity', e.target.value === '' ? null : Number(e.target.value))} placeholder="모르면 암컷 수량과 함께 비워 두세요" /></label><label>암컷 개체 수 · 선택<input aria-label="암컷 개체 수" type="number" min={1} max={1000000} step={1} disabled={value.possession !== 'owned'} value={value.female_quantity ?? ''} onChange={e => update('female_quantity', e.target.value === '' ? null : Number(e.target.value))} placeholder="수컷 + 암컷 = 총 소장 개체 수" /></label></>}
      <label>취득 경로<select aria-label="취득 경로" value={value.acquisition} onChange={e => setValue(previous => ({ ...previous, acquisition: e.target.value as HoldingInput['acquisition'], observation_id: e.target.value === 'own_capture' ? previous.observation_id : null }))}>{Object.entries(ACQUISITION).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>취득 날짜 · 선택<input type="date" value={value.acquired_date || ''} onChange={e => update('acquired_date', e.target.value || null)} /></label>
    </div>
    {value.acquisition === 'own_capture' && <label>연결할 개인 채집 관찰 · 선택<select aria-label="연결할 개인 채집 관찰 · 선택" value={value.observation_id || ''} onChange={e => update('observation_id', e.target.value ? Number(e.target.value) : null)}><option value="">관찰 연결 없이 근거로 기록</option>{eligible.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>}
    <label>취득 근거·출처<input maxLength={2000} required={value.acquisition === 'own_capture' && value.observation_id === null} value={value.source_note} onChange={e => update('source_note', e.target.value)} placeholder="표본 라벨, 구매 자료, 본인 확인 등" /></label>
    <label>소장 메모<textarea maxLength={5000} rows={3} value={value.notes} onChange={e => update('notes', e.target.value)} /></label>
    <PhotoPicker name="holding-photos" initialIds={initial?.photo_ids || []} onBusy={setPhotoBusy} saveLabel="소장 저장" />
    <p className="hint">구매·취득 날짜는 야생 관찰 날짜가 아닙니다. 사진의 촬영 날짜·GPS는 소장 기록에 자동 적용하지 않습니다. 소장 기록으로 관찰 기록을 만들지 않습니다.</p>
    <div className="actions">{confirmClose ? <><span>저장하지 않고 닫으시겠습니까?</span><button type="button" onClick={() => setConfirmClose(false)}>계속 작성</button><button type="button" onClick={onClose}>저장하지 않고 닫기</button></> : <><button type="button" disabled={photoBusy} onClick={() => setConfirmClose(true)}>취소</button><button className="primary" disabled={photoBusy}>{busy ? '저장 중…' : '소장 저장'}</button></>}</div>
    </fieldset>
  </form></dialog>
}

function HoldingDetails({ group, onEdit, onClose }: { group: HoldingGroup; onEdit: (row: Holding) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} className="holding-dialog" aria-label="소장 성별 내역" onCancel={onClose}>
    <h2>{group.first.korean_name} · {HOLDING_SEX[group.sex]}</h2><p>{group.quantityHint}</p>
    <p className="hint">취득 날짜·출처·사진을 보존한 원래 내역입니다. 수정할 내역을 선택해 주세요.</p>
    <div className="holding-detail-list">{group.rows.map(row => <article key={row.id}><strong>{HOLDING_SEX[row.sex]} · {row.quantity === null ? '수량 미상' : `${row.quantity}개체`}</strong><p>{POSSESSION[row.possession]} · {row.acquired_date || '취득 날짜 미상'}</p><p className="hint">{row.source_note}{row.notes && <><br />{row.notes}</>}</p><button type="button" onClick={() => onEdit(row)}>{HOLDING_SEX[row.sex]} 내역 수정</button></article>)}</div>
    <div className="actions"><button type="button" onClick={onClose}>닫기</button></div>
  </dialog>
}

export default function HoldingsView({ species, surveys, query, sidebar, revision, registerOpen, onRegisterOpen, onEditing, onChanged }: { species: Species[]; surveys: Survey[]; query: string; sidebar: HTMLDivElement | null; revision: number; registerOpen: boolean; onRegisterOpen: (open: boolean) => void; onEditing: (active: boolean) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Holding[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loaded, setLoaded] = useState('')
  const [retry, setRetry] = useState(0)
  const [acquisition, setAcquisition] = useState('')
  const [possession, setPossession] = useState('')
  const [sex, setSex] = useState('')
  const [editing, setEditing] = useState<Holding | null>(null)
  const [details, setDetails] = useState<HoldingGroup | null>(null)
  const requestKey = `${revision}:${retry}`
  const loading = loaded !== requestKey
  useEffect(() => {
    let active = true
    listHoldings().then(value => { if (active) { setRows(value); setError('') } }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : '소장 목록을 읽지 못했습니다.') }).finally(() => { if (active) setLoaded(requestKey) })
    return () => { active = false }
  }, [requestKey])
  const groups = groupHoldings(rows)
  const filtered = groups.filter(group => holdingGroupMatches(group, query, acquisition, possession, sex))
  const summary = holdingSummary(rows)
  function close() { setDetails(null); setEditing(null); onRegisterOpen(false); onEditing(false) }
  const controls = <div className="holding-controls"><button type="button" className="primary" onClick={() => { onRegisterOpen(true); onEditing(true) }}>소장 등록</button>
    <label>취득 경로 필터<select value={acquisition} onChange={e => setAcquisition(e.target.value)}><option value="">전체</option>{Object.entries(ACQUISITION).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
    <label>소지 상태 필터<select value={possession} onChange={e => setPossession(e.target.value)}><option value="">전체</option>{Object.entries(POSSESSION).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
    <label>성별 필터<select value={sex} onChange={e => setSex(e.target.value)}><option value="">전체</option>{Object.entries(HOLDING_SEX).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
    <button type="button" onClick={() => { setAcquisition(''); setPossession(''); setSex('') }}>소장 필터 초기화</button>
    <p className="hint">소지함 {summary.species}종<br />알려진 수량 {summary.knownQuantity === null ? '없음' : `${summary.knownQuantity}개체`} · 수량 미상 {summary.unknownRecords}건<br />검색 {filtered.length}행 / 전체 {groups.length}행</p>
    <p className="hint">구매는 개인 채집 이력에 포함하지 않습니다. 직접 채집은 근거와 함께 기록합니다. 국명을 누르면 편집할 수 있습니다.</p>
    {error && <p className="error" role="alert">{error}<button type="button" onClick={() => setRetry(n => n + 1)}>소장 목록 다시 읽기</button></p>}
  </div>
  return <section className="holdings-view" aria-label="소장 목록">{sidebar ? createPortal(controls, sidebar) : controls}{loading && <p role="status">소장 목록을 읽는 중입니다.</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <div className="table-wrap"><table className="holdings-table"><thead><tr><th>국명 · 학명</th><th>성별</th><th>소지 상태</th><th>소장 개체 수</th><th>취득 경로</th><th>취득 날짜</th><th>연결 관찰</th><th>사진</th><th>근거·메모</th></tr></thead><tbody>{filtered.map(group => {
      const row = group.first
      const statuses = [...new Set(group.rows.map(entry => POSSESSION[entry.possession]))]
      const dates = [...new Set(group.rows.map(entry => entry.acquired_date || '미상'))]
      const observations = [...new Set(group.rows.flatMap(entry => entry.observation_id === null ? [] : [entry.observation_id]))]
      return <tr key={group.key}><td><button type="button" className="link" onClick={() => { if (group.rows.length === 1) setEditing(row); else setDetails(group); onEditing(true) }}>{row.korean_name}</button><small>{row.scientific_name || '학명 미등록'}</small></td><td>{HOLDING_SEX[group.sex]}{group.sex !== 'unknown' && group.rows.some(entry => entry.sex === 'unknown') && <small>성별 미상 내역 포함</small>}</td><td>{statuses.join(' / ')}</td><td><HoldingQuantity group={group} /></td><td>{ACQUISITION[row.acquisition]}</td><td>{dates.length === 1 ? dates[0] : '여러 날짜'}</td><td>{observations.length ? observations.map(id => `관찰 #${id}`).join(', ') : '미연결'}</td><td>{group.photoIds.length}개</td><td className="memo-cell">{group.rows.length > 1 ? <button type="button" className="link" onClick={() => { setDetails(group); onEditing(true) }}>취득 내역 {group.rows.length}건 보기</button> : <>{row.source_note}{row.source_note && row.notes && <br />}{row.notes || (!row.source_note && '미기재')}</>}</td></tr>
    })}{!filtered.length && <tr><td colSpan={9}>{error ? '왼쪽 안내에서 목록을 다시 읽어 주세요.' : loading ? '목록을 읽는 중입니다.' : rows.length ? '조건에 맞는 소장 기록이 없습니다.' : '왼쪽에서 소장 정보를 등록해 주세요.'}</td></tr>}</tbody></table></div>
    {details && <HoldingDetails group={details} onClose={close} onEdit={row => { setDetails(null); setEditing(row) }} />}
    {(registerOpen || editing) && <HoldingForm initial={editing} species={species} surveys={surveys} onClose={close} onSaved={value => { setRows(current => [value, ...current.filter(row => row.id !== value.id)]); close(); setNotice('소장 정보를 저장했습니다.'); setRetry(n => n + 1); onChanged() }} />}
  </section>
}
