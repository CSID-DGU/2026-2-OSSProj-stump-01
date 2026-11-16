import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { resetData } from '../test/fixtures.js';
import { hashPassword, verifyPassword } from './auth.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const account = { email: 'kth@example.com', password: 'password123', nickname: '태형' };

beforeEach(resetData);
afterAll(closePool);

describe('비밀번호 해시', () => {
  it('같은 비밀번호는 통과, 다른 비밀번호는 거부', async () => {
    const stored = await hashPassword('password123');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('password123', stored)).toBe(true);
    expect(await verifyPassword('password124', stored)).toBe(false);
  });
});

describe('POST /auth/signup', () => {
  it('가입하면 201, 토큰과 사용자를 주고 비밀번호는 평문으로 저장하지 않는다', async () => {
    const res = await request(api).post('/auth/signup').send(account);

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user).toEqual({
      id: expect.any(Number),
      email: 'kth@example.com',
      nickname: '태형',
      role: 'citizen',
      agency: null,
      educationCompleted: false,
    });
    expect(JSON.stringify(res.body)).not.toContain('scrypt$');

    const { rows } = await getPool().query('SELECT password_hash FROM users WHERE email = $1', [account.email]);
    expect(rows[0].password_hash).not.toBe('password123');
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
  });

  it('짧은 비밀번호·잘못된 이메일·빈 활동 이름은 400', async () => {
    const short = await request(api).post('/auth/signup').send({ ...account, password: 'short' });
    const badEmail = await request(api).post('/auth/signup').send({ ...account, email: 'not-an-email' });
    const blank = await request(api).post('/auth/signup').send({ ...account, nickname: '   ' });
    expect([short.status, badEmail.status, blank.status]).toEqual([400, 400, 400]);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('이미 가입된 이메일은 409', async () => {
    await request(api).post('/auth/signup').send(account);
    const res = await request(api).post('/auth/signup').send({ ...account, nickname: '다른이름' });
    expect(res.status).toBe(409);
  });
});

describe('POST /auth/login, GET /auth/me', () => {
  beforeEach(async () => {
    await request(api).post('/auth/signup').send(account);
  });

  it('맞는 비밀번호면 토큰을 주고, 그 토큰으로 /auth/me 가 열린다', async () => {
    const login = await request(api).post('/auth/login').send({ email: account.email, password: account.password });
    expect(login.status).toBe(200);
    expect(login.body.user.nickname).toBe('태형');

    const me = await request(api).get('/auth/me').set(auth(login.body.token));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: 'kth@example.com', role: 'citizen' });
  });

  it('틀린 비밀번호와 없는 이메일은 같은 401 메시지', async () => {
    const wrong = await request(api).post('/auth/login').send({ email: account.email, password: 'nope-nope-nope' });
    const missing = await request(api).post('/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.error.message).toBe(missing.body.error.message);
  });

  it('토큰 없이 /auth/me 는 401, 구청 담당자는 agency 가 보인다', async () => {
    expect((await request(api).get('/auth/me')).status).toBe(401);

    const { rows } = await getPool().query<{ id: number }>(
      `INSERT INTO users (email, password_hash, nickname, role, agency) VALUES ('officer@test.local', $1, '김주무관', 'officer', '중구') RETURNING id`,
      [await hashPassword('password123')],
    );
    const login = await request(api).post('/auth/login').send({ email: 'officer@test.local', password: 'password123' });
    expect(login.body.user).toMatchObject({ id: rows[0]!.id, role: 'officer', agency: '중구' });
  });
});
