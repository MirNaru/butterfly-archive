// 한 탐사와 여러 종별 기록을 입력하고 실패 시 작성 내용을 유지합니다.
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { FormEvent, Ref } from 'react'
import { addSurvey, updateSurvey, addPaperObservation, addWebObservation } from './api'
import { CAPTURE, LOCATION, PURPOSE, RESULT, SEX, STAGE, SOURCE_TYPE } from './models'
import type { LocationInput, Observation, ObservationInput, Species, Survey, SurveyInput, Tag, Coordinate } from './models'
import LocationPicker from './LocationPicker'
import TagPicker from './TagPicker'
import PhotoPicker from './PhotoPicker'
import SpeciesPicker from './SpeciesPicker'

export function Options({ values }: { values: Record<string, string> }) {
  return Object.entries(values).map(([value, text]) => <option value={value} key={value}>{text}</option>)
}
interface PhotoLocationHandle { apply: (point: Coordinate) => void }
function LocationFields({ prefix, initial, photoRef }: { prefix: string; initial?: LocationInput; photoRef?: Ref<PhotoLocationHandle> }) {
  const [place, setPlace] = useState(initial?.place_name ?? '')
  const [latitude, setLatitude] = useState(String(initial?.latitude ?? ''))
  const [longitude, setLongitude] = useState(String(initial?.longitude ?? ''))
  const [method, setMethod] = useState<SurveyInput['location_method']>(initial?.location_method ?? 'unknown')
  useImperativeHandle(photoRef, () => ({ apply: point => { setPlace(''); setLatitude(String(point.latitude)); setLongitude(String(point.longitude)); setMethod('gps') } }))
  return <div className="field-grid location-fields">
    <label className="wide">장소명<input name={`${prefix}place_name`} value={place} onChange={e => setPlace(e.target.value)} maxLength={200} /></label>
    <label>위도<input name={`${prefix}latitude`} value={latitude} onChange={e => { setLatitude(e.target.value); setMethod(!e.target.value && !longitude ? 'unknown' : 'manual') }} type="number" min={-90} max={90} step="any" placeholder="선택" /></label>
    <label>경도<input name={`${prefix}longitude`} value={longitude} onChange={e => { setLongitude(e.target.value); setMethod(!e.target.value && !latitude ? 'unknown' : 'manual') }} type="number" min={-180} max={180} step="any" placeholder="선택" /></label>
    <label>위치 방식<select name={`${prefix}location_method`} value={method} onChange={e => setMethod(e.target.value as SurveyInput['location_method'])}><Options values={LOCATION} /></select></label>
    <LocationPicker onApply={value => { if (value.place_name) setPlace(value.place_name); setLatitude(String(value.latitude)); setLongitude(String(value.longitude)); setMethod(value.location_method) }} />
  </div>
}
function ObservationFields({ rowKey, index, species, remove, initial, active, tagOptions, onTagCreated, commonTags, onTagBusy, onPhotoBusy, sourcePreset, source, speciesId, onSpeciesChange }: { speciesId:string; onSpeciesChange:(id:string)=>void; source: ObservationInput['source_type']; sourcePreset?: string; onPhotoBusy: (busy: boolean) => void; tagOptions: Tag[]; onTagCreated: (tag: Tag) => void; commonTags: string[]; onTagBusy: (busy: boolean) => void; active: boolean; rowKey: number; index: number; species: Species[]; remove: () => void; initial?: Observation }) {
  const [result, setResult] = useState<ObservationInput['result']>(initial?.result ?? 'observed')
  const [capture, setCapture] = useState<ObservationInput['capture_status']>(initial?.capture_status ?? 'unknown')
  const [sourceNote, setSourceNote] = useState(initial?.source_note ?? sourcePreset ?? '')
  const [tags, setTags] = useState(initial?.tags || [])
  const photoLocation = useRef<PhotoLocationHandle>(null)
  const [observationDate, setObservationDate] = useState(initial?.observation_date || '')
  const [observationTime, setObservationTime] = useState(initial?.observation_time || '')
  const prefix = `record-${rowKey}-`
  const speciesName=species.find(s=>String(s.id)===speciesId)?.korean_name
  return <fieldset hidden={!active} data-row-key={rowKey} className="record-fields"><legend>종별 기록 {index + 1}{speciesName ? ` · ${speciesName}` : ''}</legend>
    <div className="field-grid observation-grid">

      <label>결과<select name={`${prefix}result`} value={result} onChange={e => setResult(e.target.value as ObservationInput['result'])}><Options values={RESULT} /></select></label>
      <SpeciesPicker name={`${prefix}species_id`} species={species} value={speciesId} onChange={onSpeciesChange} required={!!sourcePreset || result==='not_found'}/>
      {source==='indirect' ? <label>개별 날짜 · 선택<input name={`${prefix}observation_date`} value={observationDate} onChange={e => setObservationDate(e.target.value)} type="date" /></label> : <><input type="hidden" name={`${prefix}observation_date`} value={initial?.observation_date||''}/><p className="hint">관찰 날짜는 탐사 날짜를 사용합니다. 다른 날의 관찰은 별도 탐사로 등록해 주세요.{initial?.observation_date&&` 기존 개별 날짜 ${initial.observation_date}는 보존합니다.`}</p></>}
      <label>관찰 시각 · 선택<input name={`${prefix}observation_time`} value={observationTime} onChange={e => setObservationTime(e.target.value)} type="time" step="0.000001" /></label>
      {result === 'observed' && <>
        <label>성장 단계<select className="stage-select" name={`${prefix}stage`} defaultValue={initial?.stage ?? ''}><Options values={STAGE} /></select></label>
        <label>성별<select name={`${prefix}sex`} defaultValue={initial?.sex ?? ''}><Options values={SEX} /></select></label>
        <label>관찰 개체 수<input name={`${prefix}count`} defaultValue={initial?.count ?? ''} type="number" min={1} max={1000000} step={1} placeholder="미상" /></label>
        <label className="check"><input name={`${prefix}count_estimated`} defaultChecked={initial?.count_estimated ?? false} type="checkbox" />추정 개체 수</label>
        <label>채집 여부<select name={`${prefix}capture_status`} value={capture} onChange={e => setCapture(e.target.value as ObservationInput['capture_status'])}><Options values={CAPTURE} /></select></label>
        {capture === 'captured' && <label>채집 개체 수<input name={`${prefix}captured_count`} defaultValue={initial?.captured_count ?? ''} type="number" min={1} max={1000000} step={1} placeholder="미상" /></label>}
      </>}
    </div>
    {source === 'indirect' && <label><span>간접 관찰 출처 <span className="required-mark" aria-label="필수">*</span></span><input name={`${prefix}source_note`} value={sourceNote} readOnly={!!sourcePreset} onChange={e => setSourceNote(e.target.value)} maxLength={2000} required placeholder="원문 주소 또는 자료명·관찰자" /><span className="hint">채집 여부는 원 관찰자 기준이며 내 채집 이력에 포함하지 않습니다.</span></label>}
    {source === 'direct' && <input type="hidden" name={`${prefix}source_note`} value={sourceNote} />}
    {result === 'not_found' && <p className="hint">실제로 찾았으나 발견하지 못한 종만 기록해 주세요.</p>}
    <div className="individual-location"><h3>개별 위치 · 선택</h3><LocationFields prefix={prefix} initial={initial} photoRef={photoLocation} /></div>
    <TagPicker label="환경 태그" name={`${prefix}tags`} value={tags} onChange={setTags} options={tagOptions} onCreated={onTagCreated} inherited={commonTags} onBusyChange={onTagBusy} />
    <TagPicker category="individual" label="개체 태그" name={`${prefix}tags`} value={tags} onChange={setTags} options={tagOptions} onCreated={onTagCreated} inherited={commonTags} onBusyChange={onTagBusy} />
    <PhotoPicker name={`${prefix}photos`} initialIds={initial?.photo_ids || []} onBusy={onPhotoBusy} dateLabel={source==='direct'?'관찰 시각 적용':undefined} onDate={p => { if(source==='indirect')setObservationDate(p.date_candidate || ''); setObservationTime(p.time_candidate || '') }} onGPS={p => { if (p.latitude !== null && p.longitude !== null) photoLocation.current?.apply({ latitude: p.latitude, longitude: p.longitude }) }} />
    <label>기록 메모<textarea name={`${prefix}notes`} defaultValue={initial?.notes ?? ''} maxLength={5000} rows={1} /></label>
    {!initial && <button type="button" className="quiet" onClick={remove}>이 입력 항목 제거</button>}
  </fieldset>
}

