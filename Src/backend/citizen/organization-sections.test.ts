import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createActivity, createApplication, createIncident, createTree, createUser, resetData } from '../test/fixtures.js';

const api = createApp();

beforeEach(resetData);
afterAll(closePool);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
type User = { id: number; token: string };

let admin: User;
let member: User;
let org: { id: number; name: string; inviteCode: string };

beforeEach(async () => {
  admin = await createUser({ nickname: '관리자' });
  member = await createUser({ nickname: '회원' });
  org = (await request(api).post('/organizations').set(auth(admin.token)).send({ name: '시티트리클럽' })).body;
  await request(api).post('/organizations/join').set(auth(member.token)).send({ inviteCode: org.inviteCode });
});

const addSection = (user: User, district: string, place: string) =>
  request(api).post(`/organizations/${org.id}/sections`).set(auth(user.token)).send({ district, place });

describe('단체 관심 구간', () => {
  it('관리자가 나무가 있는 구간을 추가하면 나무 수와 함께 저장되고, 회원은 목록을 본다', async () => {
    await createTree({ roadName: '소파로' });
    await createTree({ roadName: '소파로' });

    const res = await addSection(admin, '중구', '소파로');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ district: '중구', place: '소파로', treeCount: 2 });
    const list = await request(api).get(`/organizations/${org.id}/sections`).set(auth(member.token));
    expect(list.status).toBe(200);
    expect(list.body.sections).toEqual([expect.objectContaining({ id: res.body.id, place: '소파로', treeCount: 2 })]);
  });

  it('회원은 추가·삭제할 수 없고(403), 나무가 없는 구간은 404, 같은 구간은 409', async () => {
    await createTree({ roadName: '소파로' });

    expect((await addSection(member, '중구', '소파로')).status).toBe(403);
    expect((await addSection(admin, '중구', '없는길')).status).toBe(404);
    expect((await addSection(admin, '중구', '소파로')).status).toBe(201);
    expect((await addSection(admin, '중구', '소파로')).status).toBe(409);
  });

  it('관리자는 구간을 지운다. 다른 단체의 구간 id 는 404', async () => {
    await createTree({ roadName: '소파로' });
    const section = (await addSection(admin, '중구', '소파로')).body;
    const otherAdmin = await createUser();
    const otherOrg = (await request(api).post('/organizations').set(auth(otherAdmin.token)).send({ name: '다른 단체' })).body;

    expect((await request(api).delete(`/organizations/${otherOrg.id}/sections/${section.id}`).set(auth(otherAdmin.token))).status).toBe(404);
    expect((await request(api).delete(`/organizations/${org.id}/sections/${section.id}`).set(auth(member.token))).status).toBe(403);
    expect((await request(api).delete(`/organizations/${org.id}/sections/${section.id}`).set(auth(admin.token))).status).toBe(204);
    expect((await request(api).get(`/organizations/${org.id}/sections`).set(auth(admin.token))).body.sections).toEqual([]);
  });

  it('단체당 관심 구간은 20개까지', async () => {
    await createTree({ roadName: '소파로' });
    for (let i = 0; i < 20; i += 1) {
      await getPool().query('INSERT INTO organization_sections (organization_id, district, place) VALUES ($1, $2, $3)', [org.id, '중구', `길${i}`]);
    }

    const res = await addSection(admin, '중구', '소파로');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SECTION_LIMIT');
  });
});

