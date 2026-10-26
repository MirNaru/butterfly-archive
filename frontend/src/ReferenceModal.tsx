// 기본 정보 표를 유지한 채 편집 폼을 중앙의 접근 가능한 대화상자로 엽니다.
import { useEffect, useRef, useState } from 'react'
import type { ReferenceDocument, Species, SpeciesReference } from './models'
import ReferenceEditor from './ReferenceEditor'
export default function ReferenceModal({ species, initial, onClose, onSaved }: { species: Species; initial: ReferenceDocument; onClose: () => void; onSaved: (value: SpeciesReference) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog className="reference-dialog" ref={dialog} aria-label={`${species.korean_name} 정보 편집`} onCancel={e => { e.preventDefault(); if (!busy) onClose() }}><ReferenceEditor species={species} initial={initial} onClose={onClose} onSaved={onSaved} onBusyChange={setBusy} /></dialog>
}
