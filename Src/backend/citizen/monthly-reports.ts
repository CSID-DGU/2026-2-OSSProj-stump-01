// #62 월간 보고서 자동 작성·제출 (시민)
// 작성·제출은 시민-BE, 검토(승인·보완 요청)와 봉사시간 기록은 구청-BE(district/monthly-reports.ts)가 한다(CLAUDE.md 경계 규칙).
// 흐름: 달력에서 날짜 고르기(/dates) → 미리보기(/draft) → 제출(POST). 제출하면 고른 날짜의 활동 기록에 보고서 번호를 채워
// 다시 고를 수 없게 한다. 보고서 하나는 관리청 하나에만 낸다(monthly_reports.agency).
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool, withTransaction, type Db } from '../common/db.js';
import { badRequest, HttpError } from '../common/errors.js';
import { treeNameSql } from '../common/tree-name.js';
import { buildDraft, type DraftSource } from './monthly-report-draft.js';

// ── 기준값 ──
const MAX_DATES = 31; // 한 보고서에 고를 수 있는 날짜 수 (한 달)
const KIND_SEPARATOR = ', '; // records.activity_kind 에 '한 일'을 이어 저장한 구분자 (citizen/records.ts 와 같다)

// ── 요청 형식 ──
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식');
const dateList = z
  .array(z.iso.date())
  .min(1)
  .max(MAX_DATES)
  .refine((ds) => new Set(ds.map((d) => d.slice(0, 7))).size === 1, '한 보고서에는 같은 달의 날짜만 고를 수 있다.');

const datesQuery = z.object({ month });
// ?dates=2026-11-03,2026-11-05
const draftQuery = z.object({
  dates: z
    .string()
    .transform((s) => s.split(',').map((d) => d.trim()).filter(Boolean))
    .pipe(dateList),
});
const submitBody = z.object({ dates: dateList });

// ── 응답 형식 ──
type ReportStatus = 'submitted' | 'approved' | 'revision_requested'; // 검토 대기 / 승인 / 보완 요청

export type MyMonthlyReport = {
  id: number;
  status: ReportStatus;
  agency: string;
  totalMinutes: number;
  dates: string[]; // 묶인 기록의 활동일
  recordCount: number;
  reviewNote: string | null; // 구청 의견 (보완 요청 사유 등)
  submittedAt: string;
  reviewedAt: string | null;
  volunteerMinutes: number | null; // 승인되어 기록된 봉사시간 (승인 전 null)
};

const SELECT_MY_REPORT = `
  SELECT m.id, m.status, m.agency, m.total_minutes, m.review_note, m.submitted_at, m.reviewed_at,
         (SELECT coalesce(json_agg(DISTINCT r.activity_date ORDER BY r.activity_date), '[]'::json)
            FROM records r WHERE r.monthly_report_id = m.id) AS dates,
         (SELECT count(*) FROM records r WHERE r.monthly_report_id = m.id) AS record_count,
         v.minutes AS volunteer_minutes
  FROM monthly_reports m
  LEFT JOIN volunteer_hours v ON v.monthly_report_id = m.id
  WHERE m.user_id = $1`;

type MyReportRow = {
  id: number;
  status: ReportStatus;
  agency: string;
  total_minutes: number;
  review_note: string | null;
  submitted_at: Date;
  reviewed_at: Date | null;
  dates: string[];
  record_count: number;
  volunteer_minutes: number | null;
};

function toView(r: MyReportRow): MyMonthlyReport {
  return {
    id: r.id,
    status: r.status,
    agency: r.agency,
    totalMinutes: r.total_minutes,
    dates: r.dates,
    recordCount: r.record_count,
    reviewNote: r.review_note,
    submittedAt: r.submitted_at.toISOString(),
    reviewedAt: r.reviewed_at?.toISOString() ?? null,
    volunteerMinutes: r.volunteer_minutes,
  };
}

