import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import {
  createActivity,
  createApplication,
  createIncident,
  createMonthlyReport,
  createRental,
  createRentalItem,
  createTree,
  createUser,
  resetData,
} from '../test/fixtures.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const db = () => getPool();

const YEAR_PERIOD = { status: 'approved' as const, periodStart: '2026-01-01', periodEnd: '2026-12-31' };

let officer: { id: number; token: string };
let a: { id: number; token: string }; // 단체 회원
let b: { id: number; token: string };
let orgId: number;
let t1: number; // 명동
let t2: number; // 명동
let t3: number; // 필동
let bReport: number;

async function approve(reportId: number, at: string) {
  await db().query("UPDATE monthly_reports SET status = 'approved', reviewed_by = $2, reviewed_at = $3 WHERE id = $1", [reportId, officer.id, at]);
  await db().query(
    `INSERT INTO volunteer_hours (user_id, monthly_report_id, minutes, recorded_by, recorded_at)
     SELECT user_id, id, total_minutes, $2, $3 FROM monthly_reports WHERE id = $1`,
    [reportId, officer.id, at],
  );
}

beforeEach(async () => {
  await resetData();
  officer = await createUser({ role: 'officer', agency: '중구' });
  a = await createUser({ nickname: '은행지기' });
  b = await createUser({ nickname: '느티지기' });
  const { rows } = await db().query("INSERT INTO organizations (name, invite_code) VALUES ('시티트리클럽', 'CITY') RETURNING id");
  orgId = rows[0].id;
  await db().query('INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)', [orgId, a.id]);

  [t1, t2, t3] = [await createTree({ agency: '중구' }), await createTree({ agency: '중구' }), await createTree({ agency: '중구' })];
  await db().query("UPDATE trees SET dong = '필동' WHERE id = $1", [t3]);
  const other = await createTree({ agency: '종로구' });

  for (const [user, tree] of [[a, t1], [a, t3], [b, t2], [b, other]] as const) {
    await createApplication({ userId: user.id, treeId: tree, ...YEAR_PERIOD, reviewedBy: officer.id });
  }

  // a: t1에 30분씩 2번 → 11월 보고서 승인(봉사 60분), t3에 45분(보고서 전)
  const aReport = await createMonthlyReport({ userId: a.id, treeId: t1, dates: ['2026-11-02', '2026-11-03'], minutesEach: 30, submittedAt: '2026-11-05T01:00:00Z' });
  await approve(aReport, '2026-11-08T01:00:00Z');
  await createActivity({ userId: a.id, treeId: t3, date: '2026-11-10', minutes: 45 });
  // b: t2에 20분 → 11월 보고서 제출(검토 대기)
  bReport = await createMonthlyReport({ userId: b.id, treeId: t2, dates: ['2026-11-04'], minutesEach: 20, submittedAt: '2026-11-06T01:00:00Z' });
  // 다른 관리청 활동은 세지 않는다
  await createActivity({ userId: b.id, treeId: other, date: '2026-11-04', minutes: 999 });

  // 신고: a가 11월 접수, b가 10월에 낸 신고를 11월에 조치 완료
  await createIncident({ userId: a.id, treeId: t1, createdAt: '2026-11-09T00:00:00Z' });
  const old = await createIncident({ userId: b.id, treeId: t2, createdAt: '2026-10-01T00:00:00Z' });
  await db().query(
    "UPDATE reports SET status = 'resolved', inspected_at = '2026-10-20T00:00:00Z', resolved_at = '2026-11-02T00:00:00Z' WHERE id = $1",
    [old],
  );

  // 물품: 쿨토시 a 2개 승인, b 1개 수령 / 모자는 신청 없음
  const cool = await createRentalItem({ agency: '중구', name: '쿨토시' });
  await createRentalItem({ agency: '중구', name: '모자' });
  const ra = await createRental({ itemId: cool, userId: a.id, quantity: 2 });
  const rb = await createRental({ itemId: cool, userId: b.id, quantity: 1 });
  await db().query("UPDATE rentals SET status = 'approved', handled_by = $2, handled_at = '2026-11-03T00:00:00Z' WHERE id = $1", [ra, officer.id]);
  await db().query(
    "UPDATE rentals SET status = 'received', handled_by = $2, handled_at = '2026-11-03T00:00:00Z', received_at = '2026-11-04T00:00:00Z' WHERE id = $1",
    [rb, officer.id],
  );
});
afterAll(closePool);

