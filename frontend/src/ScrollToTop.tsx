// 긴 목록과 열린 팝업에서 현재 스크롤 영역의 맨 위로 이동합니다.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
export default function ScrollToTop() {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    function track(event: Event) {
      const element = event.target
      if (element instanceof HTMLElement) setTarget(element.scrollTop > 200 ? element : null)
    }
    document.addEventListener('scroll', track, true)
    return () => document.removeEventListener('scroll', track, true)
  }, [])
  if (!target?.isConnected || target.scrollTop <= 200) return null
  const dialog = target.closest('dialog[open]')
  if (document.querySelector('dialog[open]') && !dialog) return null
  return createPortal(<button type="button" className="scroll-top-button" onClick={() => { target.scrollTo({ top: 0, behavior: 'instant' }); setTarget(null) }}>맨 위로</button>, dialog ?? document.body)
}
