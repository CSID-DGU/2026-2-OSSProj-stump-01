// API 서버 실행: Src/backend에서 `npm run dev`
import { createApp } from './app.js';
import { port } from './common/config.js';

const p = port();
createApp().listen(p, () => {
  console.log(`TreeCare API: http://localhost:${p}  (명세: http://localhost:${p}/docs)`);
});
