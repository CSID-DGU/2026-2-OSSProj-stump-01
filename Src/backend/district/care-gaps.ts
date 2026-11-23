// #22 관리 사각지대·활동 공백 집계 (구청)
// 담당자 관리청의 나무 중 돌보미가 없거나 이번 달 활동이 끊긴 나무를 동별로 세고,
// 활동이 끊긴 나무 목록과 연간 월별 공백(여름 공백 표시용)을 준다.
// 사각지대 정의는 common/care-gaps.ts 한 곳에 있다. 집계는 라우터와 분리한 함수로 둔다(CLAUDE.md).
import { Router } from 'express';
import { z } from 'zod';
import { officerOf } from '../common/auth.js';
import { activeCaregiverSql, activityInMonthSql, CARE_GAP_TIME_ZONE } from '../common/care-gaps.js';
import { getPool, type Db } from '../common/db.js';
import { currentMonth } from './dashboard.js';

// ── 기준값 ──
const INACTIVE_LIST_LIMIT = 100; // 활동이 끊긴 나무 목록은 최대 이만큼(오래 끊긴 순)
const WEATHER_REGION = 'seoul'; // 폭염일은 서울 관측소 1곳 기준(ERD 기상 데이터)

// ── 요청 형식 ──
const monthQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식')
    .optional(),
});
const yearQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// ── 응답 형식 ──
type GapCounts = {
  trees: number; // 관리 나무 수
  noCaregiver: number; // 돌보미가 없는 나무
  inactive: number; // 돌보미는 있는데 이 달 활동이 끊긴 나무
};

export type CareGaps = {
  agency: string;
  month: string;
  totals: GapCounts;
  byDong: (GapCounts & { district: string; dong: string | null })[]; // 지도·드릴다운용. 나무가 서 있는 구·동 기준
  inactiveTrees: {
    id: number;
    code: string | null;
    species: string;
    district: string;
    dong: string | null;
    roadName: string | null;
    caregiverCount: number; // 이 달 활동 기간이 걸친 돌보미 수
    lastActivityDate: string | null; // 이 달 전 마지막 활동일. 한 번도 없으면 null
  }[];
};

export type MonthlyCareGap = {
  month: string; // YYYY-MM
  caredTrees: number; // 돌보미가 있던 나무
  activeTrees: number; // 그중 활동 기록이 있는 나무
  inactiveTrees: number; // 그중 활동이 끊긴 나무
  inactiveRate: number | null; // inactiveTrees / caredTrees (돌보미 있는 나무가 없으면 null)
  heatwaveDays: number; // 그 달 폭염일 수(기상 데이터 기준). 여름 공백의 이유를 같이 보여 준다
};

/** 'YYYY-MM' 달의 관리 사각지대 */
export async function loadCareGaps(db: Db, opts: { agency: string; month: string }): Promise<CareGaps> {
  // $1 관리청, $2 달의 첫날
  const params = [opts.agency, `${opts.month}-01`];
  const ms = '$2::date';
  // 이 달 돌보미가 있는 나무와, 그중 이 달 활동 기록이 있는 나무
  const ctes = `
    WITH cared AS (
      SELECT a.tree_id, count(DISTINCT a.user_id)::int AS caregivers
      FROM caregiver_applications a JOIN trees t ON t.id = a.tree_id
      WHERE t.agency = $1 AND ${activeCaregiverSql('a', ms)}
      GROUP BY a.tree_id
    ),
    acted AS (
      SELECT DISTINCT r.tree_id
      FROM records r JOIN cared c ON c.tree_id = r.tree_id
      WHERE ${activityInMonthSql('r', ms)}
    )`;

  const byDong = db.query<{ district: string; dong: string | null; trees: number; no_caregiver: number; inactive: number }>(
    `${ctes}
     SELECT t.district, t.dong, count(*)::int AS trees,
            count(*) FILTER (WHERE c.tree_id IS NULL)::int AS no_caregiver,
            count(*) FILTER (WHERE c.tree_id IS NOT NULL AND ac.tree_id IS NULL)::int AS inactive
     FROM trees t
     LEFT JOIN cared c ON c.tree_id = t.id
     LEFT JOIN acted ac ON ac.tree_id = t.id
     WHERE t.agency = $1
     GROUP BY t.district, t.dong
     ORDER BY t.district, t.dong NULLS LAST`,
    params,
  );

  // 활동이 끊긴 나무: 오래 끊긴 순(한 번도 활동이 없던 나무가 먼저)
  const inactive = db.query<{
    id: number;
    code: string | null;
    species: string;
    district: string;
    dong: string | null;
    road_name: string | null;
    caregivers: number;
    last_activity_date: string | null;
  }>(
    `${ctes}
     SELECT t.id, t.code, t.species, t.district, t.dong, t.road_name, c.caregivers,
            (SELECT to_char(max(r.activity_date), 'YYYY-MM-DD') FROM records r
              WHERE r.tree_id = t.id AND r.type = 'activity' AND r.activity_date < ${ms}) AS last_activity_date
     FROM cared c JOIN trees t ON t.id = c.tree_id
     WHERE NOT EXISTS (SELECT 1 FROM acted ac WHERE ac.tree_id = c.tree_id)
     ORDER BY last_activity_date ASC NULLS FIRST, t.id
     LIMIT ${INACTIVE_LIST_LIMIT}`,
    params,
  );

  const [dongs, trees] = await Promise.all([byDong, inactive]);
  const rows = dongs.rows.map((r) => ({
    district: r.district,
    dong: r.dong,
    trees: r.trees,
    noCaregiver: r.no_caregiver,
    inactive: r.inactive,
  }));
  return {
    agency: opts.agency,
    month: opts.month,
    totals: sumCounts(rows),
    byDong: rows,
    inactiveTrees: trees.rows.map((r) => ({
      id: r.id,
      code: r.code,
      species: r.species,
      district: r.district,
      dong: r.dong,
      roadName: r.road_name,
      caregiverCount: r.caregivers,
      lastActivityDate: r.last_activity_date,
    })),
  };
}

