// #70 물품 지급 관리 (구청)
// 물품 신청은 시민-BE, 승인·반려·수령 처리와 재고는 구청-BE가 한다(CLAUDE.md 경계 규칙). 회수(반납)는 없다.
// 재고(stock)는 "아직 배정하지 않은 수량"이다. 승인할 때 신청 수량만큼 줄이고(배정), 수령은 상태만 바꾼다.
// 그래서 재고보다 많이 승인할 수 없다. 담당자는 자기 관리청(rental_items.agency)의 물품·신청만 다룬다.
import { Router } from 'express';
import { z } from 'zod';
import { officerOf } from '../common/auth.js';
import { getPool, withTransaction, type Db } from '../common/db.js';
import { conflict, notFound } from '../common/errors.js';
import { createNotification } from '../common/notifications.js';

// ── 기준값 ──
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const ITEM_NAME_MAX_LENGTH = 50;
const MAX_STOCK = 100_000;
const REJECT_REASON_MAX_LENGTH = 500;

const RENTAL_STATUSES = ['requested', 'approved', 'rejected', 'received'] as const;
type RentalStatus = (typeof RENTAL_STATUSES)[number];

const idParam = z.object({ id: z.coerce.number().int().positive() });

// ════════════════════════════════════════
// 물품·재고 (/admin/rental-items)
// ════════════════════════════════════════

const itemName = z.string().trim().min(1).max(ITEM_NAME_MAX_LENGTH);
const stock = z.number().int().min(0).max(MAX_STOCK);
const createItemBody = z.object({ name: itemName, stock: stock.default(0) });
const updateItemBody = z
  .object({ name: itemName.optional(), stock: stock.optional() })
  .refine((b) => b.name !== undefined || b.stock !== undefined, '바꿀 값(name 또는 stock)이 없다.');

type ItemView = {
  id: number;
  name: string;
  stock: number; // 아직 배정하지 않은 재고
  requestedQuantity: number; // 승인 대기 중인 신청 수량 합계
  awaitingPickupQuantity: number; // 승인했지만 아직 수령하지 않은 수량 합계
  createdAt: string;
};

const SELECT_ITEM = `
  SELECT i.id, i.name, i.stock, i.created_at,
         coalesce(sum(r.quantity) FILTER (WHERE r.status = 'requested'), 0) AS requested_quantity,
         coalesce(sum(r.quantity) FILTER (WHERE r.status = 'approved'), 0) AS awaiting_quantity
  FROM rental_items i
  LEFT JOIN rentals r ON r.item_id = i.id
  WHERE i.agency = $1`;

function toItemView(r: {
  id: number;
  name: string;
  stock: number;
  created_at: Date;
  requested_quantity: number;
  awaiting_quantity: number;
}): ItemView {
  return {
    id: r.id,
    name: r.name,
    stock: r.stock,
    requestedQuantity: r.requested_quantity,
    awaitingPickupQuantity: r.awaiting_quantity,
    createdAt: r.created_at.toISOString(),
  };
}

async function findItem(db: Db, agency: string, id: number): Promise<ItemView | undefined> {
  const { rows } = await db.query(`${SELECT_ITEM} AND i.id = $2 GROUP BY i.id`, [agency, id]);
  return rows[0] && toItemView(rows[0]);
}

export const rentalItemsRouter = Router();

rentalItemsRouter.get('/', async (req, res) => {
  const { agency } = officerOf(req);
  const { rows } = await getPool().query(`${SELECT_ITEM} GROUP BY i.id ORDER BY i.name, i.id`, [agency]);
  res.json({ items: rows.map(toItemView) });
});

// 물품 등록. 같은 관리청에 같은 이름이 있으면 409(rental_items_agency_name_key)
rentalItemsRouter.post('/', async (req, res) => {
  const { agency } = officerOf(req);
  const body = createItemBody.parse(req.body);
  const pool = getPool();
  const { rows } = await pool.query<{ id: number }>(
    'INSERT INTO rental_items (agency, name, stock) VALUES ($1, $2, $3) RETURNING id',
    [agency, body.name, body.stock],
  );
  res.status(201).json(await findItem(pool, agency, rows[0]!.id));
});

