// #63 물품 지급 신청 (시민)
// 신청은 시민-BE, 승인·반려·수령 처리와 재고는 구청-BE(district/rentals.ts)가 한다(CLAUDE.md 경계 규칙).
// 활동 물품(쿨토시·모자 등)은 다시 쓰기 어려워 반납·기한이 없다. 재고는 구청이 승인할 때 줄인다(신청만으로는 안 줄어든다).
// 물품은 관리청마다 따로 있다. 시민은 지금 승인된 돌보미로 있는 나무의 관리청 물품만 보고 신청한다.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool, withTransaction } from '../common/db.js';
import { conflict, HttpError, notFound } from '../common/errors.js';

// ── 기준값 (임시값) ──
const MAX_QUANTITY = 5; // 한 번에 신청하는 수량
const TIME_ZONE = 'Asia/Seoul'; // 활동 기간은 한국 날짜 기준

// 지금(오늘) 승인된 돌보미로 있는 나무의 관리청들. $1 = 시민, $2 = 오늘
const MY_AGENCIES = `
  SELECT DISTINCT t.agency FROM caregiver_applications a JOIN trees t ON t.id = a.tree_id
  WHERE a.user_id = $1 AND a.status = 'approved' AND $2::date BETWEEN a.period_start AND a.period_end`;

const seoulToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });

// ── 요청 형식 ──
const rentalBody = z.object({
  itemId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).default(1),
});

// ── 응답 형식 ──
type RentalStatus = 'requested' | 'approved' | 'rejected' | 'received'; // 신청 / 승인 / 반려 / 수령

export type MyRentalView = {
  id: number;
  status: RentalStatus;
  quantity: number;
  item: { id: number; name: string; agency: string };
  rejectReason: string | null;
  createdAt: string;
  handledAt: string | null; // 구청이 승인·반려한 시각
  receivedAt: string | null;
};

const SELECT_MY_RENTAL = `
  SELECT r.id, r.status, r.quantity, r.reject_reason, r.created_at, r.handled_at, r.received_at,
         i.id AS item_id, i.name, i.agency
  FROM rentals r JOIN rental_items i ON i.id = r.item_id
  WHERE r.user_id = $1`;

type MyRentalRow = {
  id: number;
  status: RentalStatus;
  quantity: number;
  reject_reason: string | null;
  created_at: Date;
  handled_at: Date | null;
  received_at: Date | null;
  item_id: number;
  name: string;
  agency: string;
};

function toView(r: MyRentalRow): MyRentalView {
  return {
    id: r.id,
    status: r.status,
    quantity: r.quantity,
    item: { id: r.item_id, name: r.name, agency: r.agency },
    rejectReason: r.reject_reason,
    createdAt: r.created_at.toISOString(),
    handledAt: r.handled_at?.toISOString() ?? null,
    receivedAt: r.received_at?.toISOString() ?? null,
  };
}

// ── 물품 목록 (/rental-items) ──
export const citizenRentalItemsRouter = Router();
citizenRentalItemsRouter.use(authenticate);

// 내가 돌보는 나무의 관리청 물품과 남은 재고. 돌보미가 아니면 빈 목록
citizenRentalItemsRouter.get('/', async (req, res) => {
  const { rows } = await getPool().query<{ id: number; agency: string; name: string; stock: number }>(
    `SELECT i.id, i.agency, i.name, i.stock FROM rental_items i
     WHERE i.agency IN (${MY_AGENCIES})
     ORDER BY i.agency, i.name, i.id`,
    [req.user!.id, seoulToday()],
  );
  res.json({ items: rows });
});

// ── 물품 신청 (/rentals) ──
export const citizenRentalsRouter = Router();
citizenRentalsRouter.use(authenticate);

// 신청: '신청'(requested) 상태로 만든다. 물품 행을 잠가 같은 물품의 동시 신청을 차례로 처리한다
citizenRentalsRouter.post('/', async (req, res) => {
  const { id: userId, role } = req.user!;
  if (role !== 'citizen') throw new HttpError(403, 'FORBIDDEN', '시민 계정만 물품을 신청할 수 있다.');
  const body = rentalBody.parse(req.body);

  const rentalId = await withTransaction(async (db) => {
    const { rows: items } = await db.query<{ agency: string; stock: number }>(
      'SELECT agency, stock FROM rental_items WHERE id = $1 FOR UPDATE',
      [body.itemId],
    );
    const item = items[0];
    if (!item) throw notFound('물품을 찾을 수 없다.');

    const { rowCount } = await db.query(`SELECT 1 FROM (${MY_AGENCIES}) x WHERE x.agency = $3`, [userId, seoulToday(), item.agency]);
    if (!rowCount) throw new HttpError(403, 'FORBIDDEN', '이 관리청 나무의 승인된 돌보미만 신청할 수 있다.');

    if (body.quantity > item.stock) throw conflict(`남은 재고(${item.stock}개)보다 많이 신청할 수 없다.`);

    const { rowCount: open } = await db.query(
      `SELECT 1 FROM rentals WHERE user_id = $1 AND item_id = $2 AND status IN ('requested', 'approved')`,
      [userId, body.itemId],
    );
    if (open) throw conflict('이 물품은 이미 신청해 처리 중이다. 받은 뒤에 다시 신청할 수 있다.');

    const { rows } = await db.query<{ id: number }>(
      'INSERT INTO rentals (item_id, user_id, quantity) VALUES ($1, $2, $3) RETURNING id',
      [body.itemId, userId, body.quantity],
    );
    return rows[0]!.id;
  });

  const { rows } = await getPool().query<MyRentalRow>(`${SELECT_MY_RENTAL} AND r.id = $2`, [userId, rentalId]);
  res.status(201).json(toView(rows[0]!));
});

// 내 신청 현황: 최신순
citizenRentalsRouter.get('/me', async (req, res) => {
  const { rows } = await getPool().query<MyRentalRow>(`${SELECT_MY_RENTAL} ORDER BY r.created_at DESC, r.id DESC`, [req.user!.id]);
  res.json({ rentals: rows.map(toView) });
});
