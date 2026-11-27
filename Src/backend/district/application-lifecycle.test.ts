import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createApplication, createTree, createUser, resetData } from '../test/fixtures.js';
import { endExpiredApplications, seoulToday } from './application-lifecycle.js';
import { loadMonthlyCareGaps } from './care-gaps.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const db = () => getPool();
const statusOf = async (id: number) =>
  (await db().query<{ status: string }>('SELECT status FROM caregiver_applications WHERE id = $1', [id])).rows[0]!.status;

let officer: { id: number; token: string };
let citizen: { id: number; token: string };
let tree: number;

beforeEach(async () => {
  await resetData();
  officer = await createUser({ role: 'officer', agency: '중구' });
  citizen = await createUser();
  tree = await createTree({ agency: '중구' });
});
afterAll(closePool);

describe('seoulToday', () => {
  it('한국 시간 날짜를 준다', () => {
    expect(seoulToday(new Date('2026-11-30T15:30:00Z'))).toBe('2026-12-01'); // 한국은 12/1 00:30
    expect(seoulToday(new Date('2026-11-30T14:30:00Z'))).toBe('2026-11-30');
  });
});

describe('endExpiredApplications', () => {
  it('활동 기간이 끝난 승인 신청서만 종료한다', async () => {
    const approved = { status: 'approved' as const, reviewedBy: officer.id };
    const expired = await createApplication({ userId: citizen.id, treeId: tree, ...approved, periodStart: '2025-11-01', periodEnd: '2026-10-31' });
    const lastDay = await createApplication({ userId: (await createUser()).id, treeId: tree, ...approved, periodStart: '2025-11-02', periodEnd: '2026-11-01' });
    const pending = await createApplication({ userId: (await createUser()).id, treeId: tree, periodStart: '2025-11-01', periodEnd: '2026-10-31' });
    const rejected = await createApplication({ userId: (await createUser()).id, treeId: tree, status: 'rejected', reviewedBy: officer.id, periodStart: '2025-11-01', periodEnd: '2026-10-31' });

    // 2026-11-01: 마지막 날까지는 활동 기간이다
    expect(await endExpiredApplications(db(), '2026-11-01')).toEqual([expired]);
    expect(await statusOf(expired)).toBe('ended');
    expect(await statusOf(lastDay)).toBe('approved');
    expect(await statusOf(pending)).toBe('pending'); // 심사하지 않은 신청서는 건드리지 않는다
    expect(await statusOf(rejected)).toBe('rejected');

    // 다음 날 lastDay도 끝나고, 이미 끝난 것은 다시 세지 않는다
    expect(await endExpiredApplications(db(), '2026-11-02')).toEqual([lastDay]);
    expect(await endExpiredApplications(db(), '2026-11-02')).toEqual([]);
  });

  it('종료되면 같은 나무에 다시 신청할 수 있다', async () => {
    await createApplication({ userId: citizen.id, treeId: tree, status: 'approved', reviewedBy: officer.id, periodStart: '2025-01-01', periodEnd: '2025-12-31' });
    const apply = () =>
      request(api).post('/applications').set(auth(citizen.token)).send({
        treeIds: [tree],
        periodStart: '2030-03-01',
        headcount: 1,
        participationType: 'individual',
        motivation: '한 해 더 돌보고 싶어요',
        activityPlan: '주 2회 물 주기',
        agreed: true,
      });

    expect((await apply()).status).toBe(409); // 승인 상태로 남아 있으면 막힌다
    await endExpiredApplications(db(), '2026-01-01');
    expect((await apply()).status).toBe(201);
  });

  it('종료된 신청서는 지난 달 집계에서 그 달의 돌보미로 센다', async () => {
    await createApplication({ userId: citizen.id, treeId: tree, status: 'approved', reviewedBy: officer.id, periodStart: '2026-01-01', periodEnd: '2026-06-30' });
    await endExpiredApplications(db(), '2026-07-01');

    const months = await loadMonthlyCareGaps(db(), { agency: '중구', year: 2026, now: new Date('2026-07-15T03:00:00Z') });
    expect(months.find((m) => m.month === '2026-06')).toMatchObject({ caredTrees: 1 });
    expect(months.find((m) => m.month === '2026-07')).toMatchObject({ caredTrees: 0 });
  });

  it('종료된 돌보미는 신청 심사 화면의 돌보미 수에서 빠진다', async () => {
    await createApplication({ userId: citizen.id, treeId: tree, status: 'approved', reviewedBy: officer.id, periodStart: '2025-01-01', periodEnd: '2025-12-31' });
    const newcomer = await createUser();
    const pendingId = await createApplication({ userId: newcomer.id, treeId: tree });

    const before = await request(api).get(`/admin/applications/${pendingId}`).set(auth(officer.token));
    expect(before.body.tree.caregiverCount).toBe(1);
    await endExpiredApplications(db(), '2026-01-01');
    const after = await request(api).get(`/admin/applications/${pendingId}`).set(auth(officer.token));
    expect(after.body.tree.caregiverCount).toBe(0);
  });
});
