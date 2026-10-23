import { useEffect, useState } from 'react'
import { getHealth } from './api'
import './App.css'

export default function App() {
  const [status, setStatus] = useState('연결 확인 중입니다.')
  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal)
      .then(() => setStatus('React → FastAPI → SQLite 연결 성공'))
      .catch(() => {
        if (!controller.signal.aborted) setStatus('연결 실패: 백엔드 실행 상태를 확인해 주세요.')
      })
    return () => controller.abort()
  }, [])
  return (
    <main>
      <p className="eyebrow">BUTTERFLY ARCHIVE</p>
      <h1>나비 출현 추적 시스템</h1>
      <p>개발환경 연결 확인</p>
      <p role="status">{status}</p>
      <small>현재 단계에서는 관찰 기록 기능을 제공하지 않습니다.</small>
    </main>
  )
}