describe('GET /organizations/:id/section-report', () => {
  /** 소파로 나무 3그루: 돌봄 중(회원+비회원 돌보미) / 활동 끊김 / 돌보미 없음 */
  async function setup() {
    const officer = await createUser({ role: 'officer' });
    const outsiderCaregiver = await createUser({ nickname: '비회원돌보미' }); // 단체 회원이 아닌 돌보미
    const idleCaregiver = await createUser({ nickname: '쉬는돌보미' });
    const cared = await createTree({ roadName: '소파로' });
    const idle = await createTree({ roadName: '소파로' });
    const lonely = await createTree({ roadName: '소파로', species: '느티나무' });
    const elsewhere = await createTree({ roadName: '을지로' }); // 관심 구간 밖
    const approve = (userId: number, treeId: number) =>
      createApplication({ userId, treeId, status: 'approved', reviewedBy: officer.id, periodStart: '2026-11-01', periodEnd: '2027-10-31' });
    const otherDistrict = await createTree({ roadName: '소파로', agency: '종로구' }); // 같은 이름 길이지만 다른 구 → 구간 밖
    await approve(member.id, cared);
    await approve(outsiderCaregiver.id, cared);
    await approve(idleCaregiver.id, idle);
    await approve(outsiderCaregiver.id, idle); // 한 사람이 구간의 두 그루를 돌봐도 구간 돌보미 수는 한 명
    await approve(member.id, elsewhere);
    await approve(member.id, otherDistrict);
    // 심사 대기 신청은 기간이 그 달에 걸쳐도 돌보미가 아니다
    await createApplication({ userId: (await createUser()).id, treeId: lonely, periodStart: '2026-11-01', periodEnd: '2027-10-31' });
    await createActivity({ userId: member.id, treeId: otherDistrict, date: '2026-11-07', minutes: 50 }); // 다른 구
    await createActivity({ userId: member.id, treeId: cared, date: '2026-11-03', minutes: 30 });
    await createActivity({ userId: member.id, treeId: cared, date: '2026-11-10', minutes: 20 });
    await createActivity({ userId: outsiderCaregiver.id, treeId: cared, date: '2026-11-10', minutes: 40 }); // 비회원 활동도 센다
    await createActivity({ userId: member.id, treeId: cared, date: '2026-10-31', minutes: 99 }); // 지난달
    await createActivity({ userId: member.id, treeId: elsewhere, date: '2026-11-05', minutes: 60 }); // 구간 밖
    await createIncident({ userId: member.id, treeId: lonely, createdAt: '2026-11-12T10:00:00+09:00' });
    const section = (await addSection(admin, '중구', '소파로')).body;
    return { cared, idle, lonely, section };
  }

  const report = (user: User, month = '2026-11', format = '') =>
    request(api).get(`/organizations/${org.id}/section-report?month=${month}${format ? `&format=${format}` : ''}`).set(auth(user.token));

  it('관심 구간의 모든 돌보미(회원이 아니어도) 활동을 구간·나무 단위 익명 합계로 준다', async () => {
    const { cared, idle, lonely } = await setup();

    const res = await report(member); // 회원도 본다 (익명 합계라서)

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ organization: { id: org.id, name: '시티트리클럽' }, month: '2026-11' });
    expect(res.body.sections).toHaveLength(1);
    const s = res.body.sections[0];
    expect(s).toMatchObject({
      district: '중구',
      place: '소파로',
      treeCount: 3,
      caredTreeCount: 2,
      inactiveTreeCount: 1,
      noCaregiverTreeCount: 1,
      caregiverCount: 3,
      activityCount: 3,
      minutes: 90,
      activityDays: 2,
      reported: 1,
      resolved: 0,
    });
    const byId = Object.fromEntries(s.trees.map((t: { treeId: number }) => [t.treeId, t]));
    expect(byId[cared]).toMatchObject({ status: 'cared', caregiverCount: 2, activityCount: 3, minutes: 90, activityDays: 2, lastActivityDate: '2026-11-10' });
    expect(byId[idle]).toMatchObject({ status: 'inactive', caregiverCount: 2, activityCount: 0 });
    expect(byId[lonely]).toMatchObject({ status: 'no_caregiver', caregiverCount: 0, reported: 1 });
    expect(byId[lonely].name).toContain('느티나무, 소파로');
    expect(res.body.totals).toMatchObject({ sectionCount: 1, treeCount: 3, activityCount: 3, minutes: 90 });
  });

  it('누가 했는지는 어디에도 없다 (별명·실명·사용자 id)', async () => {
    await setup();

    const res = await report(admin);

    expect(JSON.stringify(res.body)).not.toMatch(/비회원돌보미|쉬는돌보미|관리자|회원"|실명|userId|nickname/);
  });

  it('format=csv 는 단체 이름이 든 엑셀용 CSV 파일로 준다', async () => {
    await setup();

    const res = await report(admin, '2026-11', 'csv');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(res.text.startsWith('﻿')).toBe(true); // 엑셀이 UTF-8로 읽는 표시
    expect(res.text).toContain('시티트리클럽');
    expect(res.text).toContain('2026-11');
    expect(res.text).toContain('소파로');
    expect(res.text).not.toMatch(/비회원돌보미|쉬는돌보미|실명/);
  });

  it('단체 밖 사람은 403, 없는 단체는 404, 달 형식이 틀리면 400, 관심 구간이 없으면 빈 목록', async () => {
    const outsider = await createUser();
    expect((await report(outsider)).status).toBe(403);
    expect((await request(api).get('/organizations/999999/section-report?month=2026-11').set(auth(admin.token))).status).toBe(404);
    expect((await report(admin, '2026-13')).status).toBe(400);

    const empty = await report(admin);
    expect(empty.status).toBe(200);
    expect(empty.body.sections).toEqual([]);
  });
});
