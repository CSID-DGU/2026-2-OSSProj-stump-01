// Express 앱 조립. 서버 실행(listen)은 server.ts, 테스트는 이 앱을 바로 불러 쓴다.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';
import { uploadDir } from './common/config.js';
import { getPool } from './common/db.js';
import { errorHandler, routeNotFound } from './common/errors.js';
import { applicationsRouter } from './citizen/applications.js';
import { authRouter } from './citizen/auth.js';
import { monthlyReportsRouter } from './citizen/monthly-reports.js';
import { notificationsRouter } from './citizen/notifications.js';
import { recordsRouter } from './citizen/records.js';
import { organizationsRouter } from './citizen/organizations.js';
import { meRouter, storyReactionsRouter } from './citizen/reactions.js';
import { citizenRentalItemsRouter, citizenRentalsRouter } from './citizen/rentals.js';
import { treeRingsRouter } from './citizen/rings.js';
import { storyEntriesRouter, treeStoryRouter } from './citizen/stories.js';
import { treesRouter } from './citizen/trees.js';
import { districtRouter } from './district/index.js';
import { volunteerHoursRouter } from './district/volunteer-hours.js';
import { weatherRouter } from './district/weather.js';

// openapi.yaml은 Src/backend에 있다. 빌드 결과(dist/app.js)에서 실행해도 같은 파일을 찾도록 한 단계 위를 본다.
const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = basename(here) === 'dist' ? dirname(here) : here;
const openapi = parse(readFileSync(join(backendRoot, 'openapi.yaml'), 'utf8'));

export function createApp() {
  const app = express();
  app.use(express.json());

  // 서버와 DB가 살아 있는지 확인한다
  app.get('/health', async (_req, res) => {
    await getPool().query('SELECT 1');
    res.json({ status: 'ok' });
  });

  // API 명세(Swagger UI): http://localhost:4000/docs
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

  // 시민 모듈
  app.use('/auth', authRouter); // #3 회원·인증
  app.use('/trees', treesRouter); // #4 나무 조회 (로그인 없음)
  app.use('/trees', treeStoryRouter); // #64 나무별 공동 이야기 (보기는 로그인 없음)
  app.use('/trees', treeRingsRouter); // #12 디지털 나이테 월별 집계 (로그인 없음)
  app.use('/story-entries', storyEntriesRouter); // #64 이야기 글 하나 (로그인 없음)
  app.use('/story-entries', storyReactionsRouter); // #65 QR 호응 남기기 (로그인 없음)
  app.use('/me', meRouter); // #65 내가 받은 호응
  app.use('/organizations', organizationsRouter); // #66 단체 계정·단체 리포트
  app.use('/notifications', notificationsRouter); // #7 알림
  app.use('/applications', applicationsRouter); // #6 돌보미 신청서
  app.use('/records', recordsRouter); // #5 활동 기록·이상 신고
  app.use('/monthly-reports', monthlyReportsRouter); // #62 월간 보고서 작성·제출
  app.use('/rental-items', citizenRentalItemsRouter); // #63 물품 목록
  app.use('/rentals', citizenRentalsRouter); // #63 물품 신청
  // 시민이 올린 사진 (common/uploads.ts). 파일 이름이 무작위라 주소를 아는 사람만 본다
  app.use('/uploads', express.static(uploadDir()));

  // 구청 모듈
  app.use('/admin', districtRouter);
  // 내 봉사시간(시민, 로그인 필요). 봉사시간 기록이 구청-BE 담당이라 district/에 있다.
  app.use('/volunteer-hours', volunteerHoursRouter);
  // 오늘의 날씨(시민 홈, 로그인 없음). 날씨 수집이 구청-BE·데이터 담당이라 district/에 있다.
  app.use('/weather', weatherRouter);

  app.use(routeNotFound);
  app.use(errorHandler);
  return app;
}
