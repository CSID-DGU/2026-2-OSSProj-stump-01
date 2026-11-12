import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createRental, createRentalItem, createUser, resetData } from '../test/fixtures.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let officer: { id: number; token: string };
let citizen: { id: number; token: string };

beforeEach(async () => {
  await resetData();
  officer = await createUser({ role: 'officer', agency: '중구' });
  citizen = await createUser({ nickname: '은행지기' });
});
afterAll(closePool);

const stockOf = async (itemId: number) =>
  (await getPool().query('SELECT stock FROM rental_items WHERE id = $1', [itemId])).rows[0].stock as number;
const notificationsOf = async (userId: number) =>
  (await getPool().query('SELECT type, title, body FROM notifications WHERE user_id = $1 ORDER BY id', [userId])).rows;
const patch = (id: number, body: object, token = officer.token) =>
  request(api).patch(`/admin/rentals/${id}`).set(auth(token)).send(body);

describe('물품·재고 /admin/rental-items', () => {
  it('등록하고, 내 관리청 물품만 신청 수량 합계와 함께 보여 준다', async () => {
    const created = await request(api).post('/admin/rental-items').set(auth(officer.token)).send({ name: '쿨토시', stock: 20 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: '쿨토시', stock: 20, requestedQuantity: 0, awaitingPickupQuantity: 0 });

    await createRentalItem({ agency: '종로구', name: '모자' });
    const r1 = await createRental({ itemId: created.body.id, userId: citizen.id, quantity: 2 });
    await createRental({ itemId: created.body.id, userId: citizen.id, quantity: 3 });
    await patch(r1, { status: 'approved' });

    const res = await request(api).get('/admin/rental-items').set(auth(officer.token));
    expect(res.body.items).toEqual([
      expect.objectContaining({ name: '쿨토시', stock: 18, requestedQuantity: 3, awaitingPickupQuantity: 2 }),
    ]);
  });

  it('같은 이름은 409, 음수 재고는 400', async () => {
    await createRentalItem({ name: '쿨토시' });
    const dup = await request(api).post('/admin/rental-items').set(auth(officer.token)).send({ name: '쿨토시' });
    expect(dup.status).toBe(409);
    const neg = await request(api).post('/admin/rental-items').set(auth(officer.token)).send({ name: '모자', stock: -1 });
    expect(neg.status).toBe(400);
  });

  it('재고·이름을 고친다. 다른 관리청 물품은 404', async () => {
    const mine = await createRentalItem({ name: '집게', stock: 5 });
    const res = await request(api).patch(`/admin/rental-items/${mine}`).set(auth(officer.token)).send({ stock: 30 });
    expect(res.body).toMatchObject({ name: '집게', stock: 30 });
    const empty = await request(api).patch(`/admin/rental-items/${mine}`).set(auth(officer.token)).send({});
    expect(empty.status).toBe(400);

    const others = await createRentalItem({ agency: '종로구' });
    const res404 = await request(api).patch(`/admin/rental-items/${others}`).set(auth(officer.token)).send({ stock: 1 });
    expect(res404.status).toBe(404);
  });
});

describe('물품 신청 /admin/rentals', () => {
  it('내 관리청의 승인 대기 신청을 오래된 순으로 준다', async () => {
    const item = await createRentalItem({ name: '쿨토시' });
    const newer = await createRental({ itemId: item, userId: citizen.id, createdAt: '2026-11-10T00:00:00Z' });
    const older = await createRental({ itemId: item, userId: citizen.id, createdAt: '2026-11-01T00:00:00Z' });
    await createRental({ itemId: await createRentalItem({ agency: '종로구' }), userId: citizen.id });

    const res = await request(api).get('/admin/rentals').set(auth(officer.token));
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((r: { id: number }) => r.id)).toEqual([older, newer]);
    expect(res.body.items[0]).toMatchObject({
      status: 'requested',
      quantity: 1,
      item: { id: item, name: '쿨토시' },
      requester: { id: citizen.id, nickname: '은행지기' },
    });
  });

  it('승인하면 재고를 줄이고 알림을 만든다. 수령은 재고를 다시 줄이지 않는다', async () => {
    const item = await createRentalItem({ name: '쿨토시', stock: 10 });
    const id = await createRental({ itemId: item, userId: citizen.id, quantity: 3 });

    const approved = await patch(id, { status: 'approved' });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'approved', handledBy: officer.id, item: { stock: 7 } });
    expect(await notificationsOf(citizen.id)).toEqual([
      { type: 'rental_result', title: '물품 신청이 승인되었어요', body: '쿨토시 3개 신청이 승인되었어요. 구청 안내에 따라 받아 가세요.' },
    ]);

    const received = await patch(id, { status: 'received' });
    expect(received.body.status).toBe('received');
    expect(received.body.receivedAt).not.toBeNull();
    expect(await stockOf(item)).toBe(7);
    expect(await notificationsOf(citizen.id)).toHaveLength(1);
  });

  it('재고가 부족하면 409이고 아무것도 바뀌지 않는다', async () => {
    const item = await createRentalItem({ stock: 2 });
    const id = await createRental({ itemId: item, userId: citizen.id, quantity: 3 });
    const res = await patch(id, { status: 'approved' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('재고가 부족하다');
    expect(await stockOf(item)).toBe(2);
    expect(await notificationsOf(citizen.id)).toEqual([]);
  });

  it('반려는 사유를 남길 수 있고 재고는 그대로다', async () => {
    const item = await createRentalItem({ name: '모자', stock: 5 });
    const id = await createRental({ itemId: item, userId: citizen.id });
    const res = await patch(id, { status: 'rejected', rejectReason: '이번 달 물량이 끝났어요' });
    expect(res.body).toMatchObject({ status: 'rejected', rejectReason: '이번 달 물량이 끝났어요' });
    expect(await stockOf(item)).toBe(5);
    expect((await notificationsOf(citizen.id))[0].body).toBe('모자 1개 신청이 반려되었어요. 사유: 이번 달 물량이 끝났어요');

    const noReason = await patch(await createRental({ itemId: item, userId: citizen.id }), { status: 'rejected' });
    expect(noReason.body.rejectReason).toBeNull();
  });

  it('정해진 순서로만 바뀐다', async () => {
    const item = await createRentalItem();
    const id = await createRental({ itemId: item, userId: citizen.id });
    expect((await patch(id, { status: 'received' })).status).toBe(409); // 승인 전 수령 불가
    await patch(id, { status: 'approved' });
    expect((await patch(id, { status: 'rejected' })).status).toBe(409); // 승인 후 반려 불가
    expect((await patch(id, { status: 'approved' })).status).toBe(409); // 두 번 승인 불가
    expect((await patch(id, { status: 'requested' })).status).toBe(400);
  });

  it('남은 재고보다 많은 신청을 동시에 승인해도 재고는 음수가 되지 않는다', async () => {
    const item = await createRentalItem({ stock: 1 });
    const other = await createUser({ role: 'officer', agency: '중구' });
    const a = await createRental({ itemId: item, userId: citizen.id });
    const b = await createRental({ itemId: item, userId: citizen.id });
    const results = await Promise.all([patch(a, { status: 'approved' }), patch(b, { status: 'approved' }, other.token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stockOf(item)).toBe(0);
  });

  it('다른 관리청 신청은 404, 시민은 403', async () => {
    const id = await createRental({ itemId: await createRentalItem({ agency: '종로구' }), userId: citizen.id });
    expect((await patch(id, { status: 'approved' })).status).toBe(404);
    expect((await request(api).get('/admin/rentals').set(auth(citizen.token))).status).toBe(403);
  });
});
