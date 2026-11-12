import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool } from '../common/db.js';
import { createIncident, createTree, createUser, resetData } from '../test/fixtures.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let officer: { id: number; token: string };
let reporter: { id: number; token: string };
let tree: number;

beforeEach(async () => {
  await resetData();
  officer = await createUser({ role: 'officer', agency: '중구' });
  reporter = await createUser({ nickname: '산책러' });
  tree = await createTree({ agency: '중구' });
});
afterAll(closePool);

const patch = (id: number, body: object) => request(api).patch(`/admin/incident-reports/${id}`).set(auth(officer.token)).send(body);

describe('GET /admin/incident-reports', () => {
  it('내 관리청의 미처리 신고를 오래된 순(경과일순)으로 준다', async () => {
    const newer = await createIncident({ userId: reporter.id, treeId: tree, createdAt: '2026-11-10T03:00:00Z' });
    const older = await createIncident({ userId: reporter.id, treeId: tree, category: 'leaning', urgency: 'high', createdAt: '2026-11-01T03:00:00Z' });
    await createIncident({ userId: reporter.id, treeId: await createTree({ agency: '종로구' }), agency: '종로구' });
    const done = await createIncident({ userId: reporter.id, treeId: tree, createdAt: '2026-10-01T03:00:00Z' });
    await patch(done, { status: 'inspecting' });
    await patch(done, { status: 'resolved', actionNote: '방제 완료' });

    const res = await request(api).get('/admin/incident-reports').set(auth(officer.token));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((r: { id: number }) => r.id)).toEqual([older, newer]);
    expect(res.body.items[0]).toMatchObject({
      status: 'pending',
      category: 'leaning',
      categoryLabel: '기울어짐·쓰러짐',
      urgency: 'high',
      photoUrl: 'https://example.com/report.jpg',
      location: { lat: 37.5601, lng: 126.9701 },
      reporter: { id: reporter.id, nickname: '산책러' },
      tree: { id: tree, species: '은행나무' },
    });
    expect(res.body.items[0].elapsedDays).toBeGreaterThan(res.body.items[1].elapsedDays);
  });

  it('status로 조치 완료 목록을 본다', async () => {
    const id = await createIncident({ userId: reporter.id, treeId: tree });
    await patch(id, { status: 'inspecting' });
    await patch(id, { status: 'resolved', actionNote: '가지 정리' });
    const res = await request(api).get('/admin/incident-reports?status=resolved').set(auth(officer.token));
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ status: 'resolved', actionNote: '가지 정리', elapsedDays: 0 });
  });

  it('신고는 구청 담당자만 본다 (시민 403, 다른 관리청 404)', async () => {
    const id = await createIncident({ userId: reporter.id, treeId: tree, agency: '종로구' });
    expect((await request(api).get('/admin/incident-reports').set(auth(reporter.token))).status).toBe(403);
    expect((await request(api).get(`/admin/incident-reports/${id}`).set(auth(officer.token))).status).toBe(404);
  });
});

describe('PATCH /admin/incident-reports/:id', () => {
  it('확인 필요 → 현장 확인 → 조치 완료 순서로 바꾸고 처리 시각·담당자를 남긴다', async () => {
    const id = await createIncident({ userId: reporter.id, treeId: tree });

    const inspecting = await patch(id, { status: 'inspecting', actionNote: '내일 현장 방문' });
    expect(inspecting.status).toBe(200);
    expect(inspecting.body).toMatchObject({ status: 'inspecting', actionNote: '내일 현장 방문', handledBy: officer.id, resolvedAt: null });
    expect(inspecting.body.inspectedAt).not.toBeNull();

    const resolved = await patch(id, { status: 'resolved', actionNote: '지지대 보강' });
    expect(resolved.body).toMatchObject({ status: 'resolved', actionNote: '지지대 보강' });
    expect(resolved.body.resolvedAt).not.toBeNull();
  });

  it('단계를 건너뛰거나 되돌릴 수 없다', async () => {
    const id = await createIncident({ userId: reporter.id, treeId: tree });
    expect((await patch(id, { status: 'resolved', actionNote: '바로 완료' })).status).toBe(409);
    await patch(id, { status: 'inspecting' });
    expect((await patch(id, { status: 'inspecting' })).status).toBe(409);
    expect((await patch(id, { status: 'pending' })).status).toBe(400);
  });

  it('조치 완료에는 조치 내용이 필요하다(앞서 남긴 메모가 있으면 그것으로 된다)', async () => {
    const a = await createIncident({ userId: reporter.id, treeId: tree });
    await patch(a, { status: 'inspecting' });
    const noNote = await patch(a, { status: 'resolved' });
    expect(noNote.status).toBe(400);

    const b = await createIncident({ userId: reporter.id, treeId: tree });
    await patch(b, { status: 'inspecting', actionNote: '가지 제거함' });
    expect((await patch(b, { status: 'resolved' })).body.actionNote).toBe('가지 제거함');
  });

  it('처리 메모만 고칠 수 있고, 조치 완료 후에는 바꿀 수 없다', async () => {
    const id = await createIncident({ userId: reporter.id, treeId: tree });
    const memo = await patch(id, { actionNote: '담당 부서 전달' });
    expect(memo.body).toMatchObject({ status: 'pending', actionNote: '담당 부서 전달' });
    await patch(id, { status: 'inspecting' });
    await patch(id, { status: 'resolved' });
    expect((await patch(id, { actionNote: '수정' })).status).toBe(409);
    expect((await patch(id, {})).status).toBe(400);
  });

  it('다른 관리청 신고는 404', async () => {
    const id = await createIncident({ userId: reporter.id, treeId: tree, agency: '종로구' });
    expect((await patch(id, { status: 'inspecting' })).status).toBe(404);
  });
});
