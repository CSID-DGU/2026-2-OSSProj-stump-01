import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // .env 는 Src/.env 하나를 백엔드·docker compose 와 같이 쓴다. VITE_ 로 시작하는 변수(카카오맵 키)만 브라우저에 노출된다.
  envDir: '../..',
  server: {
    port: 5173,
    // 개발 중에는 /api 로 시작하는 요청을 백엔드(localhost:4000)로 넘긴다. 화면 코드는 "/api/..." 만 부르면 된다.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
})