/** 동별 숫자를 더한다 */
export function sumCounts(rows: GapCounts[]): GapCounts {
  return rows.reduce(
    (s, r) => ({ trees: s.trees + r.trees, noCaregiver: s.noCaregiver + r.noCaregiver, inactive: s.inactive + r.inactive }),
    { trees: 0, noCaregiver: 0, inactive: 0 },
  );
}

/** 한눈에 보기용 숫자만 센다(돌보미 없는 나무, 이 달 활동이 끊긴 나무) */
export async function countCareGaps(db: Db, opts: { agency: string; month: string }): Promise<{ noCaregiver: number; inactive: number }> {
  const ms = '$2::date';
  const { rows } = await db.query<{ trees: number; cared: number; inactive: number }>(
    `WITH cared AS (
       SELECT DISTINCT a.tree_id
       FROM caregiver_applications a JOIN trees t ON t.id = a.tree_id
       WHERE t.agency = $1 AND ${activeCaregiverSql('a', ms)}
     )
     SELECT (SELECT count(*)::int FROM trees WHERE agency = $1) AS trees,
            (SELECT count(*)::int FROM cared) AS cared,
            (SELECT count(*)::int FROM cared c
              WHERE NOT EXISTS (SELECT 1 FROM records r WHERE r.tree_id = c.tree_id AND ${activityInMonthSql('r', ms)})) AS inactive`,
    [opts.agency, `${opts.month}-01`],
  );
  const r = rows[0]!;
  return { noCaregiver: r.trees - r.cared, inactive: r.inactive };
}

/**
 * year년 1월부터 매달의 활동 공백. 올해면 이번 달까지만 준다(앞으로 올 달은 아직 공백이 아니다).
 */
export async function loadMonthlyCareGaps(
  db: Db,
  opts: { agency: string; year: number; now?: Date },
): Promise<MonthlyCareGap[]> {
  const thisMonth = currentMonth(opts.now);
  const thisYear = Number(thisMonth.slice(0, 4));
  if (opts.year > thisYear) return []; // 아직 오지 않은 해
  const lastMonth = opts.year === thisYear ? thisMonth : `${opts.year}-12`;

  // $1 관리청, $2 첫 달 첫날, $3 마지막 달 첫날, $4 기상 지역
  const { rows } = await db.query<{ month: string; cared: number; inactive: number; heatwave_days: number }>(
    `WITH months AS (
       SELECT generate_series($2::date, $3::date, interval '1 month')::date AS ms
     ),
     cared AS (
       SELECT DISTINCT m.ms, a.tree_id
       FROM months m
       JOIN caregiver_applications a ON ${activeCaregiverSql('a', 'm.ms')}
       JOIN trees t ON t.id = a.tree_id AND t.agency = $1
     ),
     acted AS (
       SELECT DISTINCT date_trunc('month', r.activity_date)::date AS ms, r.tree_id
       FROM records r JOIN trees t ON t.id = r.tree_id AND t.agency = $1
       WHERE r.type = 'activity' AND r.activity_date >= $2::date AND r.activity_date < ($3::date + interval '1 month')
     ),
     heat AS (
       SELECT date_trunc('month', w.date)::date AS ms, count(*) FILTER (WHERE w.is_heatwave)::int AS days
       FROM weather w
       WHERE w.region = $4 AND w.date >= $2::date AND w.date < ($3::date + interval '1 month')
       GROUP BY 1
     )
     SELECT to_char(m.ms, 'YYYY-MM') AS month,
            count(c.tree_id)::int AS cared,
            count(c.tree_id) FILTER (WHERE ac.tree_id IS NULL)::int AS inactive,
            coalesce(max(h.days), 0)::int AS heatwave_days
     FROM months m
     LEFT JOIN cared c ON c.ms = m.ms
     LEFT JOIN acted ac ON ac.ms = c.ms AND ac.tree_id = c.tree_id
     LEFT JOIN heat h ON h.ms = m.ms
     GROUP BY m.ms
     ORDER BY m.ms`,
    [opts.agency, `${opts.year}-01-01`, `${lastMonth}-01`, WEATHER_REGION],
  );
  return rows.map((r) => ({
    month: r.month,
    caredTrees: r.cared,
    activeTrees: r.cared - r.inactive,
    inactiveTrees: r.inactive,
    inactiveRate: r.cared === 0 ? null : Math.round((r.inactive / r.cared) * 1000) / 1000,
    heatwaveDays: r.heatwave_days,
  }));
}

// ── 라우터 (/admin/care-gaps) ──
export const careGapsRouter = Router();

// 이 달(기본: 이번 달)의 사각지대: 동별 숫자와 활동이 끊긴 나무 목록
careGapsRouter.get('/', async (req, res) => {
  const { agency } = officerOf(req);
  const { month } = monthQuery.parse(req.query);
  res.json(await loadCareGaps(getPool(), { agency, month: month ?? currentMonth() }));
});

// 연간 월별 활동 공백(기본: 올해)
careGapsRouter.get('/monthly', async (req, res) => {
  const { agency } = officerOf(req);
  const { year } = yearQuery.parse(req.query);
  const y = year ?? Number(currentMonth().slice(0, 4));
  res.json({ agency, year: y, timeZone: CARE_GAP_TIME_ZONE, months: await loadMonthlyCareGaps(getPool(), { agency, year: y }) });
});
