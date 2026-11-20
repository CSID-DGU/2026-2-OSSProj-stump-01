import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createRental, createRentalItem, createTree, createUser, resetData } from '../test/fixtures.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** 오늘(한국 시간)에서 days일 옮긴 날짜 'YYYY-MM-DD' */
function seoulDate(days = 0): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

let me: { id: number; token: string };
let officer: { id: number; token: string };
let junguTree: number;
let gloves: number; // 중구 물품
let hat: number; // 중구 물품
let jongnoItem: number; // 종로구 물품

beforeEach(async () => {
  await resetData();
  me = await createUser();
  officer = await createUser({ role: 'officer', agency: '중구' });
  junguTree = await createTree({ agency: '중구' });
  gloves = await createRentalItem({ agency: '중구', name: '쿨토시', stock: 10 });
  hat = await createRentalItem({ agency: '중구', name: '모자', stock: 2 });
  jongnoItem = await createRentalItem({ agency: '종로구', name: '물병', stock: 10 });
});
afterAll(closePool);

/** 오늘을 포함하는 기간으로 승인된 돌보미를 만든다. */
async function approveCaregiver(userId: number, treeId: number, period = { start: seoulDate(-30), end: seoulDate(300) }) {
  await getPool().query(
    `INSERT INTO caregiver_applications (user_id, tree_id, status, period_start, period_end, reviewed_by, reviewed_at)
     VALUES ($1, $2, 'approved', $3, $4, $5, now())`,
    [userId, treeId, period.start, period.end, officer.id],
  );
}

const apply = (itemId: number, quantity = 1, token = me.token) =>
  request(api).post('/rentals').set(auth(token)).send({ itemId, quantity });

async function countRentals(userId: number): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>('SELECT count(*)::int AS n FROM rentals WHERE user_id = $1', [userId]);
  return rows[0]!.n;
}

describe('GET /rental-items', () => {
  it('내가 돌보는 나무의 관리청 물품만 재고와 함께 준다', async () => {
    await approveCaregiver(me.id, junguTree);

    const res = await request(api).get('/rental-items').set(auth(me.token));

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { id: hat, agency: '중구', name: '모자', stock: 2 },
      { id: gloves, agency: '중구', name: '쿨토시', stock: 10 },
    ]);
  });

  it('승인된 돌보미가 아니면 빈 목록', async () => {
    const res = await request(api).get('/rental-items').set(auth(me.token));
    expect(res.body.items).toEqual([]);
  });

  it('토큰 없으면 401', async () => {
    expect((await request(api).get('/rental-items')).status).toBe(401);
  });
});

describe('POST /rentals', () => {
  it('돌보미가 물품을 신청하면 "신청" 상태로 그 관리청 처리 목록에 들어간다', async () => {
    await approveCaregiver(me.id, junguTree);

    const res = await apply(gloves, 2);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'requested',
      quantity: 2,
      item: { id: gloves, name: '쿨토시', agency: '중구' },
      rejectReason: null,
      receivedAt: null,
    });
    const queue = await request(api).get('/admin/rentals').set(auth(officer.token));
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((r: { id: number }) => r.id)).toEqual([res.body.id]);
  });

  it('신청만으로는 재고가 줄지 않는다(구청이 승인할 때 줄인다)', async () => {
    await approveCaregiver(me.id, junguTree);
    await apply(gloves, 3);
    const { rows } = await getPool().query('SELECT stock FROM rental_items WHERE id = $1', [gloves]);
    expect(rows[0].stock).toBe(10);
  });

  it('다른 관리청 물품은 신청할 수 없다(403)', async () => {
    await approveCaregiver(me.id, junguTree);
    const res = await apply(jongnoItem);
    expect(res.status).toBe(403);
    expect(await countRentals(me.id)).toBe(0);
  });

  it('승인된 돌보미가 아니면 403', async () => {
    const res = await apply(gloves);
    expect(res.status).toBe(403);
  });

  it('남은 재고보다 많이 신청하면 409', async () => {
    await approveCaregiver(me.id, junguTree);
    const res = await apply(hat, 3);
    expect(res.status).toBe(409);
    expect(await countRentals(me.id)).toBe(0);
  });

  it('같은 물품에 처리 중인 신청이 있으면 409, 수령한 뒤에는 다시 신청할 수 있다', async () => {
    await approveCaregiver(me.id, junguTree);
    expect((await apply(gloves)).status).toBe(201);
    expect((await apply(gloves)).status).toBe(409);

    await getPool().query(
      `UPDATE rentals SET status = 'received', handled_by = $1, handled_at = now(), received_at = now() WHERE user_id = $2`,
      [officer.id, me.id],
    );
    expect((await apply(gloves)).status).toBe(201);
  });

  it('없는 물품은 404', async () => {
    await approveCaregiver(me.id, junguTree);
    expect((await apply(999_999)).status).toBe(404);
  });

  it.each([
    ['수량이 0이면', 0],
    ['수량이 6이면', 6],
    ['수량이 소수면', 1.5],
  ])('%s 400', async (_, quantity) => {
    await approveCaregiver(me.id, junguTree);
    const res = await apply(gloves, quantity);
    expect(res.status).toBe(400);
    expect(res.body.error.issues.map((i: { path: string[] }) => i.path[0])).toEqual(['quantity']);
  });

  it('구청 담당자 계정은 403', async () => {
    expect((await apply(gloves, 1, officer.token)).status).toBe(403);
  });
});

describe('GET /rentals/me', () => {
  it('내 신청을 최신순으로, 물품 이름·상태·반려 사유와 함께 준다', async () => {
    const other = await createUser();
    const older = await createRental({ itemId: gloves, userId: me.id, createdAt: '2026-11-01T09:00:00+09:00' });
    const newer = await createRental({ itemId: hat, userId: me.id, createdAt: '2026-11-02T09:00:00+09:00' });
    await createRental({ itemId: gloves, userId: other.id });
    await getPool().query(
      `UPDATE rentals SET status = 'rejected', reject_reason = '재고 소진', handled_by = $1, handled_at = now() WHERE id = $2`,
      [officer.id, older],
    );

    const res = await request(api).get('/rentals/me').set(auth(me.token));

    expect(res.status).toBe(200);
    expect(res.body.rentals.map((r: { id: number }) => r.id)).toEqual([newer, older]);
    expect(res.body.rentals[1]).toMatchObject({ status: 'rejected', rejectReason: '재고 소진', item: { name: '쿨토시' } });
  });
});
