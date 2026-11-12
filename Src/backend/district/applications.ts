// #68 돌보미 신청 심사 (구청)
// 신청서 제출은 시민-BE(#6), 심사(승인·반려, 반려 사유)는 구청-BE가 한다(CLAUDE.md 경계 규칙).
// 담당자는 자기 관리청(trees.agency)에 있는 나무의 신청서만 보고 심사한다. 다른 관리청 신청서는 404로 돌려준다.
import { Router } from 'express';
import { z } from 'zod';
import { officerOf } from '../common/auth.js';
import { getPool, withTransaction, type Db } from '../common/db.js';
import { conflict, notFound } from '../common/errors.js';
import { createNotification } from '../common/notifications.js';

// ── 기준값 ──
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const REJECT_REASON_MAX_LENGTH = 500;

const APPLICATION_STATUSES = ['pending', 'approved', 'rejected', 'ended'] as const;
type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

// ── 요청 형식 ──
const listQuery = z.object({
  status: z.enum(APPLICATION_STATUSES).default('pending'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

// 승인: { "status": "approved" } / 반려: { "status": "rejected", "rejectReason": "..." }
const reviewBody = z.discriminatedUnion('status', [
  z.object({ status: z.literal('approved') }),
  z.object({ status: z.literal('rejected'), rejectReason: z.string().trim().min(1).max(REJECT_REASON_MAX_LENGTH) }),
]);

// ── 응답 형식 ──
export type ApplicationView = {
  id: number;
  status: ApplicationStatus;
  periodStart: string;
  periodEnd: string;
  motivation: string | null;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: number | null;
  applicant: { id: number; nickname: string; realName: string | null };
  tree: {
    id: number;
    species: string;
    district: string;
    dong: string | null;
    roadName: string | null;
    address: string | null;
    caregiverCount: number; // 지금 승인된 돌보미 수
  };
};

// 목록·상세가 같은 모양을 쓰도록 SELECT를 하나로 둔다. $1 = 담당자 관리청
const SELECT_APPLICATION = `
  SELECT a.id, a.status, a.period_start, a.period_end, a.motivation, a.reject_reason,
         a.created_at, a.reviewed_at, a.reviewed_by,
         u.id AS user_id, u.nickname, u.real_name,
         t.id AS tree_id, t.species, t.district, t.dong, t.road_name, t.address,
         (SELECT count(*) FROM caregiver_applications c
           WHERE c.tree_id = t.id AND c.status = 'approved') AS caregiver_count
  FROM caregiver_applications a
  JOIN users u ON u.id = a.user_id
  JOIN trees t ON t.id = a.tree_id
  WHERE t.agency = $1`;

type ApplicationRow = {
  id: number;
  status: ApplicationStatus;
  period_start: string;
  period_end: string;
  motivation: string | null;
  reject_reason: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  reviewed_by: number | null;
  user_id: number;
  nickname: string;
  real_name: string | null;
  tree_id: number;
  species: string;
  district: string;
  dong: string | null;
  road_name: string | null;
  address: string | null;
  caregiver_count: number;
};

function toView(r: ApplicationRow): ApplicationView {
  return {
    id: r.id,
    status: r.status,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    motivation: r.motivation,
    rejectReason: r.reject_reason,
    createdAt: r.created_at.toISOString(),
    reviewedAt: r.reviewed_at?.toISOString() ?? null,
    reviewedBy: r.reviewed_by,
    applicant: { id: r.user_id, nickname: r.nickname, realName: r.real_name },
    tree: {
      id: r.tree_id,
      species: r.species,
      district: r.district,
      dong: r.dong,
      roadName: r.road_name,
      address: r.address,
      caregiverCount: r.caregiver_count,
    },
  };
}

async function findApplication(db: Db, agency: string, id: number): Promise<ApplicationView | undefined> {
  const { rows } = await db.query<ApplicationRow>(`${SELECT_APPLICATION} AND a.id = $2`, [agency, id]);
  return rows[0] && toView(rows[0]);
}

/** 신청 결과 알림 문구. 나무는 수종과 노선(없으면 주소)으로 부른다. */
function resultNotification(app: ApplicationView) {
  const where = app.tree.roadName ?? app.tree.address ?? app.tree.district;
  const tree = `${where} ${app.tree.species}`;
  if (app.status === 'approved') {
    return {
      title: '돌보미 신청이 승인되었어요',
      body: `${tree} 돌보미로 승인되었어요. 활동 기간: ${app.periodStart} ~ ${app.periodEnd}`,
    };
  }
  return {
    title: '돌보미 신청이 반려되었어요',
    body: `${tree} 돌보미 신청이 반려되었어요. 사유: ${app.rejectReason}`,
  };
}

// ── 라우터 (/admin/applications) ──
export const applicationsRouter = Router();

// 목록: 대기(pending)는 오래 기다린 순, 나머지는 최근 순
applicationsRouter.get('/', async (req, res) => {
  const { agency } = officerOf(req);
  const { status, limit, offset } = listQuery.parse(req.query);
  const order = status === 'pending' ? 'a.created_at ASC, a.id ASC' : 'a.created_at DESC, a.id DESC';

  const pool = getPool();
  const [{ rows }, total] = await Promise.all([
    pool.query<ApplicationRow>(`${SELECT_APPLICATION} AND a.status = $2 ORDER BY ${order} LIMIT $3 OFFSET $4`, [
      agency,
      status,
      limit,
      offset,
    ]),
    pool.query<{ count: number }>(
      `SELECT count(*) FROM caregiver_applications a JOIN trees t ON t.id = a.tree_id
       WHERE t.agency = $1 AND a.status = $2`,
      [agency, status],
    ),
  ]);
  res.json({ items: rows.map(toView), total: total.rows[0]!.count, limit, offset });
});

// 상세
applicationsRouter.get('/:id', async (req, res) => {
  const { agency } = officerOf(req);
  const { id } = idParam.parse(req.params);
  const app = await findApplication(getPool(), agency, id);
  if (!app) throw notFound('신청서를 찾을 수 없다.');
  res.json(app);
});

// 심사: 대기 중인 신청서만 승인·반려한다. 상태 변경과 결과 알림을 한 트랜잭션으로 묶는다.
applicationsRouter.patch('/:id', async (req, res) => {
  const officer = officerOf(req);
  const { id } = idParam.parse(req.params);
  const body = reviewBody.parse(req.body);

  const updated = await withTransaction(async (db) => {
    // 같은 신청서를 두 담당자가 동시에 심사하지 않도록 행을 잠근다
    const { rows } = await db.query<{ status: ApplicationStatus }>(
      `SELECT a.status FROM caregiver_applications a JOIN trees t ON t.id = a.tree_id
       WHERE a.id = $1 AND t.agency = $2
       FOR UPDATE OF a`,
      [id, officer.agency],
    );
    const current = rows[0];
    if (!current) throw notFound('신청서를 찾을 수 없다.');
    if (current.status !== 'pending') throw conflict(`이미 심사한 신청서다(현재 상태: ${current.status}).`);

    await db.query(
      `UPDATE caregiver_applications
       SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now()
       WHERE id = $1`,
      [id, body.status, body.status === 'rejected' ? body.rejectReason : null, officer.id],
    );

    const app = (await findApplication(db, officer.agency, id))!;
    await createNotification(db, {
      userId: app.applicant.id,
      type: 'application_result',
      treeId: app.tree.id,
      ...resultNotification(app),
    });
    return app;
  });

  res.json(updated);
});
