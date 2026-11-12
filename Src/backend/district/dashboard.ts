// #71 한눈에 보기 집계 (구청 웹 첫 화면)
// 담당자 관리청 기준으로 오늘 처리할 일과 이달 현황을 센다. 숫자를 누르면 각 처리 화면(신청 심사·보고서 검토·물품·신고)으로 간다.
// 집계 쿼리는 loadDashboard()에 모아 라우터와 분리한다(CLAUDE.md: 집계 로직은 화면·API와 분리).
import { Router } from 'express';
import { z } from 'zod';
import { officerOf } from '../common/auth.js';
import { getPool, type Db } from '../common/db.js';

// ── 기준값 ──
const TIME_ZONE = 'Asia/Seoul'; // "이달"은 한국 시간 달력 기준
const MISSING_LIST_LIMIT = 50; // 미제출 돌보미 목록은 최대 이만큼만 보여 준다

const query = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식')
    .optional(),
  organizationId: z.coerce.number().int().positive().optional(),
});

/** 지금 한국 시간 기준 'YYYY-MM' */
export function currentMonth(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE }).slice(0, 7);
}

export type Dashboard = {
  agency: string;
  month: string;
  organizationId: number | null;
  monthlyReports: { pending: number; revisionRequested: number }; // 검토 대기, 보완 요청 후 재제출 대기
  applications: { pending: number }; // 심사 대기 신청
  rentals: { requested: number; awaitingPickup: number }; // 승인 대기, 승인 후 수령 대기
  incidentReports: { pending: number; inspecting: number; oldestUnresolvedAt: string | null }; // 이상 신고(reports)
  caregivers: {
    active: number; // 이달에 활동 기간이 걸친 승인된 돌보미
    missingReport: number; // 그중 이달 보고서를 하나도 내지 않은 돌보미
    missingReportList: { userId: number; nickname: string; realName: string | null; treeCount: number }[];
  };
  volunteerHours: { minutes: number; people: number }; // 이달 승인되어 기록된 봉사시간
  organizations: { id: number; name: string }[]; // 단체 필터에 보여 줄 단체(이 관리청 나무를 돌보는 회원이 있는 단체)
};

/**
 * 한눈에 보기 숫자를 센다.
 * organizationId가 있으면 그 단체 회원(신청자·보고서 제출자·물품 신청자·신고자·돌보미)으로 좁힌다.
 */
