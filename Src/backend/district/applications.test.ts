import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createApplication, createTree, createUser, resetData } from '../test/fixtures.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let officer: { id: number; token: string };
let citizen: { id: number; token: string };
let myTree: number;
let otherTree: number;

beforeEach(async () => {
  await resetData();
  officer = await createUser({ role: 'officer', agency: '중구' });
  citizen = await createUser({ nickname: '은행지기' });
  myTree = await createTree({ agency: '중구' });
  otherTree = await createTree({ agency: '종로구' });
});
afterAll(closePool);

describe('GET /admin/applications', () => {
  it('내 관리청의 대기 신청만 오래된 순으로 준다', async () => {
    const other = await createUser();
    const newer = await createApplication({ userId: citizen.id, treeId: myTree, createdAt: '2026-11-10T00:00:00Z' });
    const older = await createApplication({ userId: other.id, treeId: myTree, createdAt: '2026-11-01T00:00:00Z' });
    await createApplication({ userId: citizen.id, treeId: otherTree }); // 다른 관리청
    await createApplication({ userId: (await createUser()).id, treeId: myTree, status: 'approved', reviewedBy: officer.id });

    const res = await request(api).get('/admin/applications').set(auth(officer.token));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((a: { id: number }) => a.id)).toEqual([older, newer]);
    expect(res.body.items[1]).toMatchObject({
      status: 'pending',
      periodStart: '2026-12-01',
      applicant: { id: citizen.id, nickname: '은행지기' },
      tree: { id: myTree, species: '은행나무', caregiverCount: 1 },
    });
  });

  it('status로 다른 상태를 고른다', async () => {
    await createApplication({ userId: citizen.id, treeId: myTree, status: 'rejected', reviewedBy: officer.id });
    const res = await request(api).get('/admin/applications?status=rejected').set(auth(officer.token));
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].rejectReason).toBe('테스트 반려');
  });

  it('잘못된 status는 400', async () => {
    const res = await request(api).get('/admin/applications?status=active').set(auth(officer.token));
    expect(res.status).toBe(400);
  });

  it('시민은 403', async () => {
    const res = await request(api).get('/admin/applications').set(auth(citizen.token));
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/applications/:id', () => {
  it('다른 관리청 신청서는 404', async () => {
    const id = await createApplication({ userId: citizen.id, treeId: otherTree });
    const res = await request(api).get(`/admin/applications/${id}`).set(auth(officer.token));
    expect(res.status).toBe(404);
  });

  it('내 관리청 신청서는 상세를 준다', async () => {
    const id = await createApplication({ userId: citizen.id, treeId: myTree });
    const res = await request(api).get(`/admin/applications/${id}`).set(auth(officer.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, motivation: '집 앞 나무를 돌보고 싶어요' });
  });
});

describe('PATCH /admin/applications/:id', () => {
  async function notificationsOf(userId: number) {
    const { rows } = await getPool().query('SELECT type, tree_id, title, body FROM notifications WHERE user_id = $1', [userId]);
    return rows;
  }

  it('승인하면 심사자·시각을 남기고 신청자에게 알림을 만든다', async () => {
    const id = await createApplication({ userId: citizen.id, treeId: myTree });
    const res = await request(api).patch(`/admin/applications/${id}`).set(auth(officer.token)).send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'approved', reviewedBy: officer.id, rejectReason: null });
    expect(res.body.reviewedAt).not.toBeNull();
    expect(res.body.tree.caregiverCount).toBe(1);
    const notes = await notificationsOf(citizen.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'application_result', tree_id: myTree, title: '돌보미 신청이 승인되었어요' });
  });

  it('반려는 사유가 필요하다', async () => {
    const id = await createApplication({ userId: citizen.id, treeId: myTree });
    const noReason = await request(api).patch(`/admin/applications/${id}`).set(auth(officer.token)).send({ status: 'rejected' });
    expect(noReason.status).toBe(400);
    const blank = await request(api)
      .patch(`/admin/applications/${id}`)
      .set(auth(officer.token))
      .send({ status: 'rejected', rejectReason: '   ' });
    expect(blank.status).toBe(400);

    const res = await request(api)
      .patch(`/admin/applications/${id}`)
      .set(auth(officer.token))
      .send({ status: 'rejected', rejectReason: '이미 돌보미가 충분해요' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'rejected', rejectReason: '이미 돌보미가 충분해요' });
    const notes = await notificationsOf(citizen.id);
    expect(notes[0].body).toContain('이미 돌보미가 충분해요');
  });

  it('이미 심사한 신청서는 409, 알림도 더 만들지 않는다', async () => {
    const id = await createApplication({ userId: citizen.id, treeId: myTree });
    await request(api).patch(`/admin/applications/${id}`).set(auth(officer.token)).send({ status: 'approved' });
    const again = await request(api)
      .patch(`/admin/applications/${id}`)
      .set(auth(officer.token))
      .send({ status: 'rejected', rejectReason: '변심' });
    expect(again.status).toBe(409);
    expect(await notificationsOf(citizen.id)).toHaveLength(1);
  });

  it('다른 관리청 신청서는 404이고 바뀌지 않는다', async () => {
    const id = await createApplication({ userId: citizen.id, treeId: otherTree });
    const res = await request(api).patch(`/admin/applications/${id}`).set(auth(officer.token)).send({ status: 'approved' });
    expect(res.status).toBe(404);
    const { rows } = await getPool().query('SELECT status FROM caregiver_applications WHERE id = $1', [id]);
    expect(rows[0].status).toBe('pending');
  });

  it('승인·반려 말고 다른 상태로는 못 바꾼다', async () => {
    const id = await createApplication({ userId: citizen.id, treeId: myTree });
    const res = await request(api).patch(`/admin/applications/${id}`).set(auth(officer.token)).send({ status: 'ended' });
    expect(res.status).toBe(400);
  });
});
