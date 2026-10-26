// 통합 기록표에서 선택한 종의 참고 정보와 기존 편집 기능을 제공합니다.
import { useState } from 'react'
import { getReference } from './api'
import type { ExplorationRow, ReferenceDocument } from './models'
import ReferenceEditor from './ReferenceEditor'
export default function ReferenceDetails({ row, onEditing, onUpdated }: { row: ExplorationRow; onEditing: (editing: boolean) => void; onUpdated: (id: number, hostPlants: string) => void }) {
  const [document, setDocument] = useState<ReferenceDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function edit() {
    setBusy(true); setError(''); onEditing(true)
    try { setDocument(await getReference(row.id)) }
    catch (e) { setError(e instanceof Error ? e.message : '기본 정보를 읽지 못했습니다.'); onEditing(false) }
    finally { setBusy(false) }
  }
  if (document) return <ReferenceEditor species={row} initial={document} onClose={() => { setDocument(null); onEditing(false) }} onSaved={reference => { setDocument(null); onEditing(false); onUpdated(row.id, reference.host_plants) }} />
  return <article className="detail"><span className="eyebrow">종 참고 · 관찰 기록 아님</span><h2>{row.korean_name}</h2><p>{row.scientific_name || '학명 미등록'}</p>{error && <p role="alert" className="error">{error}</p>}<dl><dt>기주식물</dt><dd>{row.reference.host_plants || '미등록'}</dd><dt>분포 참고</dt><dd>{row.reference.regions.join(', ') || '미등록'}</dd><dt>예상 출현 기간</dt><dd>{row.active === null ? '기간 미등록' : !row.active ? '현재 참고 기간 밖' : row.year_round ? '연중 참고 기간' : `약 ${row.days_left}일 남음`}{row.next_period && ' · 올해 다음 구간 있음'}</dd><dt>내 채집 이력</dt><dd>{({ unknown: '미확인', captured: '채집한 종', not_captured: '미채집 확인' })[row.capture_history]}</dd><dt>미접</dt><dd>{row.old_vagrant ? '미갱신 미접' : row.reference.vagrant === null ? '미확인' : row.reference.vagrant ? `미접 · ${row.reference.sighting_years.join(', ') || '연도 미확인'}` : '미접 아님'}</dd><dt>보호종</dt><dd>{row.reference.protected === null ? '미확인' : row.reference.protected ? '해당' : '아님'}</dd><dt>목표 지역·기간 채집 판단</dt><dd>{({ unknown: '미확인', permitted: '가능 · 사용자 확인', prohibited: '불가 · 사용자 확인' })[row.permission]}</dd><dt>출현·분포 자료 출처</dt><dd>{row.reference.source || '미등록'}</dd></dl><p className="hint">참고 분포를 실제 관찰 위치로 표시하지 않으며, 출현과 채집 가능성을 자동 확정하지 않습니다.</p><button disabled={busy} onClick={() => void edit()}>기본 정보 편집</button></article>
}