export async function loadDashboard(
  db: Db,
  opts: { agency: string; month: string; organizationId?: number | null },
): Promise<Dashboard> {
  const orgId = opts.organizationId ?? null;
  // $1 관리청, $2 단체 id(없으면 null), $3 달의 첫날
  const params = [opts.agency, orgId, `${opts.month}-01`];
  // 사용자 컬럼이 단체 회원인지 확인하는 조건. 단체 필터가 없으면 항상 참이다.
  const inOrg = (userCol: string) =>
    `($2::bigint IS NULL OR EXISTS (SELECT 1 FROM organization_members om WHERE om.organization_id = $2 AND om.user_id = ${userCol}))`;
  // 이달 범위(한국 시간)를 timestamptz로
  const monthStart = `($3::date::timestamp AT TIME ZONE '${TIME_ZONE}')`;
  const monthEnd = `(($3::date + interval '1 month')::timestamp AT TIME ZONE '${TIME_ZONE}')`;

  const counts = db.query(
    `SELECT
       (SELECT count(*) FROM monthly_reports m
         WHERE m.agency = $1 AND m.status = 'submitted' AND ${inOrg('m.user_id')}) AS reports_pending,
       (SELECT count(*) FROM monthly_reports m
         WHERE m.agency = $1 AND m.status = 'revision_requested' AND ${inOrg('m.user_id')}) AS reports_revision,
       (SELECT count(*) FROM caregiver_applications a JOIN trees t ON t.id = a.tree_id
         WHERE t.agency = $1 AND a.status = 'pending' AND ${inOrg('a.user_id')}) AS applications_pending,
       (SELECT count(*) FROM rentals r JOIN rental_items i ON i.id = r.item_id
         WHERE i.agency = $1 AND r.status = 'requested' AND ${inOrg('r.user_id')}) AS rentals_requested,
       (SELECT count(*) FROM rentals r JOIN rental_items i ON i.id = r.item_id
         WHERE i.agency = $1 AND r.status = 'approved' AND ${inOrg('r.user_id')}) AS rentals_approved,
       (SELECT count(*) FROM reports p JOIN records rc ON rc.id = p.record_id
         WHERE p.agency = $1 AND p.status = 'pending' AND ${inOrg('rc.user_id')}) AS incidents_pending,
       (SELECT count(*) FROM reports p JOIN records rc ON rc.id = p.record_id
         WHERE p.agency = $1 AND p.status = 'inspecting' AND ${inOrg('rc.user_id')}) AS incidents_inspecting,
       (SELECT min(p.created_at) FROM reports p JOIN records rc ON rc.id = p.record_id
         WHERE p.agency = $1 AND p.status <> 'resolved' AND ${inOrg('rc.user_id')}) AS incidents_oldest,
       (SELECT coalesce(sum(v.minutes), 0) FROM volunteer_hours v JOIN monthly_reports m ON m.id = v.monthly_report_id
         WHERE m.agency = $1 AND v.recorded_at >= ${monthStart} AND v.recorded_at < ${monthEnd}
           AND ${inOrg('v.user_id')}) AS volunteer_minutes,
       (SELECT count(DISTINCT v.user_id) FROM volunteer_hours v JOIN monthly_reports m ON m.id = v.monthly_report_id
         WHERE m.agency = $1 AND v.recorded_at >= ${monthStart} AND v.recorded_at < ${monthEnd}
           AND ${inOrg('v.user_id')}) AS volunteer_people`,
    params,
  );

  // 이달에 활동 기간이 걸친 승인된 돌보미와, 이달 이 관리청에 낸 보고서가 있는지
  const caregivers = db.query<{ user_id: number; nickname: string; real_name: string | null; tree_count: number; submitted: boolean }>(
    `WITH active AS (
       SELECT a.user_id, count(DISTINCT a.tree_id) AS tree_count
       FROM caregiver_applications a JOIN trees t ON t.id = a.tree_id
       WHERE t.agency = $1 AND a.status = 'approved'
         AND a.period_start < ($3::date + interval '1 month') AND a.period_end >= $3::date
         AND ${inOrg('a.user_id')}
       GROUP BY a.user_id
     )
     SELECT u.id AS user_id, u.nickname, u.real_name, active.tree_count,
            EXISTS (SELECT 1 FROM monthly_reports m
                    WHERE m.user_id = active.user_id AND m.agency = $1
                      AND m.submitted_at >= ${monthStart} AND m.submitted_at < ${monthEnd}) AS submitted
     FROM active JOIN users u ON u.id = active.user_id
     ORDER BY u.nickname, u.id`,
    params,
  );

  // 단체 필터 목록: 이 관리청 나무에 승인된 돌보미가 있는 단체
  const organizations = db.query<{ id: number; name: string }>(
    `SELECT DISTINCT o.id, o.name
     FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     JOIN caregiver_applications a ON a.user_id = om.user_id AND a.status = 'approved'
     JOIN trees t ON t.id = a.tree_id AND t.agency = $1
     ORDER BY o.name, o.id`,
    [opts.agency],
  );

  const [c, cg, orgs] = await Promise.all([counts, caregivers, organizations]);
  const row = c.rows[0];
  const missing = cg.rows.filter((r) => !r.submitted);

  return {
    agency: opts.agency,
    month: opts.month,
    organizationId: orgId,
    monthlyReports: { pending: row.reports_pending, revisionRequested: row.reports_revision },
    applications: { pending: row.applications_pending },
    rentals: { requested: row.rentals_requested, awaitingPickup: row.rentals_approved },
    incidentReports: {
      pending: row.incidents_pending,
      inspecting: row.incidents_inspecting,
      oldestUnresolvedAt: row.incidents_oldest ? (row.incidents_oldest as Date).toISOString() : null,
    },
    caregivers: {
      active: cg.rows.length,
      missingReport: missing.length,
      missingReportList: missing.slice(0, MISSING_LIST_LIMIT).map((r) => ({
        userId: r.user_id,
        nickname: r.nickname,
        realName: r.real_name,
        treeCount: r.tree_count,
      })),
    },
    volunteerHours: { minutes: row.volunteer_minutes, people: row.volunteer_people },
    organizations: orgs.rows,
  };
}

// ── 라우터 (/admin/dashboard) ──
export const dashboardRouter = Router();

dashboardRouter.get('/', async (req, res) => {
  const { agency } = officerOf(req);
  const { month, organizationId } = query.parse(req.query);
  res.json(await loadDashboard(getPool(), { agency, month: month ?? currentMonth(), organizationId }));
});
