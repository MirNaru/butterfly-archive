// 한 조사와 여러 종별 기록을 입력하고 실패 시 작성 내용을 유지합니다.
import { useState } from 'react'
import type { FormEvent } from 'react'
import { addSurvey } from './api'
import { CAPTURE, IDENTIFICATION, LOCATION, PURPOSE, RESULT, SEX, STAGE } from './models'
import type { ObservationInput, Species, Survey, SurveyInput } from './models'

export function Options({ values }: { values: Record<string, string> }) {
  return Object.entries(values).map(([value, text]) => <option value={value} key={value}>{text}</option>)
}
function LocationFields({ prefix }: { prefix: string }) {
  return <div className="field-grid">
    <label className="wide">장소명<input name={`${prefix}place_name`} maxLength={200} /></label>
    <label>위도<input name={`${prefix}latitude`} type="number" min={-90} max={90} step="any" placeholder="선택" /></label>
    <label>경도<input name={`${prefix}longitude`} type="number" min={-180} max={180} step="any" placeholder="선택" /></label>
    <label>위치 입력 방식<select name={`${prefix}location_method`}><Options values={LOCATION} /></select></label>
  </div>
}
function ObservationFields({ rowKey, index, species, remove }: { rowKey: number; index: number; species: Species[]; remove: () => void }) {
  const [result, setResult] = useState<ObservationInput['result']>('observed')
  const [capture, setCapture] = useState<ObservationInput['capture_status']>('unknown')
  const prefix = `record-${rowKey}-`
  return <fieldset className="record-fields"><legend>종별 기록 {index + 1}</legend>
    <div className="field-grid">
      <label>결과<select name={`${prefix}result`} value={result} onChange={e => setResult(e.target.value as ObservationInput['result'])}><Options values={RESULT} /></select></label>
      <label>종<select name={`${prefix}species_id`} required={result === 'not_found'}>
        <option value="">{result === 'not_found' ? '찾으려던 종 선택' : '동정 미확정'}</option>
        {species.map(s => <option key={s.id} value={s.id}>{s.korean_name}</option>)}
      </select></label>
      <label>개별 날짜<input name={`${prefix}observation_date`} type="date" /><small>비우면 조사 날짜 사용</small></label>
      <label>관찰 시각<input name={`${prefix}observation_time`} type="time" /><small>한국 현지 시각 · 선택</small></label>
      {result === 'observed' && <>
        <label>발육 단계<select name={`${prefix}stage`}><Options values={STAGE} /></select></label>
        <label>성별<select name={`${prefix}sex`}><Options values={SEX} /></select></label>
        <label>관찰 개체 수<input name={`${prefix}count`} type="number" min={1} max={1000000} step={1} placeholder="미상" /></label>
        <label className="check"><input name={`${prefix}count_estimated`} type="checkbox" />추정 개체 수</label>
        <label>동정 상태<select name={`${prefix}identification`}><Options values={IDENTIFICATION} /></select></label>
        <label>채집 여부<select name={`${prefix}capture_status`} value={capture} onChange={e => setCapture(e.target.value as ObservationInput['capture_status'])}><Options values={CAPTURE} /></select></label>
        {capture === 'captured' && <label>채집 개체 수<input name={`${prefix}captured_count`} type="number" min={1} max={1000000} step={1} placeholder="미상" /></label>}
      </>}
    </div>
    {result === 'not_found' && <p className="hint">실제로 찾았으나 발견하지 못한 종만 기록해 주세요.</p>}
    <details><summary>개별 위치 지정</summary><p className="hint">모두 비우면 조사 위치를 사용합니다. 장소명만 지정하면 조사 좌표를 복사하지 않습니다.</p><LocationFields prefix={prefix} /></details>
    <label>기록 메모<textarea name={`${prefix}notes`} maxLength={5000} rows={2} /></label>
    <button type="button" className="quiet" onClick={remove}>이 입력 항목 제거</button>
  </fieldset>
}

export default function SurveyForm({ species, onSaved, onCancel }: { species: Species[]; onSaved: (survey: Survey) => void; onCancel: () => void }) {
  const [keys, setKeys] = useState([0])
  const [nextKey, setNextKey] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    const str = (key: string) => String(data.get(key) ?? '').trim()
    const num = (key: string) => str(key) === '' ? null : Number(str(key))
    const location = (prefix: string) => ({ place_name: str(`${prefix}place_name`), latitude: num(`${prefix}latitude`), longitude: num(`${prefix}longitude`), location_method: str(`${prefix}location_method`) as SurveyInput['location_method'] })
    const observations = keys.map(key => {
      const p = `record-${key}-`
      const result = str(`${p}result`) as ObservationInput['result']
      return { ...location(p), species_id: num(`${p}species_id`), result,
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
      const saved = await addSurvey({ ...location('survey-'), survey_date: str('survey_date'), purpose: str('purpose') as SurveyInput['purpose'], notes: str('notes'), observations })
      onSaved(saved)
    } catch (error) { setError(error instanceof Error ? error.message : '저장에 실패했습니다.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit} className="survey-form">
    <h2>새 조사 등록</h2><p className="hint">날짜와 장소명 또는 좌표를 입력해 주세요. 모르는 수량과 시각은 비워 두셔도 됩니다.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <fieldset disabled={busy}>
      <div className="field-grid">
        <label>조사 날짜<input name="survey_date" type="date" required /></label>
        <label>조사 목적<select name="purpose"><Options values={PURPOSE} /></select></label>
      </div>
      <LocationFields prefix="survey-" />
      <label>조사 메모<textarea name="notes" maxLength={5000} rows={2} /></label>
      {keys.map((key, index) => <ObservationFields key={key} rowKey={key} index={index} species={species} remove={() => setKeys(current => current.filter(k => k !== key))} />)}
      {keys.length === 0 && <p className="hint">종별 기록 없이 조사만 저장할 수 있습니다. 미발견 기록이 자동 생성되지는 않습니다.</p>}
      <button type="button" disabled={keys.length >= 100} onClick={() => { setKeys([...keys, nextKey]); setNextKey(nextKey + 1) }}>종별 기록 추가</button>
      <div className="actions"><button type="submit" className="primary">{busy ? '저장 중…' : '조사 저장'}</button><button type="button" onClick={() => { if (window.confirm('작성 중인 내용을 닫으시겠습니까?')) onCancel() }}>취소</button></div>
    </fieldset>
  </form>
}
