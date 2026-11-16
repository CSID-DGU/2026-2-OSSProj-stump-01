// #6 돌보미 신청서 제출 (시민)
// 제출은 시민-BE, 심사(승인·반려, 반려 사유)는 구청-BE(district/applications.ts)가 한다(CLAUDE.md 경계 규칙).
// 신청서 한 행은 나무 한 그루다. 여러 그루를 한 번에 내면 그루마다 신청서가 생기고, 구청은 그루마다 따로 심사한다.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool } from '../common/db.js';
import { HttpError } from '../common/errors.js';

// ── 기준값 (구청 신청서 양식 확인 전 임시값, #59) ──
const MAX_TREES_PER_APPLICATION = 10; // 한 번에 신청할 수 있는 나무 수
const MAX_PERIOD_YEARS = 1; // 활동 기간 최대 길이
const MOTIVATION_MAX_LENGTH = 500;
const TIME_ZONE = 'Asia/Seoul'; // "오늘"은 한국 시간 달력 기준

/** 오늘 날짜(한국 시간) 'YYYY-MM-DD' */
function seoulToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });
}

/** 'YYYY-MM-DD' 날짜에 years년을 더한다. */
function addYears(date: string, years: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

// ── 요청 형식 ──
// 날짜는 'YYYY-MM-DD' 문자열이라 문자열 크기 비교가 곧 날짜 비교다.
// 끝나는 날이 시작일보다 앞이면 DB 제약(caregiver_applications_period)이 400으로 막는다.
const applicationBody = z
  .object({
    treeIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(MAX_TREES_PER_APPLICATION)
      .refine((ids) => new Set(ids).size === ids.length, '같은 나무를 두 번 넣을 수 없다.'),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    motivation: z.string().trim().min(1).max(MOTIVATION_MAX_LENGTH),
  })
  .refine((b) => b.periodStart >= seoulToday(), {
    path: ['periodStart'],
    message: '시작일은 오늘이거나 그 뒤여야 한다.',
  })
  .refine((b) => b.periodEnd < addYears(b.periodStart, MAX_PERIOD_YEARS), {
    path: ['periodEnd'],
    message: `활동 기간은 ${MAX_PERIOD_YEARS}년을 넘을 수 없다.`,
  });

// ── 응답 형식 ──
type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'ended';

export type MyApplicationView = {
  id: number;
  status: ApplicationStatus;
  periodStart: string;
  periodEnd: string;
  motivation: string | null;
  rejectReason: string | null; // 반려됐을 때 구청이 남긴 사유
  createdAt: string;
  reviewedAt: string | null;
  tree: {
    id: number;
    code: string | null;
    species: string;
    district: string;
    dong: string | null;
    roadName: string | null;
    address: string | null;
  };
};

// 제출 응답과 내 신청서 목록이 같은 모양을 쓰도록 SELECT를 하나로 둔다. $1 = 신청한 시민
const SELECT_MY_APPLICATION = `
  SELECT a.id, a.status, a.period_start, a.period_end, a.motivation, a.reject_reason, a.created_at, a.reviewed_at,
         t.id AS tree_id, t.code, t.species, t.district, t.dong, t.road_name, t.address
  FROM caregiver_applications a
  JOIN trees t ON t.id = a.tree_id
  WHERE a.user_id = $1`;

type MyApplicationRow = {
  id: number;
  status: ApplicationStatus;
  period_start: string;
  period_end: string;
  motivation: string | null;
  reject_reason: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  tree_id: number;
  code: string | null;
  species: string;
  district: string;
  dong: string | null;
  road_name: string | null;
  address: string | null;
};

function toView(r: MyApplicationRow): MyApplicationView {
  return {
    id: r.id,
    status: r.status,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    motivation: r.motivation,
    rejectReason: r.reject_reason,
    createdAt: r.created_at.toISOString(),
    reviewedAt: r.reviewed_at?.toISOString() ?? null,
    tree: {
      id: r.tree_id,
      code: r.code,
      species: r.species,
      district: r.district,
      dong: r.dong,
      roadName: r.road_name,
      address: r.address,
    },
  };
}

// ── 라우터 (/applications) ──
export const applicationsRouter = Router();
applicationsRouter.use(authenticate);

// 신청서 제출: 고른 나무마다 대기(pending) 신청서를 만든다.
// INSERT 한 문장으로 넣으므로 한 그루라도 막히면 아무것도 저장되지 않는다.
//  - 이미 대기·승인 중인 나무가 섞임: 유일 인덱스 caregiver_applications_one_open → 409
//  - 없는 나무가 섞임: 외래 키 → 400
applicationsRouter.post('/', async (req, res) => {
  const { id: userId, role } = req.user!;
  if (role !== 'citizen') throw new HttpError(403, 'FORBIDDEN', '시민 계정만 돌보미를 신청할 수 있다.');
  const body = applicationBody.parse(req.body);

  const pool = getPool();
  // unnest: 나무 id 배열을 행으로 펼쳐 그루마다 한 행씩 넣는다
  const { rows: inserted } = await pool.query<{ id: number }>(
    `INSERT INTO caregiver_applications (user_id, tree_id, period_start, period_end, motivation)
     SELECT $1, tree_id, $3, $4, $5 FROM unnest($2::bigint[]) AS tree_id
     RETURNING id`,
    [userId, body.treeIds, body.periodStart, body.periodEnd, body.motivation],
  );
  const { rows } = await pool.query<MyApplicationRow>(`${SELECT_MY_APPLICATION} AND a.id = ANY($2::bigint[]) ORDER BY a.id`, [
    userId,
    inserted.map((r) => r.id),
  ]);
  res.status(201).json({ applications: rows.map(toView) });
});

// 내 신청서: 최신순. 반려됐으면 사유가 함께 온다
applicationsRouter.get('/me', async (req, res) => {
  const { rows } = await getPool().query<MyApplicationRow>(
    `${SELECT_MY_APPLICATION} ORDER BY a.created_at DESC, a.id DESC`,
    [req.user!.id],
  );
  res.json({ applications: rows.map(toView) });
});
