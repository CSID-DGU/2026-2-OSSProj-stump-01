import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createApplication, createTree, createUser, resetData } from '../test/fixtures.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** 오늘(한국 시간)에서 days일 옮긴 날짜 'YYYY-MM-DD' */
function seoulDate(days = 0): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

let me: { id: number; token: string };
let treeA: number;
let treeB: number;

beforeEach(async () => {
  await resetData();
  me = await createUser();
  treeA = await createTree();
  treeB = await createTree();
});
afterAll(closePool);

/**
 * 정상 신청 본문(개인 신청). 바꿀 칸만 덮어쓴다. 항목은 구청 「나무돌보미 신청서(안)」 양식을 따른다.
 * 신청인 성명·연락처·주소는 본인인증한 프로필에서 가져오므로 본문에 없다.
 */
function body(overrides: Record<string, unknown> = {}) {
  return {
    treeIds: [treeA],
    periodStart: '2030-03-01',
    headcount: 2,
    participationType: 'individual',
    motivation: '출근길에 매일 보는 나무라서요',
    activityPlan: '주 2회 나무 주변 쓰레기 줍기',
    agreed: true,
    ...overrides,
  };
}

const submit = (payload: object, token = me.token) =>
  request(api).post('/applications').set(auth(token)).send(payload);

