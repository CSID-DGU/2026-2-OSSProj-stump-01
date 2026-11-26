import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import {
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

let officer: { id: number; token: string };
let member: { id: number; token: string };
let outsider: { id: number; token: string };
let orgId: number;

beforeEach(async () => {
  await resetData();
  officer = await createUser({ role: 'officer', agency: '중구' });
  member = await createUser({ nickname: '회원' });
  outsider = await createUser({ nickname: '비회원' });
  const { rows } = await getPool().query("INSERT INTO organizations (name, invite_code) VALUES ('시티트리클럽', 'CITY') RETURNING id");
  orgId = rows[0].id;
  await getPool().query('INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)', [orgId, member.id]);

  // 회원·비회원이 각각 신청·보고서·물품 신청·신고를 하나씩 낸다
  const item = await createRentalItem({ agency: '중구', name: '쿨토시' });
  for (const u of [member, outsider]) {
    const tree = await createTree({ agency: '중구' });
    await createApplication({ userId: u.id, treeId: tree });
    await createMonthlyReport({ userId: u.id, treeId: tree, dates: ['2026-11-02'] });
    await createRental({ itemId: item, userId: u.id });
    await createIncident({ userId: u.id, treeId: tree });
  }
});
afterAll(closePool);

// 목록마다 항목에서 사용자 id를 꺼내는 방법
const LISTS = [
  { path: '/admin/applications', userOf: (i: any) => i.applicant.id },
  { path: '/admin/monthly-reports', userOf: (i: any) => i.caregiver.id },
  { path: '/admin/rentals', userOf: (i: any) => i.requester.id },
  { path: '/admin/incident-reports', userOf: (i: any) => i.reporter.id },
];

describe.each(LISTS)('GET $path ?organizationId', ({ path, userOf }) => {
  it('없으면 전체, 주면 그 단체 회원 것만 같은 개수로 준다', async () => {
    const all = await request(api).get(path).set(auth(officer.token));
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);

    const org = await request(api).get(`${path}?organizationId=${orgId}`).set(auth(officer.token));
    expect(org.status).toBe(200);
    expect(org.body.total).toBe(1);
    expect(org.body.items.map(userOf)).toEqual([member.id]);
  });

  it('없는 단체는 404, 잘못된 값은 400', async () => {
    expect((await request(api).get(`${path}?organizationId=9999`).set(auth(officer.token))).status).toBe(404);
    expect((await request(api).get(`${path}?organizationId=abc`).set(auth(officer.token))).status).toBe(400);
  });
});
