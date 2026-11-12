import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createApplication, createMonthlyReport, createTree, createUser, resetData } from '../test/fixtures.js';
import { currentMonth } from './dashboard.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const db = () => getPool();

let officer: { id: number; token: string };

beforeEach(async () => {
  await resetData();
  officer = await createUser({ role: 'officer', agency: '중구' });
});
afterAll(closePool);

async function createOrg(name: string, memberIds: number[]) {
  const { rows } = await db().query('INSERT INTO organizations (name, invite_code) VALUES ($1, $2) RETURNING id', [name, `CODE-${name}`]);
  for (const userId of memberIds) {
    await db().query('INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)', [rows[0].id, userId]);
  }
  return rows[0].id as number;
}
async function createRental(userId: number, agency: string, status: 'requested' | 'approved') {
  const { rows } = await db().query(
    "INSERT INTO rental_items (agency, name, stock) VALUES ($1, $2, 10) ON CONFLICT (agency, name) DO UPDATE SET stock = 10 RETURNING id",
    [agency, '쿨토시'],
  );
  await db().query(
    `INSERT INTO rentals (item_id, user_id, status, handled_by, handled_at) VALUES ($1, $2, $3, $4, $5)`,
    [rows[0].id, userId, status, status === 'approved' ? officer.id : null, status === 'approved' ? new Date() : null],
  );
}
async function createIncident(userId: number, treeId: number, agency: string, status: 'pending' | 'inspecting' | 'resolved', createdAt: string) {
  const { rows } = await db().query("INSERT INTO records (tree_id, user_id, type) VALUES ($1, $2, 'report') RETURNING id", [treeId, userId]);
  await db().query(
    `INSERT INTO reports (record_id, category, urgency, status, agency, inspected_at, resolved_at, created_at)
     VALUES ($1, 'pest', 'low', $2, $3, $4, $5, $6)`,
    [rows[0].id, status, agency, status === 'pending' ? null : new Date(), status === 'resolved' ? new Date() : null, createdAt],
  );
}
async function approve(reportId: number, recordedAt: string) {
  await db().query("UPDATE monthly_reports SET status = 'approved', reviewed_by = $2, reviewed_at = now() WHERE id = $1", [reportId, officer.id]);
  await db().query(
    `INSERT INTO volunteer_hours (user_id, monthly_report_id, minutes, recorded_by, recorded_at)
     SELECT user_id, id, total_minutes, $2, $3 FROM monthly_reports WHERE id = $1`,
    [reportId, officer.id, recordedAt],
  );
}

describe('currentMonth', () => {
  it('한국 시간 기준 달을 준다', () => {
    expect(currentMonth(new Date('2026-11-30T15:30:00Z'))).toBe('2026-12'); // 한국은 12/1 00:30
    expect(currentMonth(new Date('2026-11-30T14:30:00Z'))).toBe('2026-11');
  });
});

