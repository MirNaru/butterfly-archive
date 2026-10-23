// 명시적인 주소 검색과 지도 선택만 실행하며 적용 전 원래 입력값을 유지합니다.
import { useState } from 'react'
import { findAddress, findCoordinateAddress } from './api'
import MapView from './MapView'
import type { AddressCandidate, Coordinate, LocationInput } from './models'

export default function LocationPicker({ onApply }: { onApply: (value: LocationInput) => void }) {
  const [open, setOpen] = useState(false)
  const [visited, setVisited] = useState(false)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<AddressCandidate[]>([])
  const [point, setPoint] = useState<Coordinate | null>(null)
  const [address, setAddress] = useState('')
  const [method, setMethod] = useState<'map' | 'address'>('map')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function search() {
    setBusy(true); setError(''); setNotice('')
    try { const rows = await findAddress(query); setCandidates(rows); if (!rows.length) setNotice('주소 검색 결과가 없습니다. 지도에서 위치를 선택하거나 직접 입력해 주세요.') }
    catch (e) { setError(e instanceof Error ? e.message : '주소 검색에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function reverse() {
    if (!point) return
    setBusy(true); setError(''); setNotice('')
    try { const value = await findCoordinateAddress(point); setAddress(value.address || ''); if (!value.address) setNotice('주소가 없는 위치입니다. 좌표만 적용할 수 있습니다.') }
    catch (e) { setError(e instanceof Error ? e.message : '주소 확인에 실패했습니다.') }
    finally { setBusy(false) }
  }
  return <div className="location-picker wide">
    <button type="button" onClick={() => setOpen(v => !v)}>{open ? '위치 선택 닫기' : '지도·주소로 위치 선택'}</button>
    <div hidden={!open}>
      <p className="hint">검색한 주소와 주소 확인을 요청한 좌표는 네이버로 전송됩니다. 지도 위치를 고른 뒤 적용해 주세요.</p>
      <label>주소 검색<input value={query} onChange={e => setQuery(e.target.value)} maxLength={200} placeholder="도로명 또는 지번 주소" /></label>
      <button type="button" disabled={busy || query.trim().length < 2} onClick={() => void search()}>주소 검색</button>
      {candidates.map((c, i) => <button type="button" disabled={busy} className="address-candidate" key={i} onClick={() => { setPoint(c); setAddress(c.address); setMethod('address') }}>{c.address}</button>)}
      <button type="button" onClick={() => setVisited(true)} disabled={visited}>지도 열기</button>
      {visited && <MapView shown={open} pins={point ? [{ ...point, id: 'draft', surveyId: 0, label: '선택 위치' }] : []} focus={point} onPick={busy ? undefined : p => { setPoint(p); setAddress(''); setMethod('map'); setNotice('') }} />}
      {point && <><p>위도 {point.latitude.toFixed(6)} · 경도 {point.longitude.toFixed(6)}{address && ` · ${address}`}</p>
        <button type="button" disabled={busy} onClick={() => void reverse()}>선택 좌표의 주소 확인</button>
        <button type="button" disabled={busy} onClick={() => { onApply({ ...point, place_name: address, location_method: method }); setOpen(false) }}>이 위치 적용</button></>}
      {busy && <p role="status">위치 정보를 조회하는 중입니다.</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  </div>
}
