import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createUser, resetData } from '../test/fixtures.js';
import { hashPassword, verifyPassword } from './auth.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const person = { name: '김태형', birthDate: '2003-05-01', phone: '010-1234-5678' };

/** 개발용 가짜 본인인증 "인증 창"을 거쳐 거래 번호를 받는다 */
async function verifyIdentity(who: { name: string; birthDate: string; phone: string } = person): Promise<string> {
  const res = await request(api).post('/auth/identity/mock').send(who);
  expect(res.status).toBe(200);
  return res.body.identityToken;
}

/** 가입 본문. 본인인증 거래 번호와 주소를 함께 낸다 */
async function account(overrides: Record<string, unknown> = {}) {
  return {
    email: 'kth@example.com',
    password: 'password123',
    nickname: '태형',
    identityToken: await verifyIdentity(),
    postalCode: '04620',
    address: '서울특별시 중구 필동로1길 30',
    ...overrides,
  };
}

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
    const res = await request(api).post('/auth/signup').send(await account());

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user).toEqual({
      id: expect.any(Number),
      email: 'kth@example.com',
      nickname: '태형',
      role: 'citizen',
      agency: null,
      educationCompleted: false,
      identityVerified: true,
      profile: {
        realName: '김태형', // 본인인증 결과
        birthDate: '2003-05-01',
        phone: '010-1234-5678',
        postalCode: '04620',
        address: '서울특별시 중구 필동로1길 30',
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('scrypt$');

    const { rows } = await getPool().query('SELECT password_hash, identity_ci_hash FROM users WHERE email = $1', ['kth@example.com']);
    expect(rows[0].password_hash).not.toBe('password123');
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(rows[0].identity_ci_hash).toMatch(/^[0-9a-f]{64}$/); // CI 원문이 아니라 해시
  });

  it('본인인증 없이, 또는 위조·잘못된 거래 번호로는 가입할 수 없다', async () => {
    const none = await request(api).post('/auth/signup').send(await account({ identityToken: undefined }));
    const forged = await request(api).post('/auth/signup').send(await account({ identityToken: 'forged.token.value' }));
    expect(none.status).toBe(400);
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('IDENTITY_INVALID');
  });

  it('만 14세 미만은 403, 14번째 생일부터 가입한다', async () => {
    /** 오늘(한국 시간)에서 years년 전, 거기서 days일 옮긴 날 */
    const yearsAgo = (years: number, days = 0) => {
      const d = new Date(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() - years);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const signupBorn = async (birthDate: string, email: string) =>
      request(api).post('/auth/signup').send(await account({ email, identityToken: await verifyIdentity({ ...person, birthDate }) }));

    const young = await signupBorn(yearsAgo(14, 1), 'young@example.com'); // 내일이 14번째 생일
    expect(young.status).toBe(403);
    expect(young.body.error.code).toBe('UNDER_AGE');
    expect((await signupBorn(yearsAgo(14), 'ok@example.com')).status).toBe(201); // 오늘이 14번째 생일
  });

  it('같은 사람은 이메일을 바꿔도 계정을 하나만 만든다(휴대폰 번호가 달라도)', async () => {
    expect((await request(api).post('/auth/signup').send(await account())).status).toBe(201);
    const again = await request(api)
      .post('/auth/signup')
      .send(await account({ email: 'other@example.com', identityToken: await verifyIdentity({ ...person, phone: '010-9999-8888' }) }));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('IDENTITY_IN_USE');
  });

  it('주소가 없거나 우편번호가 5자리가 아니면 400', async () => {
    const noAddress = await request(api).post('/auth/signup').send(await account({ address: ' ' }));
    const badPostal = await request(api).post('/auth/signup').send(await account({ postalCode: '0462' }));
    expect([noAddress.status, badPostal.status]).toEqual([400, 400]);
  });

  it('짧은 비밀번호·잘못된 이메일·빈 활동 이름은 400', async () => {
    const short = await request(api).post('/auth/signup').send(await account({ password: 'short' }));
    const badEmail = await request(api).post('/auth/signup').send(await account({ email: 'not-an-email' }));
    const blank = await request(api).post('/auth/signup').send(await account({ nickname: '   ' }));
    expect([short.status, badEmail.status, blank.status]).toEqual([400, 400, 400]);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('이미 가입된 이메일은 409', async () => {
    await request(api).post('/auth/signup').send(await account());
    const res = await request(api)
      .post('/auth/signup')
      .send(await account({ nickname: '다른이름', identityToken: await verifyIdentity({ ...person, name: '다른사람' }) }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).not.toBe('IDENTITY_IN_USE');
  });
});

describe('POST /auth/login, GET /auth/me', () => {
  beforeEach(async () => {
    await request(api).post('/auth/signup').send(await account());
  });

  it('맞는 비밀번호면 토큰을 주고, 그 토큰으로 /auth/me 가 열린다', async () => {
    const login = await request(api).post('/auth/login').send({ email: 'kth@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    expect(login.body.user.nickname).toBe('태형');

    const me = await request(api).get('/auth/me').set(auth(login.body.token));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: 'kth@example.com', role: 'citizen', identityVerified: true, profile: { realName: '김태형' } });
  });

  it('틀린 비밀번호와 없는 이메일은 같은 401 메시지', async () => {
    const wrong = await request(api).post('/auth/login').send({ email: 'kth@example.com', password: 'nope-nope-nope' });
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

describe('PATCH /auth/me, POST /auth/me/identity', () => {
  let token: string;
  beforeEach(async () => {
    token = (await request(api).post('/auth/signup').send(await account())).body.token;
  });

  it('주소·별명은 본인이 고치고, 이름·휴대폰은 보내도 바뀌지 않는다', async () => {
    const res = await request(api)
      .patch('/auth/me')
      .set(auth(token))
      .send({ nickname: '은행지기', postalCode: '04538', address: '서울특별시 중구 명동길 1', realName: '가짜이름', phone: '010-0000-0000' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nickname: '은행지기', profile: { realName: '김태형', phone: '010-1234-5678', postalCode: '04538', address: '서울특별시 중구 명동길 1' } });

    const onlyName = await request(api).patch('/auth/me').set(auth(token)).send({ realName: '가짜이름' });
    expect(onlyName.status).toBe(400); // 고칠 수 있는 값이 없다
    const halfAddress = await request(api).patch('/auth/me').set(auth(token)).send({ address: '다른 주소' });
    expect(halfAddress.status).toBe(400); // 우편번호와 같이
  });

  it('휴대폰 번호가 바뀌면 본인인증을 다시 해서 바꾼다', async () => {
    const res = await request(api)
      .post('/auth/me/identity')
      .set(auth(token))
      .send({ identityToken: await verifyIdentity({ ...person, phone: '010-5555-6666' }) });
    expect(res.status).toBe(200);
    expect(res.body.profile.phone).toBe('010-5555-6666');
  });

  it('가입한 사람과 다른 사람으로는 다시 인증할 수 없다(계정은 본인만)', async () => {
    const res = await request(api)
      .post('/auth/me/identity')
      .set(auth(token))
      .send({ identityToken: await verifyIdentity({ ...person, name: '다른사람' }) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('IDENTITY_MISMATCH');
    const me = await request(api).get('/auth/me').set(auth(token));
    expect(me.body.profile.realName).toBe('김태형');
  });

  it('이 기능 전에 만든 계정은 여기서 처음 본인인증을 한다. 이미 쓰인 사람이면 409', async () => {
    const legacy = await createUser({ verified: false });
    const first = await request(api)
      .post('/auth/me/identity')
      .set(auth(legacy.token))
      .send({ identityToken: await verifyIdentity({ name: '옛계정', birthDate: '1990-01-01', phone: '010-2222-3333' }) });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ identityVerified: true, profile: { realName: '옛계정' } });

    const other = await createUser({ verified: false });
    const taken = await request(api).post('/auth/me/identity').set(auth(other.token)).send({ identityToken: await verifyIdentity() });
    expect(taken.status).toBe(409); // 김태형은 이미 가입함
  });
});

describe('POST /auth/identity/mock', () => {
  it('실제 인증 업체를 연결하면(IDENTITY_PROVIDER) 가짜 인증 창은 없다', async () => {
    const saved = process.env.IDENTITY_PROVIDER;
    process.env.IDENTITY_PROVIDER = 'nice';
    try {
      expect((await request(api).post('/auth/identity/mock').send(person)).status).toBe(404);
    } finally {
      if (saved === undefined) delete process.env.IDENTITY_PROVIDER;
      else process.env.IDENTITY_PROVIDER = saved;
    }
  });

  it('휴대폰 번호 형식이 아니면 400', async () => {
    expect((await request(api).post('/auth/identity/mock').send({ ...person, phone: '02-123-4567' })).status).toBe(400);
  });
});
