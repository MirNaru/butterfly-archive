// 기본 API 주소와 별도 검증 서버의 주소를 구분합니다.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': process.env.BUTTERFLY_API_TARGET || 'http://127.0.0.1:8000' },
  },
})