describe('GET /admin/exports/monthly?format=json', () => {
  it('구·동별 돌봄 현황과 합계, 보고서·물품 요약을 센다', async () => {
    const res = await request(api).get('/admin/exports/monthly?month=2026-11&format=json').set(auth(officer.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ agency: '중구', month: '2026-11', organization: null });
    expect(res.body.regions).toEqual([
      {
        district: '중구', dong: '명동', trees: 2, caredTrees: 2, caregivers: 2, activityRecords: 3, activityMinutes: 80,
        volunteerMinutes: 60, volunteerPeople: 1, incidentsReceived: 1, incidentsResolved: 1,
      },
      {
        district: '중구', dong: '필동', trees: 1, caredTrees: 1, caregivers: 1, activityRecords: 1, activityMinutes: 45,
        volunteerMinutes: 0, volunteerPeople: 0, incidentsReceived: 0, incidentsResolved: 0,
      },
    ]);
    // a는 명동·필동 둘 다 돌보지만 합계에서는 한 명
    expect(res.body.totals).toEqual({
      trees: 3, caredTrees: 3, caregivers: 2, activityRecords: 4, activityMinutes: 125,
      volunteerMinutes: 60, volunteerPeople: 1, incidentsReceived: 1, incidentsResolved: 1,
    });
    expect(res.body.monthlyReports).toEqual({ submitted: 2, approved: 1, revisionRequested: 0 });
    expect(res.body.rentals).toEqual([
      { item: '모자', approvedQuantity: 0, receivedQuantity: 0 },
      { item: '쿨토시', approvedQuantity: 3, receivedQuantity: 1 },
    ]);
  });

  it('단체를 고르면 그 단체 회원 활동만 센다(관리 나무 수는 그대로)', async () => {
    const res = await request(api).get(`/admin/exports/monthly?month=2026-11&format=json&organizationId=${orgId}`).set(auth(officer.token));
    expect(res.body.organization).toEqual({ id: orgId, name: '시티트리클럽' });
    expect(res.body.regions[0]).toMatchObject({
      dong: '명동', trees: 2, caredTrees: 1, caregivers: 1, activityRecords: 2, activityMinutes: 60, incidentsReceived: 1, incidentsResolved: 0,
    });
    expect(res.body.monthlyReports).toEqual({ submitted: 1, approved: 1, revisionRequested: 0 });
    expect(res.body.rentals[1]).toEqual({ item: '쿨토시', approvedQuantity: 2, receivedQuantity: 0 });
  });

  it('다른 달에는 활동이 잡히지 않는다', async () => {
    const res = await request(api).get('/admin/exports/monthly?month=2026-10&format=json').set(auth(officer.token));
    expect(res.body.totals).toMatchObject({ trees: 3, caredTrees: 3, activityRecords: 0, volunteerMinutes: 0, incidentsReceived: 1, incidentsResolved: 0 });
  });

  it('나무가 없는 관리청은 0으로 준다', async () => {
    const empty = await createUser({ role: 'officer', agency: '강남구' });
    const res = await request(api).get('/admin/exports/monthly?month=2026-11&format=json').set(auth(empty.token));
    expect(res.body.regions).toEqual([]);
    expect(res.body.totals).toMatchObject({ trees: 0, caregivers: 0 });
  });

  it('없는 단체는 404, 잘못된 month·format은 400, 시민은 403', async () => {
    expect((await request(api).get('/admin/exports/monthly?organizationId=9999').set(auth(officer.token))).status).toBe(404);
    expect((await request(api).get('/admin/exports/monthly?month=2026-13').set(auth(officer.token))).status).toBe(400);
    expect((await request(api).get('/admin/exports/monthly?format=xlsx').set(auth(officer.token))).status).toBe(400);
    expect((await request(api).get('/admin/exports/monthly').set(auth(a.token))).status).toBe(403);
  });
});

describe('GET /admin/exports/monthly (CSV)', () => {
  it('엑셀에서 열리는 CSV 파일로 내려준다', async () => {
    const res = await request(api).get('/admin/exports/monthly?month=2026-11').set(auth(officer.token));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="treecare-monthly-2026-11.csv"');
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe('﻿서울 TreeCare 나무돌보미 월간 활동 보고');
    expect(lines).toContain('관리청,중구');
    expect(lines).toContain('중구,명동,2,2,2,3,1.3,1,1,1,1');
    expect(lines).toContain('합계,,3,3,2,4,2.1,1,1,1,1');
    expect(lines).toContain('쿨토시,3,1');
  });
});

describe('GET /admin/exports/commendations', () => {
  it('그 해 승인 봉사시간이 많은 순, 같으면 같은 순위', async () => {
    await approve(bReport, '2026-11-20T01:00:00Z'); // b 20분
    const c = await createUser({ nickname: '=SUM(A1)' }); // 수식처럼 보이는 별명
    await createApplication({ userId: c.id, treeId: t2, ...YEAR_PERIOD, reviewedBy: officer.id });
    const cReport = await createMonthlyReport({ userId: c.id, treeId: t2, dates: ['2026-06-01', '2026-06-02'], minutesEach: 30, submittedAt: '2026-06-05T01:00:00Z' });
    await approve(cReport, '2026-06-10T01:00:00Z'); // c 60분, a와 같음

    const res = await request(api).get('/admin/exports/commendations?year=2026&format=json').set(auth(officer.token));
    expect(res.status).toBe(200);
    expect(res.body.people).toMatchObject([
      { rank: 1, userId: a.id, nickname: '은행지기', realName: expect.any(String), volunteerMinutes: 60, approvedReports: 1, trees: 1 },
      { rank: 1, userId: c.id, nickname: '=SUM(A1)', realName: expect.any(String), volunteerMinutes: 60, approvedReports: 1, trees: 1 },
      { rank: 3, userId: b.id, nickname: '느티지기', realName: expect.any(String), volunteerMinutes: 20, approvedReports: 1, trees: 1 },
    ]);

    const filtered = await request(api).get('/admin/exports/commendations?year=2026&format=json&minHours=0.5').set(auth(officer.token));
    expect(filtered.body.people.map((p: { userId: number }) => p.userId)).toEqual([a.id, c.id]);

    const org = await request(api).get(`/admin/exports/commendations?year=2026&format=json&organizationId=${orgId}`).set(auth(officer.token));
    expect(org.body.people.map((p: { userId: number }) => p.userId)).toEqual([a.id]);

    const csv = await request(api).get('/admin/exports/commendations?year=2026').set(auth(officer.token));
    expect(csv.headers['content-disposition']).toBe('attachment; filename="treecare-commendations-2026.csv"');
    expect(csv.text).toMatch(/\r\n1,'=SUM\(A1\),실명\d+,1,1,1\r\n/); // 수식으로 실행되지 않게 ' 를 붙임
  });

  it('다른 해의 봉사시간은 세지 않는다', async () => {
    const res = await request(api).get('/admin/exports/commendations?year=2025&format=json').set(auth(officer.token));
    expect(res.body.people).toEqual([]);
  });
});
