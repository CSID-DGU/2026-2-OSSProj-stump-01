// #69 월간 보고서 검토·봉사시간 기록 (구청)
// 보고서 작성·제출은 시민-BE, 검토(승인·보완 요청)와 봉사시간 기록은 구청-BE가 한다(CLAUDE.md 경계 규칙).
// 승인은 보고서 상태 변경 + 봉사시간 행 생성 + 알림을 한 트랜잭션으로 묶는다.
// 같은 보고서가 두 번 인정되는 것은 volunteer_hours.monthly_report_id 유일 제약이 DB에서 한 번 더 막는다.
import { Router } from 'express';
import { z } from 'zod';
import { officerOf } from '../common/auth.js';
import { getPool, withTransaction, type Db } from '../common/db.js';
import { conflict, notFound } from '../common/errors.js';
import { createNotification } from '../common/notifications.js';

// ── 기준값 ──
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const REVIEW_NOTE_MAX_LENGTH = 1000;

const REPORT_STATUSES = ['submitted', 'approved', 'revision_requested'] as const;
type ReportStatus = (typeof REPORT_STATUSES)[number];

// ── 요청 형식 ──
const listQuery = z.object({
  status: z.enum(REPORT_STATUSES).default('submitted'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

// 승인: { "status": "approved", "reviewNote"?: "..." } / 보완 요청: { "status": "revision_requested", "reviewNote": "..." }
const note = z.string().trim().min(1).max(REVIEW_NOTE_MAX_LENGTH);
const reviewBody = z.discriminatedUnion('status', [
  z.object({ status: z.literal('approved'), reviewNote: note.optional() }),
  z.object({ status: z.literal('revision_requested'), reviewNote: note }),
]);

// ── 응답 형식 ──
type ReportSummary = {
  id: number;
  status: ReportStatus;
  agency: string;
  totalMinutes: number;
  reviewNote: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: number | null;
  caregiver: { id: number; nickname: string; realName: string | null };
  recordCount: number;
  treeCount: number;
  firstDate: string | null; // 묶인 기록의 첫 활동일
  lastDate: string | null; // 묶인 기록의 마지막 활동일
  volunteerMinutes: number | null; // 승인되어 기록된 봉사시간(분)
};

type ReportRecord = {
  id: number;
  activityDate: string;
  activityKind: string | null;
  durationMin: number;
  memo: string | null;
  photoUrl: string | null;
  verification: string;
  tree: { id: number; species: string; roadName: string | null; address: string | null };
};

// $1 = 담당자 관리청
const SELECT_REPORT = `
  SELECT m.id, m.status, m.agency, m.total_minutes, m.review_note, m.submitted_at, m.reviewed_at, m.reviewed_by,
         u.id AS user_id, u.nickname, u.real_name,
         s.record_count, s.tree_count, s.first_date, s.last_date,
         v.minutes AS volunteer_minutes
  FROM monthly_reports m
  JOIN users u ON u.id = m.user_id
  LEFT JOIN volunteer_hours v ON v.monthly_report_id = m.id
  CROSS JOIN LATERAL (
    SELECT count(*) AS record_count, count(DISTINCT r.tree_id) AS tree_count,
           min(r.activity_date) AS first_date, max(r.activity_date) AS last_date
    FROM records r WHERE r.monthly_report_id = m.id
  ) s
  WHERE m.agency = $1`;

type ReportRow = {
  id: number;
  status: ReportStatus;
  agency: string;
  total_minutes: number;
  review_note: string | null;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewed_by: number | null;
  user_id: number;
  nickname: string;
  real_name: string | null;
  record_count: number;
  tree_count: number;
  first_date: string | null;
  last_date: string | null;
  volunteer_minutes: number | null;
};

function toSummary(r: ReportRow): ReportSummary {
  return {
    id: r.id,
    status: r.status,
    agency: r.agency,
    totalMinutes: r.total_minutes,
    reviewNote: r.review_note,
    submittedAt: r.submitted_at.toISOString(),
    reviewedAt: r.reviewed_at?.toISOString() ?? null,
    reviewedBy: r.reviewed_by,
    caregiver: { id: r.user_id, nickname: r.nickname, realName: r.real_name },
    recordCount: r.record_count,
    treeCount: r.tree_count,
    firstDate: r.first_date,
    lastDate: r.last_date,
    volunteerMinutes: r.volunteer_minutes,
  };
}

async function findReport(db: Db, agency: string, id: number): Promise<ReportSummary | undefined> {
  const { rows } = await db.query<ReportRow>(`${SELECT_REPORT} AND m.id = $2`, [agency, id]);
  return rows[0] && toSummary(rows[0]);
}

async function findRecords(db: Db, reportId: number): Promise<ReportRecord[]> {
  const { rows } = await db.query(
    `SELECT r.id, r.activity_date, r.activity_kind, r.duration_min, r.memo, r.photo_url, r.verification,
            t.id AS tree_id, t.species, t.road_name, t.address
     FROM records r JOIN trees t ON t.id = r.tree_id
     WHERE r.monthly_report_id = $1
     ORDER BY r.activity_date, r.recorded_at, r.id`,
    [reportId],
  );
  return rows.map((r) => ({
    id: r.id,
    activityDate: r.activity_date,
    activityKind: r.activity_kind,
    durationMin: r.duration_min,
    memo: r.memo,
    photoUrl: r.photo_url,
    verification: r.verification,
    tree: { id: r.tree_id, species: r.species, roadName: r.road_name, address: r.address },
  }));
}

/** 분을 "3시간 20분" 형식으로 바꾼다. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

function resultNotification(report: ReportSummary) {
  const period = report.firstDate === report.lastDate ? report.firstDate : `${report.firstDate} ~ ${report.lastDate}`;
  if (report.status === 'approved') {
    return {
      title: '월간 보고서가 승인되었어요',
      body: `${period} 활동 ${formatMinutes(report.totalMinutes)}이 봉사시간으로 기록되었어요.`,
    };
  }
  return {
    title: '월간 보고서 보완 요청이 왔어요',
    body: `${period} 보고서를 보완해 주세요. 구청 의견: ${report.reviewNote}`,
  };
}

// ── 라우터 (/admin/monthly-reports) ──
export const monthlyReportsRouter = Router();

// 목록: 검토 대기(submitted)는 오래 기다린 순, 나머지는 최근 순
monthlyReportsRouter.get('/', async (req, res) => {
  const { agency } = officerOf(req);
  const { status, limit, offset } = listQuery.parse(req.query);
  const order = status === 'submitted' ? 'm.submitted_at ASC, m.id ASC' : 'm.submitted_at DESC, m.id DESC';

  const pool = getPool();
  const [{ rows }, total] = await Promise.all([
    pool.query<ReportRow>(`${SELECT_REPORT} AND m.status = $2 ORDER BY ${order} LIMIT $3 OFFSET $4`, [
      agency,
      status,
      limit,
      offset,
    ]),
    pool.query<{ count: number }>('SELECT count(*) FROM monthly_reports WHERE agency = $1 AND status = $2', [
      agency,
      status,
    ]),
  ]);
  res.json({ items: rows.map(toSummary), total: total.rows[0]!.count, limit, offset });
});

// 상세: 보고서 요약 + 묶인 활동 기록(날짜순)
monthlyReportsRouter.get('/:id', async (req, res) => {
  const { agency } = officerOf(req);
  const { id } = idParam.parse(req.params);
  const pool = getPool();
  const report = await findReport(pool, agency, id);
  if (!report) throw notFound('보고서를 찾을 수 없다.');
  res.json({ ...report, records: await findRecords(pool, id) });
});

// 검토: 검토 대기(submitted) 보고서만 승인·보완 요청한다.
monthlyReportsRouter.patch('/:id', async (req, res) => {
  const officer = officerOf(req);
  const { id } = idParam.parse(req.params);
  const body = reviewBody.parse(req.body);

  const report = await withTransaction(async (db) => {
    // 같은 보고서를 두 담당자가 동시에 승인하지 않도록 행을 잠근다
    const { rows } = await db.query<{ status: ReportStatus; user_id: number; total_minutes: number }>(
      `SELECT status, user_id, total_minutes FROM monthly_reports
       WHERE id = $1 AND agency = $2
       FOR UPDATE`,
      [id, officer.agency],
    );
    const current = rows[0];
    if (!current) throw notFound('보고서를 찾을 수 없다.');
    if (current.status !== 'submitted') throw conflict(`검토 대기 중인 보고서가 아니다(현재 상태: ${current.status}).`);
    if (body.status === 'approved' && current.total_minutes <= 0) {
      throw conflict('활동 시간이 0분인 보고서는 승인할 수 없다. 보완 요청을 한다.');
    }

    await db.query(
      `UPDATE monthly_reports
       SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now()
       WHERE id = $1`,
      [id, body.status, body.reviewNote ?? null, officer.id],
    );

    // 승인이면 봉사시간을 기록한다. 시간은 보고서의 활동 시간 합계를 그대로 쓴다.
    if (body.status === 'approved') {
      await db.query(
        `INSERT INTO volunteer_hours (user_id, monthly_report_id, minutes, recorded_by)
         VALUES ($1, $2, $3, $4)`,
        [current.user_id, id, current.total_minutes, officer.id],
      );
    }

    const updated = (await findReport(db, officer.agency, id))!;
    await createNotification(db, {
      userId: updated.caregiver.id,
      type: 'monthly_report_result',
      ...resultNotification(updated),
    });
    return updated;
  });

  res.json({ ...report, records: await findRecords(getPool(), id) });
});
