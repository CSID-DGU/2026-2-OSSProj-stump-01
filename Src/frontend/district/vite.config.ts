import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중에는 Vite가 아래 경로 요청을 API 서버로 넘겨 준다(proxy).
// 브라우저 입장에서는 같은 주소(localhost:5174)로 요청하므로 API 서버에 CORS 설정이 없어도 된다.
// /trees 는 나무 지도(#27)가 쓰는 공개 나무 조회 API다.
const API_PATHS = ['/admin', '/auth', '/trees', '/weather', '/volunteer-hours', '/health'];

export default defineConfig(({ mode }) => {
  // API 서버 주소는 district/.env의 API_SERVER로 바꿀 수 있다(없으면 로컬 4000번)
  const env = loadEnv(mode, '.', '');
  const apiServer = env.API_SERVER || 'http://localhost:4000';

  return {
    plugins: [react()],
    // 카카오맵 키(VITE_KAKAO_MAP_KEY)는 시민 웹·백엔드와 같은 Src/.env 하나에 둔다
    envDir: '../..',
    server: {
      port: 5174, // 시민 웹(5173)과 겹치지 않게
      proxy: Object.fromEntries(API_PATHS.map((path) => [path, apiServer])),
      // 공용 지도 컴포넌트(Src/frontend/shared)는 이 폴더 밖에 있어서, 개발 서버가 읽을 수 있게 허용한다(이 폴더 기준 경로)
      fs: { allow: ['.', '../shared'] },
    },
  };
});