// 이름·재고 수정. stock은 "지금 남은 재고"를 새 값으로 바꾼다(입고하면 늘리고, 실사 후 맞춘다)
rentalItemsRouter.patch('/:id', async (req, res) => {
  const { agency } = officerOf(req);
  const { id } = idParam.parse(req.params);
  const body = updateItemBody.parse(req.body);
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE rental_items SET name = coalesce($3, name), stock = coalesce($4, stock)
     WHERE id = $1 AND agency = $2`,
    [id, agency, body.name ?? null, body.stock ?? null],
  );
  if (!rowCount) throw notFound('물품을 찾을 수 없다.');
  res.json(await findItem(pool, agency, id));
});

// ════════════════════════════════════════
// 물품 신청 처리 (/admin/rentals)
// ════════════════════════════════════════

const listQuery = z.object({
  status: z.enum(RENTAL_STATUSES).default('requested'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

// 승인 / 반려(사유 선택) / 수령
const handleBody = z.discriminatedUnion('status', [
  z.object({ status: z.literal('approved') }),
  z.object({ status: z.literal('rejected'), rejectReason: z.string().trim().min(1).max(REJECT_REASON_MAX_LENGTH).optional() }),
  z.object({ status: z.literal('received') }),
]);

// 바꿀 수 있는 상태: requested → approved | rejected, approved → received
const ALLOWED_FROM: Record<'approved' | 'rejected' | 'received', RentalStatus> = {
  approved: 'requested',
  rejected: 'requested',
  received: 'approved',
};

type RentalView = {
  id: number;
  status: RentalStatus;
  quantity: number;
  rejectReason: string | null;
  createdAt: string;
  handledAt: string | null;
  handledBy: number | null;
  receivedAt: string | null;
  item: { id: number; name: string; stock: number };
  requester: { id: number; nickname: string; realName: string | null };
};

const SELECT_RENTAL = `
  SELECT r.id, r.status, r.quantity, r.reject_reason, r.created_at, r.handled_at, r.handled_by, r.received_at,
         i.id AS item_id, i.name AS item_name, i.stock,
         u.id AS user_id, u.nickname, u.real_name
  FROM rentals r
  JOIN rental_items i ON i.id = r.item_id
  JOIN users u ON u.id = r.user_id
  WHERE i.agency = $1`;

function toRentalView(r: any): RentalView {
  return {
    id: r.id,
    status: r.status,
    quantity: r.quantity,
    rejectReason: r.reject_reason,
    createdAt: r.created_at.toISOString(),
    handledAt: r.handled_at?.toISOString() ?? null,
    handledBy: r.handled_by,
    receivedAt: r.received_at?.toISOString() ?? null,
    item: { id: r.item_id, name: r.item_name, stock: r.stock },
    requester: { id: r.user_id, nickname: r.nickname, realName: r.real_name },
  };
}

async function findRental(db: Db, agency: string, id: number): Promise<RentalView | undefined> {
  const { rows } = await db.query(`${SELECT_RENTAL} AND r.id = $2`, [agency, id]);
  return rows[0] && toRentalView(rows[0]);
}

function resultNotification(rental: RentalView) {
  const what = `${rental.item.name} ${rental.quantity}개`;
  if (rental.status === 'approved') {
    return { title: '물품 신청이 승인되었어요', body: `${what} 신청이 승인되었어요. 구청 안내에 따라 받아 가세요.` };
  }
  return {
    title: '물품 신청이 반려되었어요',
    body: `${what} 신청이 반려되었어요.${rental.rejectReason ? ` 사유: ${rental.rejectReason}` : ''}`,
  };
}

export const rentalsRouter = Router();

// 목록: 승인 대기(requested)는 오래 기다린 순, 나머지는 최근 순
rentalsRouter.get('/', async (req, res) => {
  const { agency } = officerOf(req);
  const { status, limit, offset } = listQuery.parse(req.query);
  const order = status === 'requested' ? 'r.created_at ASC, r.id ASC' : 'r.created_at DESC, r.id DESC';
  const pool = getPool();
  const [{ rows }, total] = await Promise.all([
    pool.query(`${SELECT_RENTAL} AND r.status = $2 ORDER BY ${order} LIMIT $3 OFFSET $4`, [agency, status, limit, offset]),
    pool.query<{ count: number }>(
      `SELECT count(*) FROM rentals r JOIN rental_items i ON i.id = r.item_id WHERE i.agency = $1 AND r.status = $2`,
      [agency, status],
    ),
  ]);
  res.json({ items: rows.map(toRentalView), total: total.rows[0]!.count, limit, offset });
});

// 처리: 상태 변경 + 재고 차감(승인) + 결과 알림(승인·반려)을 한 트랜잭션으로
rentalsRouter.patch('/:id', async (req, res) => {
  const officer = officerOf(req);
  const { id } = idParam.parse(req.params);
  const body = handleBody.parse(req.body);

  const rental = await withTransaction(async (db) => {
    // 신청 행과 물품 행을 함께 잠근다. 같은 물품을 동시에 승인해도 재고가 음수로 가지 않는다.
    const { rows } = await db.query<{ status: RentalStatus; quantity: number; item_id: number; stock: number }>(
      `SELECT r.status, r.quantity, r.item_id, i.stock
       FROM rentals r JOIN rental_items i ON i.id = r.item_id
       WHERE r.id = $1 AND i.agency = $2
       FOR UPDATE OF r, i`,
      [id, officer.agency],
    );
    const current = rows[0];
    if (!current) throw notFound('물품 신청을 찾을 수 없다.');
    if (current.status !== ALLOWED_FROM[body.status]) {
      throw conflict(`지금 상태(${current.status})에서는 ${body.status}로 바꿀 수 없다.`);
    }

    if (body.status === 'approved') {
      if (current.stock < current.quantity) {
        throw conflict(`재고가 부족하다(남은 재고 ${current.stock}개, 신청 ${current.quantity}개).`);
      }
      await db.query('UPDATE rental_items SET stock = stock - $2 WHERE id = $1', [current.item_id, current.quantity]);
    }

    if (body.status === 'received') {
      await db.query(`UPDATE rentals SET status = 'received', received_at = now() WHERE id = $1`, [id]);
    } else {
      await db.query(
        `UPDATE rentals SET status = $2, reject_reason = $3, handled_by = $4, handled_at = now() WHERE id = $1`,
        [id, body.status, body.status === 'rejected' ? (body.rejectReason ?? null) : null, officer.id],
      );
    }

    const updated = (await findRental(db, officer.agency, id))!;
    if (body.status !== 'received') {
      await createNotification(db, { userId: updated.requester.id, type: 'rental_result', ...resultNotification(updated) });
    }
    return updated;
  });

  res.json(rental);
});
