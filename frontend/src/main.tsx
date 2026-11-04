import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 실행기에서 받은 키는 URL 기록에서 지우고 로컬 HttpOnly 세션으로 교환합니다.
async function start() {
  const bootstrap = new URLSearchParams(location.hash.slice(1)).get('local')
  if (bootstrap) {
    history.replaceState(null, '', location.pathname + location.search)
    const response = await fetch('/api/local/session', {method:'POST',headers:{'X-Butterfly-Local':bootstrap}})
    if (!response.ok) { document.body.textContent='PC 실행 파일로 화면을 다시 열어 주세요.'; return }
  }
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
}
void start()
