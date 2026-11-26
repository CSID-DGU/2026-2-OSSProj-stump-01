import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createActivity, createIncident, createTree, createUser, resetData } from '../test/fixtures.js';

const api = createApp();

beforeEach(resetData);
afterAll(closePool);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
type User = { id: number; token: string };

const createOrg = (user: User, name = '서울환경연합 중구지부') => request(api).post('/organizations').set(auth(user.token)).send({ name });
const join = (user: User, inviteCode: string) => request(api).post('/organizations/join').set(auth(user.token)).send({ inviteCode });

describe('POST /organizations', () => {
  it('시민이 단체를 만들면 만든 사람이 관리자가 되고 초대 코드가 발급된다', async () => {
    const me = await createUser();

    const res = await createOrg(me);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: '서울환경연합 중구지부', role: 'admin', memberCount: 1 });
    expect(res.body.inviteCode).toMatch(/^[A-Z0-9]{8}$/);
    const { rows } = await getPool().query('SELECT user_id, role FROM organization_members WHERE organization_id = $1', [res.body.id]);
    expect(rows).toEqual([{ user_id: me.id, role: 'admin' }]);
  });

  it('구청 담당자는 403, 로그인 없으면 401, 이름이 비면 400', async () => {
    const officer = await createUser({ role: 'officer' });
    expect((await createOrg(officer)).status).toBe(403);
    expect((await request(api).post('/organizations').send({ name: '단체' })).status).toBe(401);
    expect((await createOrg(await createUser(), '   ')).status).toBe(400);
  });
});

describe('POST /organizations/join', () => {
  it('초대 코드로 회원이 된다 (대소문자·앞뒤 공백은 가리지 않는다)', async () => {
    const admin = await createUser();
    const org = (await createOrg(admin)).body;
    const me = await createUser();

    const res = await join(me, `  ${org.inviteCode.toLowerCase()} `);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: org.id, name: org.name, role: 'member', memberCount: 2 });
    expect(res.body).not.toHaveProperty('inviteCode'); // 초대 코드는 관리자에게만 보인다
  });

  it('없는 코드는 404, 이미 회원이면 409, 구청 담당자는 403', async () => {
    const admin = await createUser();
    const org = (await createOrg(admin)).body;

    expect((await join(await createUser(), 'NOPE1234')).status).toBe(404);
    expect((await join(admin, org.inviteCode)).status).toBe(409);
    expect((await join(await createUser({ role: 'officer' }), org.inviteCode)).status).toBe(403);
  });
});

describe('GET /organizations/me', () => {
  it('내가 속한 단체와 내 역할을 준다. 초대 코드는 관리자인 단체에만 붙는다', async () => {
    const me = await createUser();
    const mine = (await createOrg(me, '우리 학교')).body;
    const other = (await createOrg(await createUser(), '동네 모임')).body;
    await join(me, other.inviteCode);

    const res = await request(api).get('/organizations/me').set(auth(me.token));

    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.organizations.map((o: { name: string }) => [o.name, o]));
    expect(byName['우리 학교']).toMatchObject({ id: mine.id, role: 'admin', inviteCode: mine.inviteCode, memberCount: 1 });
    expect(byName['동네 모임']).toMatchObject({ id: other.id, role: 'member', memberCount: 2 });
    expect(byName['동네 모임']).not.toHaveProperty('inviteCode');
  });
});

describe('GET /organizations/:id/summary', () => {
  it('관리자는 그 달 회원 활동을 합계·도로 구간별·회원별(별명만)로 본다', async () => {
    const admin = await createUser({ nickname: '관리자' });
    const member = await createUser({ nickname: '나무사랑' });
    const idle = await createUser({ nickname: '쉬는중' });
    const outsider = await createUser({ nickname: '남' });
    const org = (await createOrg(admin)).body;
    await join(member, org.inviteCode);
    await join(idle, org.inviteCode);

    const sopa1 = await createTree({ roadName: '소파로' });
    const sopa2 = await createTree({ roadName: '소파로' });
    const euljiro = await createTree({ roadName: '을지로' });
    await createActivity({ userId: admin.id, treeId: sopa1, date: '2026-11-03', minutes: 30 });
    await createActivity({ userId: member.id, treeId: sopa2, date: '2026-11-03', minutes: 20 });
    await createActivity({ userId: member.id, treeId: sopa2, date: '2026-11-10', minutes: 40 });
    await createActivity({ userId: member.id, treeId: euljiro, date: '2026-11-12', minutes: 15 });
    await createActivity({ userId: member.id, treeId: euljiro, date: '2026-10-31', minutes: 99 }); // 지난달
    await createActivity({ userId: member.id, treeId: euljiro, date: '2026-12-01', minutes: 77 }); // 다음 달
    await createActivity({ userId: outsider.id, treeId: sopa1, date: '2026-11-05', minutes: 60 }); // 회원 아님
    await createIncident({ userId: member.id, treeId: sopa1, createdAt: '2026-11-06T10:00:00+09:00' }); // 신고는 활동이 아니다

    const res = await request(api).get(`/organizations/${org.id}/summary?month=2026-11`).set(auth(admin.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ organization: { id: org.id, name: org.name }, month: '2026-11', memberCount: 3 });
    expect(res.body.totals).toEqual({ minutes: 105, count: 4, treeCount: 3, activityDays: 3 });
    expect(res.body.sections).toEqual([
      { district: '중구', place: '소파로', minutes: 90, count: 3, treeCount: 2, memberCount: 2 },
      { district: '중구', place: '을지로', minutes: 15, count: 1, treeCount: 1, memberCount: 1 },
    ]);
    expect(res.body.members).toEqual([
      { nickname: '나무사랑', role: 'member', minutes: 75, count: 3, treeCount: 2 },
      { nickname: '관리자', role: 'admin', minutes: 30, count: 1, treeCount: 1 },
      { nickname: '쉬는중', role: 'member', minutes: 0, count: 0, treeCount: 0 },
    ]);
    // 별명 말고 다른 신원 정보는 주지 않는다
    expect(JSON.stringify(res.body)).not.toMatch(/실명|@test\.local|userId/);
  });

  it('회원·단체 밖 사람은 403, 없는 단체는 404, 달 형식이 틀리면 400, 로그인 없으면 401', async () => {
    const admin = await createUser();
    const member = await createUser();
    const org = (await createOrg(admin)).body;
    await join(member, org.inviteCode);
    const summary = (user: User, id = org.id, month = '2026-11') =>
      request(api).get(`/organizations/${id}/summary?month=${month}`).set(auth(user.token));

    expect((await summary(member)).status).toBe(403);
    expect((await summary(await createUser())).status).toBe(403);
    expect((await summary(admin, 999999)).status).toBe(404);
    expect((await summary(admin, org.id, '2026-13')).status).toBe(400);
    expect((await summary(admin, org.id, '202611')).status).toBe(400);
    expect((await request(api).get(`/organizations/${org.id}/summary?month=2026-11`)).status).toBe(401);
  });
});
