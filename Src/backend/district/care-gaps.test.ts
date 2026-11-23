import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { careGapSql } from '../common/care-gaps.js';
import { closePool, getPool } from '../common/db.js';
import { createActivity, createApplication, createTree, createUser, resetData } from '../test/fixtures.js';
import { loadMonthlyCareGaps } from './care-gaps.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const db = () => getPool();

// 2026년 한 해 동안 돌보는 승인된 돌보미
const YEAR_PERIOD = { status: 'approved' as const, periodStart: '2026-01-01', periodEnd: '2026-12-31' };

let officer: { id: number; token: string };
let citizen: { id: number; token: string };
let noCaregiver: number; // 돌보미 없음
let active: number; // 7월에 활동함
let stopped: number; // 6월까지 활동하고 7월에 끊김
let never: number; // 돌보미는 있는데 활동한 적 없음

beforeEach(async () => {
  await resetData();
  officer = await createUser({ role: 'officer', agency: '중구' });
  citizen = await createUser();
  [noCaregiver, active, stopped, never] = [
    await createTree({ agency: '중구' }),
    await createTree({ agency: '중구' }),
    await createTree({ agency: '중구' }),
    await createTree({ agency: '중구' }),
  ];
  for (const treeId of [active, stopped, never]) {
    await createApplication({ userId: citizen.id, treeId, ...YEAR_PERIOD, reviewedBy: officer.id });
  }
  await createActivity({ userId: citizen.id, treeId: active, date: '2026-07-10' });
  await createActivity({ userId: citizen.id, treeId: stopped, date: '2026-06-03' });
  await createActivity({ userId: citizen.id, treeId: stopped, date: '2026-06-20' });
});
afterAll(closePool);

describe('GET /admin/care-gaps', () => {
  it('돌보미 없는 나무와 이 달 활동이 끊긴 나무를 센다', async () => {
    const res = await request(api).get('/admin/care-gaps?month=2026-07').set(auth(officer.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ agency: '중구', month: '2026-07' });
    expect(res.body.totals).toEqual({ trees: 4, noCaregiver: 1, inactive: 2 });
  });

  it('활동이 끊긴 나무는 오래 끊긴 순(활동한 적 없는 나무 먼저)이고 마지막 활동일을 준다', async () => {
    const res = await request(api).get('/admin/care-gaps?month=2026-07').set(auth(officer.token));
    expect(res.body.inactiveTrees).toMatchObject([
      { id: never, lastActivityDate: null, caregiverCount: 1 },
      { id: stopped, lastActivityDate: '2026-06-20', caregiverCount: 1 },
    ]);
  });

  it('동별로 나눠 센다', async () => {
    await db().query("UPDATE trees SET dong = '필동' WHERE id = $1", [noCaregiver]);
    const res = await request(api).get('/admin/care-gaps?month=2026-07').set(auth(officer.token));
    expect(res.body.byDong).toEqual([
      { district: '중구', dong: '명동', trees: 3, noCaregiver: 0, inactive: 2 },
      { district: '중구', dong: '필동', trees: 1, noCaregiver: 1, inactive: 0 },
    ]);
  });

  it('대기 중인 신청과 활동 기간이 지난 돌보미는 돌보미로 세지 않는다', async () => {
    const other = await createUser();
    await createApplication({ userId: other.id, treeId: noCaregiver }); // 대기
    const expired = await createTree({ agency: '중구' });
    await createApplication({ userId: other.id, treeId: expired, status: 'approved', periodStart: '2025-07-01', periodEnd: '2026-06-30', reviewedBy: officer.id });

    const res = await request(api).get('/admin/care-gaps?month=2026-07').set(auth(officer.token));
    expect(res.body.totals).toEqual({ trees: 5, noCaregiver: 2, inactive: 2 });
  });

  it('다른 관리청 나무는 세지 않는다', async () => {
    const other = await createTree({ agency: '종로구' });
    await createApplication({ userId: citizen.id, treeId: other, ...YEAR_PERIOD, reviewedBy: officer.id });
    const res = await request(api).get('/admin/care-gaps?month=2026-07').set(auth(officer.token));
    expect(res.body.totals.trees).toBe(4);
    expect(res.body.inactiveTrees.map((t: { id: number }) => t.id)).not.toContain(other);
  });

  it('잘못된 month는 400, 시민은 403', async () => {
    expect((await request(api).get('/admin/care-gaps?month=2026-13').set(auth(officer.token))).status).toBe(400);
    expect((await request(api).get('/admin/care-gaps').set(auth(citizen.token))).status).toBe(403);
  });
});

describe('GET /admin/care-gaps/monthly', () => {
  it('올해는 이번 달까지 매달 활동 공백과 폭염일을 준다', async () => {
    await db().query(
      "INSERT INTO weather (date, region, temp_max, is_heatwave) VALUES ('2026-07-30', 'seoul', 34.1, true), ('2026-07-31', 'seoul', 35.0, true), ('2026-07-29', 'seoul', 30.0, false)",
    );
    const months = await loadMonthlyCareGaps(db(), { agency: '중구', year: 2026, now: new Date('2026-08-15T03:00:00Z') });

    expect(months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
    expect(months[5]).toEqual({ month: '2026-06', caredTrees: 3, activeTrees: 1, inactiveTrees: 2, inactiveRate: 0.667, heatwaveDays: 0 });
    expect(months[6]).toEqual({ month: '2026-07', caredTrees: 3, activeTrees: 1, inactiveTrees: 2, inactiveRate: 0.667, heatwaveDays: 2 });
    expect(months[7]).toMatchObject({ month: '2026-08', activeTrees: 0, inactiveTrees: 3, inactiveRate: 1 });
  });

  it('돌보미가 없던 달은 비율이 null이다', async () => {
    const months = await loadMonthlyCareGaps(db(), { agency: '종로구', year: 2026, now: new Date('2026-03-15T03:00:00Z') });
    expect(months).toHaveLength(3);
    expect(months[0]).toMatchObject({ caredTrees: 0, inactiveRate: null });
  });

  it('지난 해는 12달을, 아직 오지 않은 해는 빈 목록을 준다', async () => {
    const now = new Date('2026-08-15T03:00:00Z');
    expect(await loadMonthlyCareGaps(db(), { agency: '중구', year: 2025, now })).toHaveLength(12);
    expect(await loadMonthlyCareGaps(db(), { agency: '중구', year: 2027, now })).toEqual([]);
  });

  it('API는 year를 받는다', async () => {
    const res = await request(api).get('/admin/care-gaps/monthly?year=2025').set(auth(officer.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ agency: '중구', year: 2025 });
    expect(res.body.months).toHaveLength(12);
  });
});

describe('careGapSql (시민 지도용 나무 한 그루 판정)', () => {
  it('달을 주면 나무마다 no_caregiver / inactive / null을 준다', async () => {
    const { rows } = await db().query(
      `SELECT t.id, ${careGapSql('t', "'2026-07-01'::date")} AS care_gap FROM trees t ORDER BY t.id`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.care_gap]))).toEqual({
      [noCaregiver]: 'no_caregiver',
      [active]: null,
      [stopped]: 'inactive',
      [never]: 'inactive',
    });
  });
});
