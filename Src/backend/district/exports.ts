// #73 상부 보고 집계 내려받기 (구청)
// - 월간 보고: 그 달 관리청 나무의 구·동별 돌봄 현황과 합계, 보고서·물품 요약
// - 연말 표창 대상(Could): 그 해 승인된 봉사시간이 많은 순의 돌보미 목록
// 집계 함수(load*)와 CSV 만들기(*Csv)를 라우터와 분리한다(CLAUDE.md). format=json이면 화면 미리보기용으로 그대로 준다.
import { Router } from 'express';
import { z } from 'zod';
import { officerOf } from '../common/auth.js';
import { activeCaregiverSql, activityInMonthSql, CARE_GAP_TIME_ZONE } from '../common/care-gaps.js';
import { getPool, type Db } from '../common/db.js';
import { notFound } from '../common/errors.js';
import { minutesToHours, toCsv, type Cell } from './csv.js';
import { currentMonth } from './dashboard.js';

// ── 기준값 ──
const TIME_ZONE = CARE_GAP_TIME_ZONE; // 달·해는 한국 시간 달력 기준
const COMMENDATION_LIMIT = 500; // 표창 대상 목록 최대 인원

// ── 요청 형식 ──
const format = z.enum(['csv', 'json']).default('csv');
const organizationId = z.coerce.number().int().positive().optional();
const monthlyQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식')
    .optional(),
  organizationId,
  format,
});
const commendationQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  minHours: z.coerce.number().min(0).max(10000).default(0), // 이 시간 이상만. 기준은 구청 확인 전(#59)이라 요청으로 받는다
  organizationId,
  format,
});

// ── 응답 형식 ──
type RegionCounts = {
  trees: number; // 관리 나무
  caredTrees: number; // 그 달 돌보미가 있던 나무
  caregivers: number; // 그 달 활동 기간이 걸친 돌보미(사람 수)
  activityRecords: number; // 그 달 활동 기록 수
  activityMinutes: number; // 그 달 활동 시간 합계
  volunteerMinutes: number; // 그 달 승인된 봉사시간(보고서에 묶인 기록이 있는 나무 위치 기준)
  volunteerPeople: number; // 그 달 봉사시간을 인정받은 사람 수
  incidentsReceived: number; // 그 달 접수된 이상 신고
  incidentsResolved: number; // 그 달 조치 완료한 이상 신고
};

export type MonthlyExport = {
  agency: string;
  month: string;
  organization: { id: number; name: string } | null;
  regions: (RegionCounts & { district: string; dong: string | null })[];
  totals: RegionCounts; // 사람 수는 동별 합이 아니라 중복을 뺀 수다
  monthlyReports: { submitted: number; approved: number; revisionRequested: number }; // 그 달 제출·승인·보완 요청
  rentals: { item: string; approvedQuantity: number; receivedQuantity: number }[]; // 그 달 물품 승인·수령 수량
};

export type Commendation = {
  rank: number;
  userId: number;
  nickname: string;
  realName: string | null;
  volunteerMinutes: number; // 그 해 승인된 봉사시간
  approvedReports: number;
  trees: number; // 그 해 활동 기록을 남긴 이 관리청 나무 수
};

/** 'YYYY-MM' 달의 시작·끝(한국 시간)을 timestamptz SQL로. $n = 그 달 첫날(date) */
function monthRangeSql(param: string) {
  return {
    start: `(${param}::date::timestamp AT TIME ZONE '${TIME_ZONE}')`,
    end: `((${param}::date + interval '1 month')::timestamp AT TIME ZONE '${TIME_ZONE}')`,
  };
}

/** 사용자 컬럼이 단체 회원인지($2). 단체가 없으면 항상 참 */
const inOrg = (userCol: string) =>
  `($2::bigint IS NULL OR EXISTS (SELECT 1 FROM organization_members om WHERE om.organization_id = $2 AND om.user_id = ${userCol}))`;