export interface SurveyFormHandle { requestClose(): void }
export default function SurveyForm({ species, onSaved, onCancel, initial, tagOptions, onTagCreated, tagsError, onRetryTags, embedded = false, selectedObservationId, closeRef, sourcePaper }: { sourcePaper?: {id:number; title:string; url:string; kind?:'web'}; tagOptions: Tag[]; onTagCreated: (tag: Tag) => void; tagsError: string; onRetryTags: () => void; embedded?: boolean; selectedObservationId?: number | null; closeRef?: Ref<SurveyFormHandle>; initial?: Survey; species: Species[]; onSaved: (survey: Survey) => void; onCancel: () => void }) {
  const [keys, setKeys] = useState(initial ? initial.observations.map((_, index) => index) : [0])
  const [recordSpecies,setRecordSpecies]=useState<Record<number,string>>(()=>Object.fromEntries((initial?.observations||[]).map((record,index)=>[index,record.species_id===null?'':String(record.species_id)])))
  const [surveySource, setSurveySource] = useState<ObservationInput['source_type']>(initial?.observations[0]?.source_type ?? (sourcePaper ? 'indirect' : 'direct'))
  const allIndirect = surveySource === 'indirect'
  const [purpose, setPurpose] = useState<SurveyInput['purpose']>(initial?.purpose ?? 'general')
  const [nextKey, setNextKey] = useState(initial ? initial.observations.length : 1)
  const [activeKey, setActiveKey] = useState(() => Math.max(0, initial?.observations.findIndex(record => record.id === selectedObservationId) ?? 0))
  const [confirmClose, setConfirmClose] = useState(false)
  const [commonTags, setCommonTags] = useState(initial?.tags || [])
  const [tagRequests, setTagRequests] = useState(0)
  const [photoRequests, setPhotoRequests] = useState(0)
  const photoLocation = useRef<PhotoLocationHandle>(null)
  const [surveyDate, setSurveyDate] = useState(initial?.survey_date || '')
  const photoBusy = (active: boolean) => setPhotoRequests(count => count + (active ? 1 : -1))
  const tagBusy = (active: boolean) => setTagRequests(count => count + (active ? 1 : -1))
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  useImperativeHandle(closeRef, () => ({requestClose() { if (!busy && !tagRequests && !photoRequests) setConfirmClose(true) }}), [busy, tagRequests, photoRequests])
  useEffect(() => {
    if (embedded) return
    const element = dialog.current
    const previous = document.activeElement
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [embedded])
  const [error, setError] = useState('')
  const [evidence, setEvidence] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || tagRequests > 0 || photoRequests > 0) return
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
        source_type: surveySource, source_note: str(`${p}source_note`),
        observation_date: str(`${p}observation_date`) || null, observation_time: str(`${p}observation_time`) || null,
        stage: (str(`${p}stage`) || 'unknown') as ObservationInput['stage'],
        sex: (str(`${p}sex`) || 'unknown') as ObservationInput['sex'], count: num(`${p}count`),
        count_estimated: data.has(`${p}count_estimated`),
        identification: (result === 'observed' && num(`${p}species_id`) ? 'user_confirmed' : 'unidentified') as ObservationInput['identification'],
        capture_status: (result === 'not_found' ? 'not_captured' : str(`${p}capture_status`)) as ObservationInput['capture_status'],
        captured_count: num(`${p}captured_count`), notes: str(`${p}notes`), tags: data.getAll(`${p}tags`).map(String), photo_ids: data.getAll(`${p}photos`).map(Number) }
    })
    setBusy(true); setError('')
    try {
      const value = { ...location('survey-'), survey_date: str('survey_date'), purpose: allIndirect ? 'online_research' as const : purpose, notes: str('notes'), tags: commonTags, photo_ids: data.getAll('survey-photos').map(Number), observations }
      const saved = initial ? await updateSurvey(initial.id, { ...value, expected_updated_at: initial.updated_at, observations: observations.map((item, index) => ({ ...item, id: initial.observations[keys[index]]?.id ?? null })) }) : sourcePaper ? await (sourcePaper.kind === 'web' ? addWebObservation : addPaperObservation)(sourcePaper.id, evidence, value) : await addSurvey(value)
      onSaved(saved)
    } catch (error) {
      const message = error instanceof Error ? error.message : '저장에 실패했습니다.'
      const match = /종별 기록 (\d+)/.exec(message)
      if (match && keys[Number(match[1]) - 1] !== undefined) setActiveKey(keys[Number(match[1]) - 1])
      setError(message)
    }
    finally { setBusy(false) }
  }
  const content = <form onSubmit={submit} noValidate className="survey-form survey-modal-form">
      {!embedded && <header className="survey-modal-header"><div><span className="eyebrow">BUTTERFLY ARCHIVE · 탐사 기록</span><h2 id="survey-dialog-title">{initial ? '탐사 기록 수정' : sourcePaper ? (sourcePaper.kind === 'web' ? '웹 자료 간접 관찰 등록' : '논문 사례 간접 관찰 등록') : '새 탐사 등록'}</h2></div><p className="hint">날짜와 장소명 또는 좌표는 필수입니다.<br />직접 관찰은 탐사 날짜를 사용합니다. 개별 위치를 비우면 탐사 위치를 사용하며 기상은 저장 후 연결합니다.</p></header>}
      {error && <p role="alert" className="error survey-error">{error}</p>}
      <fieldset disabled={busy || tagRequests > 0} className="survey-modal-fields">
        <div className="survey-columns">
          <section className="survey-common"><h3>탐사 공통 정보</h3>{sourcePaper && <><p className="hint">{sourcePaper.kind === 'web' ? '웹 원문' : '논문'}: {sourcePaper.title}<br />게시일이나 발표일을 관찰일로 사용하지 마세요. 원문에 관찰 날짜·장소가 확인되는 사례만 입력합니다.</p><label><span>{sourcePaper.kind === 'web' ? '원문 근거' : '근거 페이지·표·그림 번호'} <span className="required-mark" aria-label="필수">*</span></span><input value={evidence} onChange={e => setEvidence(e.target.value)} required maxLength={1000} placeholder="예: 12쪽 표 2, 사례 3" /></label></>}<div className="field-grid">
            <label>관찰 출처<select value={surveySource} disabled={!!initial || !!sourcePaper} onChange={e => setSurveySource(e.target.value as ObservationInput['source_type'])}><Options values={SOURCE_TYPE} /></select></label><label><span>탐사 날짜 <span className="required-mark" aria-label="필수">*</span></span><input name="survey_date" value={surveyDate} onChange={e => setSurveyDate(e.target.value)} type="date" required /></label>
            <label>탐사 목적<select name="purpose" value={allIndirect ? 'online_research' : purpose} disabled={allIndirect} onChange={e => setPurpose(e.target.value as SurveyInput['purpose'])}><Options values={PURPOSE} /></select></label>
          </div><p className="hint"><span className="required-mark">*</span> 위치: 장소명 또는 위도·경도 한 쌍 중 하나를 입력해 주세요. 위치 없는 간접 자료는 예외입니다.</p><LocationFields prefix="survey-" initial={initial} photoRef={photoLocation} />
            <PhotoPicker maxPhotos={3} name="survey-photos" initialIds={initial?.photo_ids || []} onBusy={photoBusy} dateLabel="탐사 날짜 적용" onDate={p => setSurveyDate(p.date_candidate || '')} onGPS={p => { if (p.latitude !== null && p.longitude !== null) photoLocation.current?.apply({ latitude: p.latitude, longitude: p.longitude }) }} />
            {tagsError && <p className="error" role="alert">{tagsError}<button type="button" onClick={onRetryTags}>태그 목록 다시 읽기</button></p>}
            <TagPicker label="탐사 공통 환경 태그" name="survey-tags" value={commonTags} onChange={setCommonTags} options={tagOptions} onCreated={onTagCreated} onBusyChange={tagBusy} />
            <TagPicker category="individual" label="탐사 공통 개체 태그" name="survey-tags" value={commonTags} onChange={setCommonTags} options={tagOptions} onCreated={onTagCreated} onBusyChange={tagBusy} />
            <label>탐사 메모<textarea name="notes" defaultValue={initial?.notes} maxLength={5000} rows={3} /></label>
            <p className="hint">개별 장소명만 입력하면 탐사 좌표를 복사하지 않습니다. 모르는 수량·시각은 비워 두세요.</p>
            {initial && <p className="hint">기존 개별 지정 값과 기상자료는 보존합니다. 기상을 자동 재조회하지 않습니다.</p>}
          </section>
          <section className="survey-observations"><div className="record-switcher"><label>종별 입력 항목<select value={keys.includes(activeKey) ? activeKey : ''} onChange={e => setActiveKey(Number(e.target.value))}>{!keys.length && <option value="">종별 기록 없음</option>}{keys.map((key, index) => <option key={key} value={key}>{[`종별 기록 ${index+1}`,species.find(s=>String(s.id)===recordSpecies[key])?.korean_name].filter(Boolean).join(' · ')}</option>)}</select></label><button type="button" disabled={keys.length >= 100} onClick={() => { setKeys([...keys, nextKey]); setActiveKey(nextKey); setNextKey(nextKey + 1) }}>종별 기록 추가</button><small>총 {keys.length}건</small></div>
            {keys.map((key, index) => <ObservationFields speciesId={recordSpecies[key]||''} onSpeciesChange={id=>setRecordSpecies(current=>({...current,[key]:id}))} source={surveySource} sourcePreset={sourcePaper ? `${sourcePaper.url} · ${sourcePaper.title.slice(0, 500)}` : undefined} key={key} rowKey={key} index={index} active={key === activeKey} initial={initial?.observations[key]} species={species} tagOptions={tagOptions} onTagCreated={onTagCreated} commonTags={commonTags} onTagBusy={tagBusy} onPhotoBusy={photoBusy} remove={() => { const remaining = keys.filter(k => k !== key); setKeys(remaining); setActiveKey(remaining[0] ?? 0) }} />)}
            {!keys.length && <p className="empty">종별 기록 없이 탐사만 저장할 수 있습니다. 미발견 기록을 자동 생성하지 않습니다.</p>}
          </section>
        </div>
        <footer className="survey-modal-footer">{confirmClose ? <><span>작성 중인 내용을 저장하지 않고 닫으시겠습니까?</span><button type="button" onClick={() => setConfirmClose(false)}>계속 작성</button><button type="button" onClick={onCancel}>저장하지 않고 닫기</button></> : <><small>전환한 종별 항목의 입력도 함께 저장됩니다.</small><button type="button" disabled={photoRequests > 0} onClick={() => setConfirmClose(true)}>취소</button><button type="submit" className="primary" disabled={photoRequests > 0}>{busy ? '저장 중…' : initial ? '수정 저장' : '탐사 저장'}</button></>}</footer>
      </fieldset>
    </form>
  return embedded ? content : <dialog ref={dialog} className="survey-dialog" aria-labelledby="survey-dialog-title" onCancel={e => { e.preventDefault(); if (!busy && tagRequests === 0 && photoRequests === 0) setConfirmClose(true) }}>{content}</dialog>
}