/** 고른 날짜의, 아직 보고서에 안 넣은 내 활동 기록. lock 이면 제출 중 다른 요청이 같은 기록을 묶지 못하게 잠근다. */
async function unreportedRecords(db: Db, userId: number, dates: string[], lock = false): Promise<DraftSource[]> {
  const { rows } = await db.query<{
    id: number;
    activity_date: string;
    tree_id: number;
    tree_name: string;
    agency: string;
    activity_kind: string | null;
    duration_min: number;
    memo: string | null;
    photo_count: number;
  }>(
    `SELECT r.id, r.activity_date, r.tree_id, ${treeNameSql('t')} AS tree_name, t.agency,
            r.activity_kind, r.duration_min, r.memo,
            (SELECT count(*) FROM record_photos p WHERE p.record_id = r.id) AS photo_count
     FROM records r JOIN trees t ON t.id = r.tree_id
     WHERE r.user_id = $1 AND r.type = 'activity' AND r.monthly_report_id IS NULL AND r.activity_date = ANY($2::date[])
     ${lock ? 'FOR UPDATE OF r' : ''}`,
    [userId, dates],
  );
  return rows.map((r) => ({
    recordId: r.id,
    date: r.activity_date,
    treeId: r.tree_id,
    treeName: r.tree_name, // 나무 상세와 같은 이름 "은행나무, 소파로 3번"
    agency: r.agency,
    activityKinds: r.activity_kind ? r.activity_kind.split(KIND_SEPARATOR) : [],
    minutes: r.duration_min,
    photoCount: r.photo_count,
    memo: r.memo,
  }));
}

// ── 라우터 (/monthly-reports) ──
export const monthlyReportsRouter = Router();
monthlyReportsRouter.use(authenticate);

// 달력용: 고를 수 있는 날(안 넣은 활동 기록이 있음)과 모두 제출한 날
monthlyReportsRouter.get('/dates', async (req, res) => {
  const { month: m } = datesQuery.parse(req.query);
  const { rows } = await getPool().query<{ date: string; open: number }>(
    `SELECT activity_date AS date, count(*) FILTER (WHERE monthly_report_id IS NULL) AS open
     FROM records
     WHERE user_id = $1 AND type = 'activity' AND to_char(activity_date, 'YYYY-MM') = $2
     GROUP BY activity_date ORDER BY activity_date`,
    [req.user!.id, m],
  );
  res.json({
    month: m,
    openDates: rows.filter((r) => r.open > 0).map((r) => r.date),
    submittedDates: rows.filter((r) => r.open === 0).map((r) => r.date),
  });
});

// 미리보기: 고른 날짜의 기록을 양식 순서로 채우고 활동 시간을 더한다
monthlyReportsRouter.get('/draft', async (req, res) => {
  const { dates } = draftQuery.parse(req.query);
  res.json(buildDraft(await unreportedRecords(getPool(), req.user!.id, dates)));
});

// 제출: 기록을 잠그고 보고서를 만든 뒤 기록에 보고서 번호를 채운다(한 트랜잭션)
monthlyReportsRouter.post('/', async (req, res) => {
  const { id: userId, role } = req.user!;
  if (role !== 'citizen') throw new HttpError(403, 'FORBIDDEN', '시민 계정만 보고서를 낼 수 있다.');
  const { dates } = submitBody.parse(req.body);

  const reportId = await withTransaction(async (db) => {
    const draft = buildDraft(await unreportedRecords(db, userId, dates, true));
    if (draft.rows.length === 0) throw badRequest('고른 날짜에 보고서에 넣을 활동 기록이 없다(이미 냈거나 기록이 없음).');
    if (draft.agencies.length > 1) {
      throw badRequest(`관리청이 다른 나무가 섞여 있다(${draft.agencies.join(', ')}). 관리청마다 따로 낸다.`);
    }

    const { rows } = await db.query<{ id: number }>(
      'INSERT INTO monthly_reports (user_id, agency, total_minutes) VALUES ($1, $2, $3) RETURNING id',
      [userId, draft.agencies[0], draft.totalMinutes],
    );
    const id = rows[0]!.id;
    await db.query('UPDATE records SET monthly_report_id = $1 WHERE id = ANY($2::bigint[])', [id, draft.rows.map((r) => r.recordId)]);
    return id;
  });

  const { rows } = await getPool().query<MyReportRow>(`${SELECT_MY_REPORT} AND m.id = $2`, [userId, reportId]);
  res.status(201).json(toView(rows[0]!));
});

// 내 보고서: 최신순. 구청 검토 결과(상태·의견·봉사시간)가 함께 온다
monthlyReportsRouter.get('/me', async (req, res) => {
  const { rows } = await getPool().query<MyReportRow>(`${SELECT_MY_REPORT} ORDER BY m.submitted_at DESC, m.id DESC`, [req.user!.id]);
  res.json({ reports: rows.map(toView) });
});
