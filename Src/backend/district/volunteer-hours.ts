// #69 내 봉사시간 조회 (시민 화면용, 로그인한 본인만)
// 봉사시간 기록은 구청-BE가 하므로 조회도 이 이슈에서 만든다. 경로는 /admin 밖(/volunteer-hours)이다.
// 봉사시간은 개인정보라 본인 것만 돌려준다(CLAUDE.md 절대 규칙).
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool } from '../common/db.js';
import { HttpError } from '../common/errors.js';

const query = z.object({
  // 기록된 해(한국 시간 기준). 없으면 전체
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const volunteerHoursRouter = Router();

volunteerHoursRouter.use(authenticate);

volunteerHoursRouter.get('/me', async (req, res) => {
  const user = req.user;
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', '로그인이 필요하다.');
  const { year } = query.parse(req.query);

  const { rows } = await getPool().query(
    `SELECT v.id, v.minutes, v.recorded_at, m.id AS report_id, m.agency, m.submitted_at,
            (SELECT min(r.activity_date) FROM records r WHERE r.monthly_report_id = m.id) AS first_date,
            (SELECT max(r.activity_date) FROM records r WHERE r.monthly_report_id = m.id) AS last_date
     FROM volunteer_hours v
     JOIN monthly_reports m ON m.id = v.monthly_report_id
     WHERE v.user_id = $1
       AND ($2::int IS NULL OR extract(year FROM v.recorded_at AT TIME ZONE 'Asia/Seoul') = $2)
     ORDER BY v.recorded_at DESC, v.id DESC`,
    [user.id, year ?? null],
  );

  const items = rows.map((r) => ({
    id: r.id,
    minutes: r.minutes,
    recordedAt: (r.recorded_at as Date).toISOString(),
    monthlyReport: {
      id: r.report_id,
      agency: r.agency,
      submittedAt: (r.submitted_at as Date).toISOString(),
      firstDate: r.first_date,
      lastDate: r.last_date,
    },
  }));
  res.json({ totalMinutes: items.reduce((sum, i) => sum + i.minutes, 0), items });
});
