import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createMonthlyReport, createTree, createUser, resetData } from '../test/fixtures.js';
import { formatMinutes } from './monthly-reports.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let officer: { id: number; token: string };
let caregiver: { id: number; token: string };
let tree: number;

beforeEach(async () => {
  await resetData();
  officer = await createUser({ role: 'officer', agency: '중구' });
  caregiver = await createUser({ nickname: '은행지기' });
  tree = await createTree({ agency: '중구' });
});
afterAll(closePool);

async function volunteerRows(reportId: number) {
  const { rows } = await getPool().query('SELECT user_id, minutes, recorded_by FROM volunteer_hours WHERE monthly_report_id = $1', [reportId]);
  return rows;
}
async function notifications(userId: number) {
  const { rows } = await getPool().query('SELECT type, title, body FROM notifications WHERE user_id = $1 ORDER BY id', [userId]);
  return rows;
}

describe('formatMinutes', () => {
  it('분을 시간·분으로 쓴다', () => {
    expect(formatMinutes(45)).toBe('45분');
    expect(formatMinutes(120)).toBe('2시간');
    expect(formatMinutes(200)).toBe('3시간 20분');
  });
});

describe('GET /admin/monthly-reports', () => {
  it('내 관리청의 검토 대기 보고서를 오래된 순으로, 기록 요약과 함께 준다', async () => {
    const newer = await createMonthlyReport({ userId: caregiver.id, treeId: tree, dates: ['2026-11-03', '2026-11-05'], submittedAt: '2026-11-10T00:00:00Z' });
    const older = await createMonthlyReport({ userId: (await createUser()).id, treeId: tree, dates: ['2026-10-20'], submittedAt: '2026-11-01T00:00:00Z' });
    await createMonthlyReport({ userId: caregiver.id, treeId: await createTree({ agency: '종로구' }), agency: '종로구', dates: ['2026-11-04'] });

    const res = await request(api).get('/admin/monthly-reports').set(auth(officer.token));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((r: { id: number }) => r.id)).toEqual([older, newer]);
    expect(res.body.items[1]).toMatchObject({
      status: 'submitted',
      totalMinutes: 60,
      recordCount: 2,
      treeCount: 1,
      firstDate: '2026-11-03',
      lastDate: '2026-11-05',
      volunteerMinutes: null,
      caregiver: { id: caregiver.id, nickname: '은행지기' },
    });
  });

  it('시민은 403', async () => {
    const res = await request(api).get('/admin/monthly-reports').set(auth(caregiver.token));
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/monthly-reports/:id', () => {
  it('묶인 활동 기록을 날짜순으로 준다', async () => {
    const id = await createMonthlyReport({ userId: caregiver.id, treeId: tree, dates: ['2026-11-05', '2026-11-03'] });
    const res = await request(api).get(`/admin/monthly-reports/${id}`).set(auth(officer.token));
    expect(res.status).toBe(200);
    expect(res.body.records.map((r: { activityDate: string }) => r.activityDate)).toEqual(['2026-11-03', '2026-11-05']);
    expect(res.body.records[0]).toMatchObject({ activityKind: '주변 청소', durationMin: 30, tree: { id: tree, species: '은행나무' } });
  });

  it('다른 관리청 보고서는 404', async () => {
    const id = await createMonthlyReport({ userId: caregiver.id, treeId: tree, agency: '종로구', dates: ['2026-11-03'] });
    const res = await request(api).get(`/admin/monthly-reports/${id}`).set(auth(officer.token));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /admin/monthly-reports/:id', () => {
  it('승인하면 봉사시간을 합계 그대로 기록하고 알림을 만든다', async () => {
    const id = await createMonthlyReport({ userId: caregiver.id, treeId: tree, dates: ['2026-11-03', '2026-11-05', '2026-11-07'], minutesEach: 40 });
    const res = await request(api).patch(`/admin/monthly-reports/${id}`).set(auth(officer.token)).send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'approved', reviewedBy: officer.id, volunteerMinutes: 120 });
    expect(res.body.records).toHaveLength(3);
    expect(await volunteerRows(id)).toEqual([{ user_id: caregiver.id, minutes: 120, recorded_by: officer.id }]);
    const notes = await notifications(caregiver.id);
    expect(notes).toEqual([
      {
        type: 'monthly_report_result',
        title: '월간 보고서가 승인되었어요',
        body: '2026-11-03 ~ 2026-11-07 활동 2시간이 봉사시간으로 기록되었어요.',
      },
    ]);
  });

  it('보완 요청은 의견이 필요하고, 봉사시간은 기록하지 않는다', async () => {
    const id = await createMonthlyReport({ userId: caregiver.id, treeId: tree, dates: ['2026-11-03'] });
    const noNote = await request(api).patch(`/admin/monthly-reports/${id}`).set(auth(officer.token)).send({ status: 'revision_requested' });
    expect(noNote.status).toBe(400);

    const res = await request(api)
      .patch(`/admin/monthly-reports/${id}`)
      .set(auth(officer.token))
      .send({ status: 'revision_requested', reviewNote: '사진을 한 장 더 붙여 주세요' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'revision_requested', reviewNote: '사진을 한 장 더 붙여 주세요', volunteerMinutes: null });
    expect(await volunteerRows(id)).toEqual([]);
    expect((await notifications(caregiver.id))[0].body).toContain('사진을 한 장 더 붙여 주세요');
  });

  it('이미 승인한 보고서는 409, 봉사시간·알림이 더 생기지 않는다', async () => {
    const id = await createMonthlyReport({ userId: caregiver.id, treeId: tree, dates: ['2026-11-03'] });
    await request(api).patch(`/admin/monthly-reports/${id}`).set(auth(officer.token)).send({ status: 'approved' });
    const again = await request(api).patch(`/admin/monthly-reports/${id}`).set(auth(officer.token)).send({ status: 'approved' });
    expect(again.status).toBe(409);
    expect(await volunteerRows(id)).toHaveLength(1);
    expect(await notifications(caregiver.id)).toHaveLength(1);
  });

  it('두 담당자가 동시에 승인해도 봉사시간은 한 번만 기록된다', async () => {
    const other = await createUser({ role: 'officer', agency: '중구' });
    const id = await createMonthlyReport({ userId: caregiver.id, treeId: tree, dates: ['2026-11-03'] });
    const results = await Promise.all([
      request(api).patch(`/admin/monthly-reports/${id}`).set(auth(officer.token)).send({ status: 'approved' }),
      request(api).patch(`/admin/monthly-reports/${id}`).set(auth(other.token)).send({ status: 'approved' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await volunteerRows(id)).toHaveLength(1);
  });

  it('보완 요청 후 다시 제출되면 승인할 수 있다', async () => {
    const id = await createMonthlyReport({ userId: caregiver.id, treeId: tree, dates: ['2026-11-03'] });
    await request(api).patch(`/admin/monthly-reports/${id}`).set(auth(officer.token)).send({ status: 'revision_requested', reviewNote: '보완' });
    await getPool().query("UPDATE monthly_reports SET status = 'submitted', submitted_at = now() WHERE id = $1", [id]); // 시민-BE의 재제출
    const res = await request(api).patch(`/admin/monthly-reports/${id}`).set(auth(officer.token)).send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.volunteerMinutes).toBe(30);
  });

  it('다른 관리청 보고서는 404이고 바뀌지 않는다', async () => {
    const id = await createMonthlyReport({ userId: caregiver.id, treeId: tree, agency: '종로구', dates: ['2026-11-03'] });
    const res = await request(api).patch(`/admin/monthly-reports/${id}`).set(auth(officer.token)).send({ status: 'approved' });
    expect(res.status).toBe(404);
    expect(await volunteerRows(id)).toEqual([]);
  });
});

describe('GET /volunteer-hours/me', () => {
  it('승인된 내 봉사시간만 최신순으로, 합계와 함께 준다', async () => {
    const first = await createMonthlyReport({ userId: caregiver.id, treeId: tree, dates: ['2026-10-03'], minutesEach: 50 });
    const second = await createMonthlyReport({ userId: caregiver.id, treeId: tree, dates: ['2026-11-03', '2026-11-04'], minutesEach: 30 });
    await createMonthlyReport({ userId: caregiver.id, treeId: tree, dates: ['2026-11-10'] }); // 검토 대기: 포함 안 됨
    const someoneElse = await createUser();
    const others = await createMonthlyReport({ userId: someoneElse.id, treeId: tree, dates: ['2026-11-03'] });
    for (const id of [first, second, others]) {
      await request(api).patch(`/admin/monthly-reports/${id}`).set(auth(officer.token)).send({ status: 'approved' });
    }

    const res = await request(api).get('/volunteer-hours/me').set(auth(caregiver.token));
    expect(res.status).toBe(200);
    expect(res.body.totalMinutes).toBe(110);
    expect(res.body.items.map((i: { monthlyReport: { id: number } }) => i.monthlyReport.id)).toEqual([second, first]);
    expect(res.body.items[0]).toMatchObject({ minutes: 60, monthlyReport: { firstDate: '2026-11-03', lastDate: '2026-11-04', agency: '중구' } });
  });

  it('year로 해를 고른다', async () => {
    const id = await createMonthlyReport({ userId: caregiver.id, treeId: tree, dates: ['2026-11-03'] });
    await request(api).patch(`/admin/monthly-reports/${id}`).set(auth(officer.token)).send({ status: 'approved' });
    const thisYear = await request(api).get(`/volunteer-hours/me?year=${new Date().getFullYear()}`).set(auth(caregiver.token));
    const lastYear = await request(api).get(`/volunteer-hours/me?year=${new Date().getFullYear() - 1}`).set(auth(caregiver.token));
    expect(thisYear.body.totalMinutes).toBe(30);
    expect(lastYear.body.totalMinutes).toBe(0);
  });

  it('로그인하지 않으면 401', async () => {
    const res = await request(api).get('/volunteer-hours/me');
    expect(res.status).toBe(401);
  });
});
