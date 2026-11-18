import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중에는 Vite가 아래 경로 요청을 API 서버로 넘겨 준다(proxy).
// 브라우저 입장에서는 같은 주소(localhost:5174)로 요청하므로 API 서버에 CORS 설정이 없어도 된다.
const API_PATHS = ['/admin', '/auth', '/weather', '/volunteer-hours', '/health'];

export default defineConfig(({ mode }) => {
  // API 서버 주소는 district/.env의 API_SERVER로 바꿀 수 있다(없으면 로컬 4000번)
  const env = loadEnv(mode, '.', '');
  const apiServer = env.API_SERVER || 'http://localhost:4000';

  return {
    plugins: [react()],
    server: {
      port: 5174, // 시민 웹(5173)과 겹치지 않게
      proxy: Object.fromEntries(API_PATHS.map((path) => [path, apiServer])),
    },
  };
});
