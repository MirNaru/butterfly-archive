// 브라우저 내부에 화면 위치만 보관하며 저장 실패가 기록 작업을 막지 않게 합니다.
export function readView(key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`butterfly-view:${key}`) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}
export function writeView(key: string, value: object) {
  try { localStorage.setItem(`butterfly-view:${key}`, JSON.stringify(value)) } catch { /* 저장 공간이 없어도 화면은 사용할 수 있습니다. */ }
}
