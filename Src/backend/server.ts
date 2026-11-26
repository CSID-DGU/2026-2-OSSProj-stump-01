// API 서버 실행: Src/backend에서 `npm run dev`
import { createApp } from './app.js';
import { port } from './common/config.js';
import { startApplicationEndJob } from './district/application-lifecycle.js';

const p = port();
createApp().listen(p, () => {
  console.log(`TreeCare API: http://localhost:${p}  (명세: http://localhost:${p}/docs)`);
  startApplicationEndJob(); // 활동 기간이 끝난 신청서를 종료한다
});