describe('GET /admin/dashboard', () => {
  it('내 관리청 기준으로 처리할 일과 이달 현황을 센다', async () => {
    const tree = await createTree({ agency: '중구' });
    const otherTree = await createTree({ agency: '종로구' });
    const [a, b, c, d] = [await createUser({ nickname: '가' }), await createUser({ nickname: '나' }), await createUser({ nickname: '다' }), await createUser({ nickname: '라' })];

    // 돌보미: a·b·c는 11월에 활동 중, d는 기간이 10월에 끝남
    for (const u of [a, b, c]) await createApplication({ userId: u.id, treeId: tree, status: 'approved', reviewedBy: officer.id });
    await db().query("UPDATE caregiver_applications SET period_start = '2026-06-01', period_end = '2027-05-31'");
    const ended = await createApplication({ userId: d.id, treeId: tree, status: 'approved', reviewedBy: officer.id });
    await db().query("UPDATE caregiver_applications SET period_start = '2026-04-01', period_end = '2026-10-31' WHERE id = $1", [ended]);
    // 심사 대기 신청: 중구 1, 종로구 1 (d는 같은 나무에 승인 상태 신청이 있어 다른 신청자를 쓴다)
    const applicant = await createUser({ nickname: '신청자' });
    await createApplication({ userId: applicant.id, treeId: tree });
    await createApplication({ userId: applicant.id, treeId: otherTree });

    // 보고서: a는 11월 제출(검토 대기), b는 11월 제출 후 승인(봉사시간 90분), c는 10월에만 제출, 종로구 보고서 1
    await createMonthlyReport({ userId: a.id, treeId: tree, dates: ['2026-11-02'], submittedAt: '2026-11-05T01:00:00Z' });
    const bReport = await createMonthlyReport({ userId: b.id, treeId: tree, dates: ['2026-11-03', '2026-11-04', '2026-11-06'], submittedAt: '2026-11-07T01:00:00Z' });
    await approve(bReport, '2026-11-08T01:00:00Z');
    const cReport = await createMonthlyReport({ userId: c.id, treeId: tree, dates: ['2026-10-10'], submittedAt: '2026-10-31T10:00:00Z' });
    await approve(cReport, '2026-10-31T12:00:00Z'); // 10월 봉사시간: 11월 합계에 안 들어감
    await createMonthlyReport({ userId: a.id, treeId: otherTree, agency: '종로구', dates: ['2026-11-02'] });

    // 물품: 중구 승인 대기 2, 수령 대기 1, 종로구 1
    await createRental(a.id, '중구', 'requested');
    await createRental(b.id, '중구', 'requested');
    await createRental(c.id, '중구', 'approved');
    await createRental(a.id, '종로구', 'requested');

    // 신고: 중구 확인 필요 1, 현장 확인 1, 조치 완료 1, 종로구 1
    await createIncident(a.id, tree, '중구', 'pending', '2026-11-09T00:00:00Z');
    await createIncident(b.id, tree, '중구', 'inspecting', '2026-11-01T00:00:00Z');
    await createIncident(c.id, tree, '중구', 'resolved', '2026-10-01T00:00:00Z');
    await createIncident(a.id, otherTree, '종로구', 'pending', '2026-11-09T00:00:00Z');

    const res = await request(api).get('/admin/dashboard?month=2026-11').set(auth(officer.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      agency: '중구',
      month: '2026-11',
      organizationId: null,
      monthlyReports: { pending: 1, revisionRequested: 0 },
      applications: { pending: 1 },
      rentals: { requested: 2, awaitingPickup: 1 },
      incidentReports: { pending: 1, inspecting: 1, oldestUnresolvedAt: '2026-11-01T00:00:00.000Z' },
      caregivers: {
        active: 3,
        missingReport: 1,
        missingReportList: [{ userId: c.id, nickname: '다', treeCount: 1 }],
      },
      volunteerHours: { minutes: 90, people: 1 },
    });
  });

  it('단체를 고르면 그 단체 회원으로 좁히고, 단체 목록을 준다', async () => {
    const tree = await createTree({ agency: '중구' });
    const member = await createUser({ nickname: '회원' });
    const outsider = await createUser({ nickname: '비회원' });
    for (const u of [member, outsider]) await createApplication({ userId: u.id, treeId: tree, status: 'approved', reviewedBy: officer.id });
    await db().query("UPDATE caregiver_applications SET period_start = '2026-06-01', period_end = '2027-05-31'");
    const orgId = await createOrg('시티트리클럽', [member.id]);
    await createOrg('관계없는 단체', [(await createUser()).id]); // 중구 나무 돌보미 없음: 목록에 안 나옴
    await createMonthlyReport({ userId: member.id, treeId: tree, dates: ['2026-11-02'], submittedAt: '2026-11-05T01:00:00Z' });
    await createMonthlyReport({ userId: outsider.id, treeId: tree, dates: ['2026-11-02'], submittedAt: '2026-11-05T01:00:00Z' });
    await createRental(outsider.id, '중구', 'requested');

    const all = await request(api).get('/admin/dashboard?month=2026-11').set(auth(officer.token));
    expect(all.body.monthlyReports.pending).toBe(2);
    expect(all.body.organizations).toEqual([{ id: orgId, name: '시티트리클럽' }]);

    const filtered = await request(api).get(`/admin/dashboard?month=2026-11&organizationId=${orgId}`).set(auth(officer.token));
    expect(filtered.body).toMatchObject({
      organizationId: orgId,
      monthlyReports: { pending: 1 },
      rentals: { requested: 0 },
      caregivers: { active: 1, missingReport: 0 },
    });
  });

  it('month를 안 주면 이번 달, 형식이 틀리면 400', async () => {
    const ok = await request(api).get('/admin/dashboard').set(auth(officer.token));
    expect(ok.body.month).toBe(currentMonth());
    const bad = await request(api).get('/admin/dashboard?month=2026-13').set(auth(officer.token));
    expect(bad.status).toBe(400);
  });

  it('데이터가 없으면 0으로 준다', async () => {
    const res = await request(api).get('/admin/dashboard?month=2026-11').set(auth(officer.token));
    expect(res.body).toMatchObject({
      monthlyReports: { pending: 0, revisionRequested: 0 },
      incidentReports: { pending: 0, inspecting: 0, oldestUnresolvedAt: null },
      caregivers: { active: 0, missingReport: 0, missingReportList: [] },
      volunteerHours: { minutes: 0, people: 0 },
      organizations: [],
    });
  });

  it('시민은 403', async () => {
    const citizen = await createUser();
    const res = await request(api).get('/admin/dashboard').set(auth(citizen.token));
    expect(res.status).toBe(403);
  });
});
