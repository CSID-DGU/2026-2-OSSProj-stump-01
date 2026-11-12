import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser, resetData } from '../test/fixtures.js';
import { authenticate, requireOfficer } from './auth.js';
import { closePool } from './db.js';
import { errorHandler } from './errors.js';

// 인증 미들웨어만 시험하는 작은 앱
const app = express();
app.get('/officer-only', authenticate, requireOfficer, (req, res) => {
  res.json({ user: req.user });
});
app.use(errorHandler);

beforeEach(resetData);
afterAll(closePool);

describe('인증·권한', () => {
  it('토큰이 없으면 401', async () => {
    const res = await request(app).get('/officer-only');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('잘못된 토큰이면 401', async () => {
    const forged = jwt.sign({}, 'other-secret', { subject: '1' });
    const res = await request(app).get('/officer-only').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('시민이면 403', async () => {
    const citizen = await createUser();
    const res = await request(app).get('/officer-only').set('Authorization', `Bearer ${citizen.token}`);
    expect(res.status).toBe(403);
  });

  it('구청 담당자면 통과하고 관리청을 DB에서 읽는다', async () => {
    const officer = await createUser({ role: 'officer', agency: '종로구' });
    const res = await request(app).get('/officer-only').set('Authorization', `Bearer ${officer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: officer.id, role: 'officer', agency: '종로구' });
  });
});

describe('앱 공통', () => {
  const api = createApp();

  it('/health는 DB까지 확인한다', async () => {
    const res = await request(api).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('/admin 아래는 구청 담당자 토큰이 필요하다', async () => {
    const res = await request(api).get('/admin/anything');
    expect(res.status).toBe(401);
  });

  it('없는 경로는 404 에러 형식', async () => {
    const res = await request(api).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
