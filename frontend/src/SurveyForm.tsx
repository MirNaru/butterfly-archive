// 한 조사와 여러 종별 기록을 입력하고 실패 시 작성 내용을 유지합니다.
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { addSurvey, updateSurvey } from './api'
import { CAPTURE, IDENTIFICATION, LOCATION, PURPOSE, RESULT, SEX, STAGE, SOURCE_TYPE } from './models'
import type { LocationInput, Observation, ObservationInput, Species, Survey, SurveyInput } from './models'
import LocationPicker from './LocationPicker'

export function Options({ values }: { values: Record<string, string> }) {
  return Object.entries(values).map(([value, text]) => <option value={value} key={value}>{text}</option>)
}
function LocationFields({ prefix, initial }: { prefix: string; initial?: LocationInput }) {
  const [place, setPlace] = useState(initial?.place_name ?? '')
  const [latitude, setLatitude] = useState(String(initial?.latitude ?? ''))
  const [longitude, setLongitude] = useState(String(initial?.longitude ?? ''))
  const [method, setMethod] = useState<SurveyInput['location_method']>(initial?.location_method ?? 'unknown')
  return <div className="field-grid location-fields">
    <label className="wide">장소명<input name={`${prefix}place_name`} value={place} onChange={e => setPlace(e.target.value)} maxLength={200} /></label>
    <label>위도<input name={`${prefix}latitude`} value={latitude} onChange={e => { setLatitude(e.target.value); setMethod(!e.target.value && !longitude ? 'unknown' : 'manual') }} type="number" min={-90} max={90} step="any" placeholder="선택" /></label>
    <label>경도<input name={`${prefix}longitude`} value={longitude} onChange={e => { setLongitude(e.target.value); setMethod(!e.target.value && !latitude ? 'unknown' : 'manual') }} type="number" min={-180} max={180} step="any" placeholder="선택" /></label>
    <label>위치 방식<select name={`${prefix}location_method`} value={method} onChange={e => setMethod(e.target.value as SurveyInput['location_method'])}><Options values={LOCATION} /></select></label>
    <LocationPicker onApply={value => { if (value.place_name) setPlace(value.place_name); setLatitude(String(value.latitude)); setLongitude(String(value.longitude)); setMethod(value.location_method) }} />
  </div>
}
function ObservationFields({ rowKey, index, species, remove, initial, active }: { active: boolean; rowKey: number; index: number; species: Species[]; remove: () => void; initial?: Observation }) {
  const [result, setResult] = useState<ObservationInput['result']>(initial?.result ?? 'observed')
  const [capture, setCapture] = useState<ObservationInput['capture_status']>(initial?.capture_status ?? 'unknown')
  const [source, setSource] = useState<ObservationInput['source_type']>(initial?.source_type ?? 'direct')
  const [sourceNote, setSourceNote] = useState(initial?.source_note ?? '')
  const prefix = `record-${rowKey}-`
  return <fieldset hidden={!active} data-row-key={rowKey} className="record-fields"><legend>종별 기록 {index + 1}</legend>
    <div className="field-grid observation-grid">
      <label>관찰 출처<select name={`${prefix}source_type`} value={source} onChange={e => setSource(e.target.value as ObservationInput['source_type'])}><Options values={SOURCE_TYPE} /></select></label>
      <label>결과<select name={`${prefix}result`} value={result} onChange={e => setResult(e.target.value as ObservationInput['result'])}><Options values={RESULT} /></select></label>
      <label>종<select name={`${prefix}species_id`} defaultValue={initial?.species_id ?? ''} required={result === 'not_found'}>
        <option value="">{result === 'not_found' ? '찾으려던 종 선택' : '동정 미확정'}</option>
        {species.map(s => <option key={s.id} value={s.id}>{s.korean_name}</option>)}
      </select></label>
      <label>개별 날짜 · 선택<input name={`${prefix}observation_date`} defaultValue={initial?.observation_date ?? ''} type="date" /></label>
      <label>관찰 시각 · 선택<input name={`${prefix}observation_time`} defaultValue={initial?.observation_time ?? ''} type="time" step="0.000001" /></label>
      {result === 'observed' && <>
        <label>발육 단계<select name={`${prefix}stage`} defaultValue={initial?.stage ?? ''}><Options values={STAGE} /></select></label>
        <label>성별<select name={`${prefix}sex`} defaultValue={initial?.sex ?? ''}><Options values={SEX} /></select></label>
        <label>관찰 개체 수<input name={`${prefix}count`} defaultValue={initial?.count ?? ''} type="number" min={1} max={1000000} step={1} placeholder="미상" /></label>
        <label className="check"><input name={`${prefix}count_estimated`} defaultChecked={initial?.count_estimated ?? false} type="checkbox" />추정 개체 수</label>
        <label>동정 상태<select name={`${prefix}identification`} defaultValue={initial?.identification ?? ''}><Options values={IDENTIFICATION} /></select></label>
        <label>채집 여부<select name={`${prefix}capture_status`} value={capture} onChange={e => setCapture(e.target.value as ObservationInput['capture_status'])}><Options values={CAPTURE} /></select></label>
        {capture === 'captured' && <label>채집 개체 수<input name={`${prefix}captured_count`} defaultValue={initial?.captured_count ?? ''} type="number" min={1} max={1000000} step={1} placeholder="미상" /></label>}
      </>}
    </div>
    {source === 'indirect' && <label>간접 관찰 출처<input name={`${prefix}source_note`} value={sourceNote} onChange={e => setSourceNote(e.target.value)} maxLength={2000} required placeholder="원문 주소 또는 자료명·관찰자" /><span className="hint">채집 여부는 원 관찰자 기준이며 내 채집 이력에 포함하지 않습니다.</span></label>}
    {source === 'direct' && <input type="hidden" name={`${prefix}source_note`} value={sourceNote} />}
    {result === 'not_found' && <p className="hint">실제로 찾았으나 발견하지 못한 종만 기록해 주세요.</p>}
    <div className="individual-location"><h3>개별 위치 · 선택</h3><LocationFields prefix={prefix} initial={initial} /></div>
    <label>기록 메모<textarea name={`${prefix}notes`} defaultValue={initial?.notes ?? ''} maxLength={5000} rows={1} /></label>
    {!initial && <button type="button" className="quiet" onClick={remove}>이 입력 항목 제거</button>}
  </fieldset>
}

