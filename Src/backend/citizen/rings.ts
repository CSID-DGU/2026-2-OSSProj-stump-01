// #12 디지털 나이테 월별 집계 API. 로그인 없이 쓴다(나무 상세·QR 이야기 페이지의 나이테 탭).
// GET /trees/{id}/rings?year= → 그해 1월~12월 12조각. 출처별로 월별 값을 세고 buildRingMonths()로 모은다.
import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../common/db.js';
import { notFound } from '../common/errors.js';
import { monthlyIncidentMarkers } from '../common/incident-markers.js';
import { buildRingMonths, type RingMonth } from './tree-rings.js';

// ── 기준값 ──
const MIN_YEAR = 2000; // 이보다 앞선 해는 기상 자료도 서비스 기록도 없다
const MAX_YEAR = 2100;
const TIME_ZONE = 'Asia/Seoul'; // 이야기 글의 날짜는 한국 시간으로 센다
const WEATHER_REGION = 'seoul'; // weather.region 값 (data/weather.py 의 REGION, 기상청 ASOS 서울 108)

/** 지금 한국 시간 기준 올해 */
function seoulYear(): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric' }).format(new Date()));
}

// ── 요청 형식 ──
const idParam = z.object({ id: z.coerce.number().int().positive() });
const ringsQuery = z.object({ year: z.coerce.number().int().min(MIN_YEAR).max(MAX_YEAR).optional() });

// ── 응답 형식 ──
export type TreeRingsView = { treeId: number; year: number; months: RingMonth[] };

// 그해 1월 1일 이상, 다음 해 1월 1일 미만 ($2 = 연도)
const IN_YEAR = (col: string) => `${col} >= make_date($2::int, 1, 1) AND ${col} < make_date($2::int + 1, 1, 1)`;

// ── 라우터 (/trees) ──
export const treeRingsRouter = Router();

treeRingsRouter.get('/:id/rings', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const year = ringsQuery.parse(req.query).year ?? seoulYear();
  const pool = getPool();

  const tree = await pool.query('SELECT 1 FROM trees WHERE id = $1', [id]);
  if (tree.rowCount === 0) throw notFound('나무를 찾을 수 없다.');

  const [weather, care, activityDays, stories, incidents, reactions] = await Promise.all([
    // 받은 비·더위: 서울 기상 일자료(ASOS)를 달별로 (모든 나무가 같은 값)
    pool.query<{ month: number; rain_mm: number; temp_max_avg: number | null; heat_days: number }>(
      `SELECT extract(month FROM date)::int AS month,
              sum(precipitation_mm)::float8 AS rain_mm,
              round(avg(temp_max), 1)::float8 AS temp_max_avg,
              count(*) FILTER (WHERE is_heatwave)::int AS heat_days
       FROM weather
       WHERE region = $1 AND ${IN_YEAR('date')}
       GROUP BY 1`,
      [WEATHER_REGION, year],
    ),
    // 받은 돌봄: 구청이 승인한 보고서에 든 활동 기록 (그 나무의 모든 돌보미)
    pool.query<{ month: number; minutes: number; count: number }>(
      `SELECT extract(month FROM r.activity_date)::int AS month, sum(r.duration_min)::int AS minutes, count(*)::int AS count
       FROM records r JOIN monthly_reports m ON m.id = r.monthly_report_id
       WHERE r.tree_id = $1 AND r.type = 'activity' AND m.status = 'approved' AND ${IN_YEAR('r.activity_date')}
       GROUP BY 1`,
      [id, year],
    ),
    // 활동한 날(점): 승인 여부와 상관없이 활동 기록이 있는 날
    pool.query<{ month: number; day: number }>(
      `SELECT DISTINCT extract(month FROM activity_date)::int AS month, extract(day FROM activity_date)::int AS day
       FROM records
       WHERE tree_id = $1 AND type = 'activity' AND ${IN_YEAR('activity_date')}`,
      [id, year],
    ),
    // 별: 공개 이야기 글 (한국 시간 날짜)
    pool.query<{ id: number; month: number; day: number }>(
      `SELECT e.id,
              extract(month FROM e.created_at AT TIME ZONE '${TIME_ZONE}')::int AS month,
              extract(day FROM e.created_at AT TIME ZONE '${TIME_ZONE}')::int AS day
       FROM story_entries e JOIN stories s ON s.id = e.story_id
       WHERE s.tree_id = $1 AND e.is_public AND ${IN_YEAR(`(e.created_at AT TIME ZONE '${TIME_ZONE}')`)}
       ORDER BY e.created_at`,
      [id, year],
    ),
    // 표식: 신고 접수·조치 완료 (구청-BE가 만든 공용 함수, #21)
    monthlyIncidentMarkers(pool, id, year),
    // 표식: 받은 호응 (#65). 남긴 날(reacted_on, 한국 날짜) 기준
    pool.query<{ month: number; count: number }>(
      `SELECT extract(month FROM x.reacted_on)::int AS month, count(*)::int AS count
       FROM story_reactions x
       JOIN story_entries e ON e.id = x.story_entry_id
       JOIN stories s ON s.id = e.story_id
       WHERE s.tree_id = $1 AND ${IN_YEAR('x.reacted_on')}
       GROUP BY 1`,
      [id, year],
    ),
  ]);

  const view: TreeRingsView = {
    treeId: id,
    year,
    months: buildRingMonths({
      weather: weather.rows.map((w) => ({ month: w.month, rainMm: w.rain_mm, tempMaxAvg: w.temp_max_avg, heatDays: w.heat_days })),
      care: care.rows,
      activityDays: activityDays.rows,
      stories: stories.rows,
      incidents,
      reactions: reactions.rows,
    }),
  };
  res.json(view);
});