/** 이 사용자의 본인인증 프로필(신청서에 복사되는 값) */
async function profileOf(userId: number) {
  const { rows } = await getPool().query<{ real_name: string; phone: string; postal_code: string; address: string }>(
    'SELECT real_name, phone, postal_code, address FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]!;
}

/** 응답과 따로, 이 사용자의 신청서 행 수를 DB에서 센다. */
async function countApplications(userId: number): Promise<number> {
  const { rows } = await getPool().query<{ count: number }>(
    'SELECT count(*)::int FROM caregiver_applications WHERE user_id = $1',
    [userId],
  );
  return rows[0]!.count;
}

type AppBody = { id: number; tree: { id: number } };

describe('POST /applications', () => {
  it('나무 여러 그루를 한 번에 신청하면 그루마다 대기 신청서가 생긴다', async () => {
    const res = await submit(body({ treeIds: [treeA, treeB] }));

    expect(res.status).toBe(201);
    expect(res.body.applications).toHaveLength(2);
    expect(new Set(res.body.applications.map((a: AppBody) => a.tree.id))).toEqual(new Set([treeA, treeB]));
    for (const app of res.body.applications) {
      expect(app).toMatchObject({ status: 'pending', rejectReason: null });
    }
    expect(await countApplications(me.id)).toBe(2);
  });

  it('양식 항목을 저장하고, 활동 기간은 시작일부터 1년(전날까지)으로 정한다', async () => {
    const profile = await profileOf(me.id);
    const res = await submit(body({ periodStart: '2030-03-01' }));

    expect(res.status).toBe(201);
    expect(res.body.applications[0]).toMatchObject({
      periodStart: '2030-03-01',
      periodEnd: '2031-02-28',
      applicantName: profile.real_name, // 개인 신청은 본인인증한 이름
      contactPerson: null,
      headcount: 2,
      postalCode: profile.postal_code, // 프로필에서 복사
      address: profile.address,
      phone: profile.phone,
      participationType: 'individual',
      motivation: '출근길에 매일 보는 나무라서요',
      activityPlan: '주 2회 나무 주변 쓰레기 줍기',
      organizationIntro: null,
    });
    expect(res.body.applications[0].agreedAt).not.toBeNull();
  });

  it('기업·단체는 담당자와 소개를 함께 낸다', async () => {
    const res = await submit(
      body({
        organizationName: '푸른숲 주식회사',
        participationType: 'company',
        contactPerson: 'ESG팀 박담당',
        organizationIntro: '사내 봉사 동아리가 있습니다',
        headcount: 15,
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.applications[0]).toMatchObject({
      applicantName: '푸른숲 주식회사', // 단체 신청은 단체명
      contactPerson: 'ESG팀 박담당',
      organizationIntro: '사내 봉사 동아리가 있습니다',
      phone: (await profileOf(me.id)).phone, // 연락처는 신청한 사람 프로필
    });
  });

  it('신청인 성명·연락처·주소를 보내도 무시하고 본인인증한 프로필을 쓴다', async () => {
    const res = await submit(body({ applicantName: '남의이름', phone: '010-9999-9999', address: '다른 주소', postalCode: '99999' }));
    const profile = await profileOf(me.id);
    expect(res.status).toBe(201);
    expect(res.body.applications[0]).toMatchObject({
      applicantName: profile.real_name,
      phone: profile.phone,
      address: profile.address,
      postalCode: profile.postal_code,
    });
  });

  it('개인 신청은 단체명·담당자를 보내도 저장하지 않는다', async () => {
    const res = await submit(body({ organizationName: '어느 단체', contactPerson: '누군가' }));
    expect(res.body.applications[0]).toMatchObject({ applicantName: (await profileOf(me.id)).real_name, contactPerson: null });
  });

  it('본인인증 전 계정은 403(IDENTITY_REQUIRED), 주소가 없으면 400(PROFILE_INCOMPLETE)', async () => {
    const legacy = await createUser({ verified: false });
    const res = await submit(body(), legacy.token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('IDENTITY_REQUIRED');

    await getPool().query('UPDATE users SET address = NULL WHERE id = $1', [me.id]);
    const noAddress = await submit(body());
    expect(noAddress.status).toBe(400);
    expect(noAddress.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(await countApplications(me.id)).toBe(0);
  });

  it('제출한 신청서는 그 나무 관리청 담당자의 심사 대기 목록에 들어간다', async () => {
    const officer = await createUser({ role: 'officer', agency: '중구' });

    const res = await submit(body());
    expect(res.status).toBe(201);

    const queue = await request(api).get('/admin/applications').set(auth(officer.token));
    expect(queue.body.items.map((a: AppBody) => a.id)).toEqual([res.body.applications[0].id]);
    expect(queue.body.items[0].applicant.id).toBe(me.id);
  });

  it('시작일이 오늘(한국 시간)이면 받는다', async () => {
    const res = await submit(body({ periodStart: seoulDate(0) }));
    expect(res.status).toBe(201);
  });

  it('시작일이 오늘보다 앞이면 400이고 저장하지 않는다', async () => {
    const res = await submit(body({ periodStart: seoulDate(-1) }));
    expect(res.status).toBe(400);
    expect(await countApplications(me.id)).toBe(0);
  });

  it('한 번에 10그루까지는 받는다', async () => {
    const trees = await Promise.all(Array.from({ length: 10 }, () => createTree()));
    const res = await submit(body({ treeIds: trees }));
    expect(res.status).toBe(201);
    expect(await countApplications(me.id)).toBe(10);
  });

  // 각 줄은 정상 본문에서 한 칸만 틀리게 바꾼다. 나무는 실제로 있는 것만 써서, 400이 검증 때문인지만 보게 한다.
  it.each<[string, string, () => Promise<Record<string, unknown>>]>([
    ['나무를 하나도 안 고르면', 'treeIds', async () => ({ treeIds: [] })],
    ['한 번에 11그루를 고르면', 'treeIds', async () => ({ treeIds: await Promise.all(Array.from({ length: 11 }, () => createTree())) })],
    ['같은 나무를 두 번 넣으면', 'treeIds', async () => ({ treeIds: [treeA, treeA] })],
    ['참여 동기가 공백뿐이면', 'motivation', async () => ({ motivation: '   ' })],
    ['참여 동기가 500자를 넘으면', 'motivation', async () => ({ motivation: '가'.repeat(501) })],
    ['없는 날짜면', 'periodStart', async () => ({ periodStart: '2030-02-30' })],
    ['신청 인원이 0명이면', 'headcount', async () => ({ headcount: 0 })],
    ['참여유형이 목록에 없으면', 'participationType', async () => ({ participationType: 'school' })],
    ['기업·단체인데 담당자가 없으면', 'contactPerson', async () => ({ participationType: 'civic_group', organizationName: '푸른숲' })],
    ['기업·단체인데 단체명이 없으면', 'organizationName', async () => ({ participationType: 'civic_group', contactPerson: '박담당' })],
    ['활동계획이 없으면', 'activityPlan', async () => ({ activityPlan: '' })],
    ['안내 사항에 동의하지 않으면', 'agreed', async () => ({ agreed: false })],
  ])('%s 400이고 저장하지 않는다', async (_, field, change) => {
    const res = await submit(body(await change()));
    expect(res.status).toBe(400);
    // 바꾼 그 칸 때문에 막혔는지 본다(다른 칸 오류로 400이 나면 이 줄이 실패한다)
    expect(res.body.error.issues.map((i: { path: string[] }) => i.path[0])).toEqual([field]);
    expect(await countApplications(me.id)).toBe(0);
  });

  it.each(['pending', 'approved'] as const)(
    '%s 상태로 신청한 나무가 하나라도 섞이면 409이고 다른 나무도 저장하지 않는다',
    async (status) => {
      const officer = await createUser({ role: 'officer' });
      await createApplication({ userId: me.id, treeId: treeA, status, reviewedBy: officer.id });

      const res = await submit(body({ treeIds: [treeB, treeA] }));

      expect(res.status).toBe(409);
      expect(await countApplications(me.id)).toBe(1);
    },
  );

  it('다른 사람이 이미 돌보는 나무도 신청할 수 있다(한 그루에 여러 돌보미)', async () => {
    const officer = await createUser({ role: 'officer' });
    const other = await createUser();
    await createApplication({ userId: other.id, treeId: treeA, status: 'approved', reviewedBy: officer.id });

    const res = await submit(body({ treeIds: [treeA] }));

    expect(res.status).toBe(201);
  });

  it('반려된 나무는 다시 신청할 수 있다', async () => {
    const officer = await createUser({ role: 'officer' });
    await createApplication({ userId: me.id, treeId: treeA, status: 'rejected', reviewedBy: officer.id });

    const res = await submit(body({ treeIds: [treeA] }));

    expect(res.status).toBe(201);
  });

  it('없는 나무가 섞이면 400이고 있는 나무도 저장하지 않는다', async () => {
    const res = await submit(body({ treeIds: [treeA, 999_999] }));
    expect(res.status).toBe(400);
    expect(await countApplications(me.id)).toBe(0);
  });

  it('구청 담당자 계정은 신청할 수 없다(403)', async () => {
    const officer = await createUser({ role: 'officer' });
    const res = await submit(body(), officer.token);
    expect(res.status).toBe(403);
    expect(await countApplications(officer.id)).toBe(0);
  });

  it('토큰 없으면 401', async () => {
    const res = await request(api).post('/applications').send(body());
    expect(res.status).toBe(401);
  });
});

describe('GET /applications/me', () => {
  it('내 신청서만 최신순으로, 반려 사유와 나무 정보를 붙여 준다', async () => {
    const officer = await createUser({ role: 'officer' });
    const other = await createUser();
    const older = await createApplication({ userId: me.id, treeId: treeA, createdAt: '2026-11-01T09:00:00+09:00' });
    const newer = await createApplication({
      userId: me.id,
      treeId: treeB,
      status: 'rejected',
      reviewedBy: officer.id,
      createdAt: '2026-11-02T09:00:00+09:00',
    });
    await createApplication({ userId: other.id, treeId: treeA });
    await getPool().query('SELECT assign_tree_codes()'); // 나무 이름의 번호를 매긴다

    const res = await request(api).get('/applications/me').set(auth(me.token));

    expect(res.status).toBe(200);
    expect(res.body.applications.map((a: AppBody) => a.id)).toEqual([newer, older]);
    expect(res.body.applications[0]).toMatchObject({
      status: 'rejected',
      rejectReason: '테스트 반려',
      tree: { id: treeB, species: '은행나무', district: '중구', roadName: '명동길' },
    });
    expect(res.body.applications[0].tree.name).toMatch(/^은행나무, 명동길 \d+번$/);
    expect(res.body.applications[1]).toMatchObject({ status: 'pending', rejectReason: null, reviewedAt: null });
  });

  it('토큰 없으면 401', async () => {
    expect((await request(api).get('/applications/me')).status).toBe(401);
  });
});