export default function SurveyForm({ species, onSaved, onCancel, initial }: { initial?: Survey; species: Species[]; onSaved: (survey: Survey) => void; onCancel: () => void }) {
  const [keys, setKeys] = useState(initial ? initial.observations.map((_, index) => index) : [0])
  const [nextKey, setNextKey] = useState(initial ? initial.observations.length : 1)
  const [activeKey, setActiveKey] = useState(0)
  const [confirmClose, setConfirmClose] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const invalid = Array.from(form.elements).find((el): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && !el.validity.valid)
    if (invalid) {
      const row = invalid.closest<HTMLElement>('[data-row-key]')
      if (row) setActiveKey(Number(row.dataset.rowKey))
      setError(`${row ? `종별 기록 ${keys.indexOf(Number(row.dataset.rowKey)) + 1}: ` : ''}${invalid.validationMessage}`)
      requestAnimationFrame(() => invalid.focus())
      return
    }
    const data = new FormData(form)
    const str = (key: string) => String(data.get(key) ?? '').trim()
    const num = (key: string) => str(key) === '' ? null : Number(str(key))
    const location = (prefix: string) => ({ place_name: str(`${prefix}place_name`), latitude: num(`${prefix}latitude`), longitude: num(`${prefix}longitude`), location_method: str(`${prefix}location_method`) as SurveyInput['location_method'] })
    const observations = keys.map(key => {
      const p = `record-${key}-`
      const result = str(`${p}result`) as ObservationInput['result']
      return { ...location(p), species_id: num(`${p}species_id`), result,
        source_type: str(`${p}source_type`) as ObservationInput['source_type'], source_note: str(`${p}source_note`),
        observation_date: str(`${p}observation_date`) || null, observation_time: str(`${p}observation_time`) || null,
        stage: (str(`${p}stage`) || 'unknown') as ObservationInput['stage'],
        sex: (str(`${p}sex`) || 'unknown') as ObservationInput['sex'], count: num(`${p}count`),
        count_estimated: data.has(`${p}count_estimated`),
        identification: (str(`${p}identification`) || 'unidentified') as ObservationInput['identification'],
        capture_status: (result === 'not_found' ? 'not_captured' : str(`${p}capture_status`)) as ObservationInput['capture_status'],
        captured_count: num(`${p}captured_count`), notes: str(`${p}notes`) }
    })
    setBusy(true); setError('')
    try {
      const value = { ...location('survey-'), survey_date: str('survey_date'), purpose: str('purpose') as SurveyInput['purpose'], notes: str('notes'), observations }
      const saved = initial ? await updateSurvey(initial.id, { ...value, expected_updated_at: initial.updated_at, observations: observations.map((item, index) => ({ ...item, id: initial.observations[keys[index]]?.id ?? null })) }) : await addSurvey(value)
      onSaved(saved)
    } catch (error) {
      const message = error instanceof Error ? error.message : '저장에 실패했습니다.'
      const match = /종별 기록 (\d+)/.exec(message)
      if (match && keys[Number(match[1]) - 1] !== undefined) setActiveKey(keys[Number(match[1]) - 1])
      setError(message)
    }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="survey-dialog" aria-labelledby="survey-dialog-title" onCancel={e => { e.preventDefault(); if (!busy) setConfirmClose(true) }}>
    <form onSubmit={submit} noValidate className="survey-form survey-modal-form">
      <header className="survey-modal-header"><div><span className="eyebrow">BUTTERFLY ARCHIVE · 조사 기록</span><h2 id="survey-dialog-title">{initial ? '조사 기록 수정' : '새 조사 등록'}</h2></div><p className="hint">날짜와 장소명 또는 좌표는 필수입니다.<br />개별 날짜·위치를 비우면 조사 값을 사용합니다. 기상은 저장 후 연결합니다.</p></header>
      {error && <p role="alert" className="error survey-error">{error}</p>}
      <fieldset disabled={busy} className="survey-modal-fields">
        <div className="survey-columns">
          <section className="survey-common"><h3>조사 공통 정보</h3><div className="field-grid">
            <label>조사 날짜<input name="survey_date" defaultValue={initial?.survey_date} type="date" required /></label>
            <label>조사 목적<select name="purpose" defaultValue={initial?.purpose}><Options values={PURPOSE} /></select></label>
          </div><LocationFields prefix="survey-" initial={initial} />
            <label>조사 메모<textarea name="notes" defaultValue={initial?.notes} maxLength={5000} rows={3} /></label>
            <p className="hint">개별 장소명만 입력하면 조사 좌표를 복사하지 않습니다. 모르는 수량·시각은 비워 두세요.</p>
            {initial && <p className="hint">기존 개별 지정 값과 기상자료는 보존합니다. 기상을 자동 재조회하지 않습니다.</p>}
          </section>
          <section className="survey-observations"><div className="record-switcher"><label>종별 입력 항목<select value={keys.includes(activeKey) ? activeKey : ''} onChange={e => setActiveKey(Number(e.target.value))}>{!keys.length && <option value="">종별 기록 없음</option>}{keys.map((key, index) => <option key={key} value={key}>종별 기록 {index + 1}{initial?.observations[key]?.species_name ? ` · ${initial.observations[key].species_name}` : ''}</option>)}</select></label><button type="button" disabled={keys.length >= 100} onClick={() => { setKeys([...keys, nextKey]); setActiveKey(nextKey); setNextKey(nextKey + 1) }}>종별 기록 추가</button><small>총 {keys.length}건</small></div>
            {keys.map((key, index) => <ObservationFields key={key} rowKey={key} index={index} active={key === activeKey} initial={initial?.observations[key]} species={species} remove={() => { const remaining = keys.filter(k => k !== key); setKeys(remaining); setActiveKey(remaining[0] ?? 0) }} />)}
            {!keys.length && <p className="empty">종별 기록 없이 조사만 저장할 수 있습니다. 미발견 기록을 자동 생성하지 않습니다.</p>}
          </section>
        </div>
        <footer className="survey-modal-footer">{confirmClose ? <><span>작성 중인 내용을 저장하지 않고 닫으시겠습니까?</span><button type="button" onClick={() => setConfirmClose(false)}>계속 작성</button><button type="button" onClick={onCancel}>저장하지 않고 닫기</button></> : <><small>전환한 종별 항목의 입력도 함께 저장됩니다.</small><button type="button" onClick={() => setConfirmClose(true)}>취소</button><button type="submit" className="primary">{busy ? '저장 중…' : initial ? '수정 저장' : '조사 저장'}</button></>}</footer>
      </fieldset>
    </form>
  </dialog>
}
