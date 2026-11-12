// Express 앱 조립. 서버 실행(listen)은 server.ts, 테스트는 이 앱을 바로 불러 쓴다.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';
import { getPool } from './common/db.js';
import { errorHandler, routeNotFound } from './common/errors.js';
import { districtRouter } from './district/index.js';
import { volunteerHoursRouter } from './district/volunteer-hours.js';

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

  // 구청 모듈. 시민 모듈(citizen/)은 시민-BE가 같은 방식으로 붙인다.
  app.use('/admin', districtRouter);
  // 내 봉사시간(시민, 로그인 필요). 봉사시간 기록이 구청-BE 담당이라 district/에 있다.
  app.use('/volunteer-hours', volunteerHoursRouter);

  app.use(routeNotFound);
  app.use(errorHandler);
  return app;
}