async function findOrganization(db: Db, id: number | null) {
  if (id === null) return null;
  const { rows } = await db.query<{ id: number; name: string }>('SELECT id, name FROM organizations WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('단체를 찾을 수 없다.');
  return rows[0];
}

/**
 * 월간 상부 보고 집계. organizationId가 있으면 그 단체 회원의 활동만 센다(관리 나무 수는 그대로).
 */
export async function loadMonthlyExport(
  db: Db,
  opts: { agency: string; month: string; organizationId?: number | null },
): Promise<MonthlyExport> {
  const orgId = opts.organizationId ?? null;
  const organization = await findOrganization(db, orgId);
  // $1 관리청, $2 단체 id, $3 달의 첫날
  const params = [opts.agency, orgId, `${opts.month}-01`];
  const ms = '$3::date';
  const { start, end } = monthRangeSql('$3');

  // 나무 한 그루·사람 한 명 단위의 사실(fact)을 모은 뒤 구·동별과 전체(GROUPING SETS)로 한 번에 센다
  const regions = db.query<{
    is_total: boolean;
    district: string | null;
    dong: string | null;
    trees: number;
    cared_trees: number;
    caregivers: number;
    activity_records: number;
    activity_minutes: number;
    volunteer_minutes: number;
    volunteer_people: number;
    incidents_received: number;
    incidents_resolved: number;
  }>(
    `WITH tr AS (
       SELECT id, district, dong FROM trees WHERE agency = $1
     ),
     facts AS (
       SELECT a.tree_id, a.user_id, 'cared' AS kind, 0 AS minutes
       FROM caregiver_applications a JOIN tr ON tr.id = a.tree_id
       WHERE ${activeCaregiverSql('a', ms)} AND ${inOrg('a.user_id')}
       UNION ALL
       SELECT r.tree_id, r.user_id, 'activity', r.duration_min
       FROM records r JOIN tr ON tr.id = r.tree_id
       WHERE ${activityInMonthSql('r', ms)} AND ${inOrg('r.user_id')}
       UNION ALL
       SELECT r.tree_id, r.user_id, 'volunteer', r.duration_min
       FROM volunteer_hours v
       JOIN records r ON r.monthly_report_id = v.monthly_report_id AND r.type = 'activity'
       JOIN tr ON tr.id = r.tree_id
       WHERE v.recorded_at >= ${start} AND v.recorded_at < ${end} AND ${inOrg('v.user_id')}
       UNION ALL
       SELECT rc.tree_id, rc.user_id, 'incident_received', 0
       FROM reports p JOIN records rc ON rc.id = p.record_id JOIN tr ON tr.id = rc.tree_id
       WHERE p.created_at >= ${start} AND p.created_at < ${end} AND ${inOrg('rc.user_id')}
       UNION ALL
       SELECT rc.tree_id, rc.user_id, 'incident_resolved', 0
       FROM reports p JOIN records rc ON rc.id = p.record_id JOIN tr ON tr.id = rc.tree_id
       WHERE p.resolved_at >= ${start} AND p.resolved_at < ${end} AND ${inOrg('rc.user_id')}
     )
     SELECT grouping(tr.district) = 1 AS is_total, tr.district, tr.dong,
            count(DISTINCT tr.id)::int AS trees,
            count(DISTINCT tr.id) FILTER (WHERE f.kind = 'cared')::int AS cared_trees,
            count(DISTINCT f.user_id) FILTER (WHERE f.kind = 'cared')::int AS caregivers,
            count(*) FILTER (WHERE f.kind = 'activity')::int AS activity_records,
            coalesce(sum(f.minutes) FILTER (WHERE f.kind = 'activity'), 0)::int AS activity_minutes,
            coalesce(sum(f.minutes) FILTER (WHERE f.kind = 'volunteer'), 0)::int AS volunteer_minutes,
            count(DISTINCT f.user_id) FILTER (WHERE f.kind = 'volunteer')::int AS volunteer_people,
            count(*) FILTER (WHERE f.kind = 'incident_received')::int AS incidents_received,
            count(*) FILTER (WHERE f.kind = 'incident_resolved')::int AS incidents_resolved
     FROM tr LEFT JOIN facts f ON f.tree_id = tr.id
     GROUP BY GROUPING SETS ((tr.district, tr.dong), ())
     ORDER BY is_total, tr.district, tr.dong NULLS LAST`,
    params,
  );

  const reports = db.query<{ submitted: number; approved: number; revision: number }>(
    `SELECT count(*) FILTER (WHERE m.submitted_at >= ${start} AND m.submitted_at < ${end})::int AS submitted,
            count(*) FILTER (WHERE m.status = 'approved' AND m.reviewed_at >= ${start} AND m.reviewed_at < ${end})::int AS approved,
            count(*) FILTER (WHERE m.status = 'revision_requested' AND m.reviewed_at >= ${start} AND m.reviewed_at < ${end})::int AS revision
     FROM monthly_reports m
     WHERE m.agency = $1 AND ${inOrg('m.user_id')}`,
    params,
  );

  const rentals = db.query<{ item: string; approved: number; received: number }>(
    `SELECT i.name AS item,
            coalesce(sum(r.quantity) FILTER (WHERE r.status IN ('approved', 'received')
                                              AND r.handled_at >= ${start} AND r.handled_at < ${end}), 0)::int AS approved,
            coalesce(sum(r.quantity) FILTER (WHERE r.received_at >= ${start} AND r.received_at < ${end}), 0)::int AS received
     FROM rental_items i
     LEFT JOIN rentals r ON r.item_id = i.id AND ${inOrg('r.user_id')}
     WHERE i.agency = $1
     GROUP BY i.id, i.name
     ORDER BY i.name, i.id`,
    params,
  );

  const [g, m, rt] = await Promise.all([regions, reports, rentals]);
  const toCounts = (r: (typeof g.rows)[number]): RegionCounts => ({
    trees: r.trees,
    caredTrees: r.cared_trees,
    caregivers: r.caregivers,
    activityRecords: r.activity_records,
    activityMinutes: r.activity_minutes,
    volunteerMinutes: r.volunteer_minutes,
    volunteerPeople: r.volunteer_people,
    incidentsReceived: r.incidents_received,
    incidentsResolved: r.incidents_resolved,
  });
  const totalRow = g.rows.find((r) => r.is_total);
  return {
    agency: opts.agency,
    month: opts.month,
    organization,
    regions: g.rows.filter((r) => !r.is_total).map((r) => ({ district: r.district!, dong: r.dong, ...toCounts(r) })),
    // 나무가 하나도 없는 관리청이면 GROUPING SETS의 전체 줄만 0으로 나온다
    totals: totalRow ? toCounts(totalRow) : toCounts({ ...EMPTY_ROW }),
    monthlyReports: { submitted: m.rows[0]!.submitted, approved: m.rows[0]!.approved, revisionRequested: m.rows[0]!.revision },
    rentals: rt.rows.map((r) => ({ item: r.item, approvedQuantity: r.approved, receivedQuantity: r.received })),
  };
}

const EMPTY_ROW = {
  is_total: true,
  district: null,
  dong: null,
  trees: 0,
  cared_trees: 0,
  caregivers: 0,
  activity_records: 0,
  activity_minutes: 0,
  volunteer_minutes: 0,
  volunteer_people: 0,
  incidents_received: 0,
  incidents_resolved: 0,
};

const REGION_HEADER = [
  '자치구',
  '동',
  '관리 나무',
  '돌보미 있는 나무',
  '돌보미(명)',
  '활동 기록(건)',
  '활동 시간(시간)',
  '인정 봉사시간(시간)',
  '봉사 인정 인원(명)',
  '이상 신고 접수(건)',
  '이상 신고 조치 완료(건)',
];

function regionCells(c: RegionCounts): Cell[] {
  return [
    c.trees,
    c.caredTrees,
    c.caregivers,
    c.activityRecords,
    minutesToHours(c.activityMinutes),
    minutesToHours(c.volunteerMinutes),
    c.volunteerPeople,
    c.incidentsReceived,
    c.incidentsResolved,
  ];
}

/** 월간 보고 CSV: 머리말 → 구·동별 표와 합계 → 보고서 요약 → 물품 지급 */
export function monthlyExportCsv(e: MonthlyExport): string {
  return toCsv([
    ['서울 TreeCare 나무돌보미 월간 활동 보고'],
    ['관리청', e.agency],
    ['기간', e.month],
    ['단체', e.organization?.name ?? '전체'],
    [],
    REGION_HEADER,
    ...e.regions.map((r) => [r.district, r.dong ?? '(동 정보 없음)', ...regionCells(r)]),
    ['합계', '', ...regionCells(e.totals)],
    [],
    ['월간 보고서', '제출', '승인', '보완 요청'],
    ['', e.monthlyReports.submitted, e.monthlyReports.approved, e.monthlyReports.revisionRequested],
    [],
    ['물품 지급', '승인 수량', '수령 수량'],
    ...e.rentals.map((r) => [r.item, r.approvedQuantity, r.receivedQuantity]),
    [],
    ['* 돌보미(명)·봉사 인정 인원(명)의 합계는 여러 동에서 활동한 사람을 한 번만 센 수다.'],
    ['* 인정 봉사시간은 그 달 승인된 월간 보고서의 기록 시간을 기록한 나무의 위치로 나눈 값이다.'],
  ]);
}

/**
 * 연말 표창 대상: 그 해(한국 시간) 이 관리청에서 승인된 봉사시간이 minHours 이상인 돌보미, 많은 순.
 * 실명이 들어가는 개인정보라 구청 담당자만 내려받는다(CLAUDE.md 절대 규칙).
 */
export async function loadCommendations(
  db: Db,
  opts: { agency: string; year: number; minHours: number; organizationId?: number | null },
): Promise<{ agency: string; year: number; minHours: number; organization: { id: number; name: string } | null; people: Commendation[] }> {
  const orgId = opts.organizationId ?? null;
  const organization = await findOrganization(db, orgId);
  const { start, end } = {
    start: `($3::date::timestamp AT TIME ZONE '${TIME_ZONE}')`,
    end: `(($3::date + interval '1 year')::timestamp AT TIME ZONE '${TIME_ZONE}')`,
  };
  const { rows } = await db.query<{
    user_id: number;
    nickname: string;
    real_name: string | null;
    minutes: number;
    reports: number;
    trees: number;
  }>(
    `WITH approved AS (
       SELECT v.user_id, v.monthly_report_id, v.minutes
       FROM volunteer_hours v JOIN monthly_reports m ON m.id = v.monthly_report_id
       WHERE m.agency = $1 AND v.recorded_at >= ${start} AND v.recorded_at < ${end} AND ${inOrg('v.user_id')}
     )
     SELECT u.id AS user_id, u.nickname, u.real_name,
            sum(ap.minutes)::int AS minutes,
            count(*)::int AS reports,
            (SELECT count(DISTINCT r.tree_id)::int FROM records r
              WHERE r.monthly_report_id IN (SELECT monthly_report_id FROM approved a2 WHERE a2.user_id = u.id)) AS trees
     FROM approved ap JOIN users u ON u.id = ap.user_id
     GROUP BY u.id
     HAVING sum(ap.minutes) >= $4
     ORDER BY minutes DESC, u.id
     LIMIT ${COMMENDATION_LIMIT}`,
    [opts.agency, orgId, `${opts.year}-01-01`, Math.round(opts.minHours * 60)],
  );
  // 같은 봉사시간이면 같은 순위(1, 1, 3 …)
  let rank = 0;
  const people = rows.map((r, i) => {
    if (i === 0 || r.minutes !== rows[i - 1]!.minutes) rank = i + 1;
    return {
      rank,
      userId: r.user_id,
      nickname: r.nickname,
      realName: r.real_name,
      volunteerMinutes: r.minutes,
      approvedReports: r.reports,
      trees: r.trees,
    };
  });
  return { agency: opts.agency, year: opts.year, minHours: opts.minHours, organization, people };
}

export function commendationsCsv(c: Awaited<ReturnType<typeof loadCommendations>>): string {
  return toCsv([
    ['서울 TreeCare 나무돌보미 연말 표창 대상'],
    ['관리청', c.agency],
    ['연도', c.year],
    ['단체', c.organization?.name ?? '전체'],
    ['기준', `승인 봉사시간 ${c.minHours}시간 이상`],
    [],
    ['순위', '별명', '실명', '승인 봉사시간(시간)', '승인 보고서(편)', '돌본 나무(그루)'],
    ...c.people.map((p) => [p.rank, p.nickname, p.realName, minutesToHours(p.volunteerMinutes), p.approvedReports, p.trees]),
  ]);
}

/** 내려받기 응답. 파일 이름은 영문으로 둔다(브라우저마다 한글 파일 이름 처리가 달라서) */
function sendCsv(res: import('express').Response, fileName: string, body: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(body);
}

// ── 라우터 (/admin/exports) ──
export const exportsRouter = Router();

// 월간 상부 보고 (기본: 이번 달, CSV)
exportsRouter.get('/monthly', async (req, res) => {
  const { agency } = officerOf(req);
  const q = monthlyQuery.parse(req.query);
  const month = q.month ?? currentMonth();
  const data = await loadMonthlyExport(getPool(), { agency, month, organizationId: q.organizationId });
  if (q.format === 'json') return void res.json(data);
  sendCsv(res, `treecare-monthly-${month}${q.organizationId ? `-org${q.organizationId}` : ''}.csv`, monthlyExportCsv(data));
});

// 연말 표창 대상 (기본: 올해, CSV)
exportsRouter.get('/commendations', async (req, res) => {
  const { agency } = officerOf(req);
  const q = commendationQuery.parse(req.query);
  const year = q.year ?? Number(currentMonth().slice(0, 4));
  const data = await loadCommendations(getPool(), { agency, year, minHours: q.minHours, organizationId: q.organizationId });
  if (q.format === 'json') return void res.json(data);
  sendCsv(res, `treecare-commendations-${year}${q.organizationId ? `-org${q.organizationId}` : ''}.csv`, commendationsCsv(data));
});
