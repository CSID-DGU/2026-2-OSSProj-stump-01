// API 서버 실행: Src/backend에서 `npm run dev`
import { createApp } from './app.js';
import { port } from './common/config.js';
import { startApplicationEndJob } from './district/application-lifecycle.js';
import { startWeatherDailyJob } from './district/weather-daily.js';

const p = port();
createApp().listen(p, () => {
  console.log(`TreeCare API: http://localhost:${p}  (명세: http://localhost:${p}/docs)`);
  startApplicationEndJob(); // 활동 기간이 끝난 신청서를 종료한다
  startWeatherDailyJob(); // 기상청 ASOS 일자료(어제까지 최근 3일)를 받아 넣는다
});
