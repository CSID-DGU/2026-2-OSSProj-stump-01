// #5 날짜별 활동 기록·이상 신고 생성 (시민)
// - 활동 기록(type=activity): 그 나무에 승인된 돌보미만, 오늘이 활동 기간 안일 때 남긴다. 활동일은 서버가 오늘(한국 시간)로 정한다.
//   월간 보고서(#62)가 이 기록을 모은다.
// - 이상 신고(type=report): 로그인한 시민이면 누구나 한다. '확인 필요'(pending)로 그 나무 관리청의 신고 처리 큐에 들어간다.
//   공개 게시판처럼 보여 주지 않고, 상태 변경·조치 완료 알림은 구청-BE가 한다(CLAUDE.md 경계 규칙).
// 사진은 multipart/form-data 의 photos 칸으로 3장까지 받는다(common/uploads.ts).
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool, withTransaction } from '../common/db.js';
import { HttpError, notFound } from '../common/errors.js';
import { photoUpload, photoUrl, removeUploadedFiles, uploadedFiles } from '../common/uploads.js';

// ── 기준값 (구청 보고서 양식 확인 전 임시값, #59) ──
const MAX_ACTIVITY_KINDS = 5; // 한 기록의 '한 일' 개수
const ACTIVITY_KIND_MAX_LENGTH = 30;
const MAX_DURATION_MIN = 600; // 하루 활동 시간 상한 (10시간)
const MEMO_MAX_LENGTH = 200; // 짧은 글 (시민 웹 NOTE_MAX_LENGTH 와 같다)
const KIND_SEPARATOR = ', '; // '한 일' 여러 개를 records.activity_kind 한 칸에 이어 저장한다
const TIME_ZONE = 'Asia/Seoul'; // 활동일·"이번 달"은 한국 시간 달력 기준

// 신고 유형 → 긴급도. 시민이 고르지 않고 유형으로 정한다(db/ERD.md "신고 유형과 긴급도").
const URGENCY_BY_CATEGORY = {
  leaning: 'high', // 기울어짐·쓰러짐
  broken_branch: 'high', // 가지 꺾임
  pest: 'low', // 병해충 의심
  withering: 'low', // 시듦·고사 의심
  other: 'low', // 기타
} as const;
type ReportCategory = keyof typeof URGENCY_BY_CATEGORY;
const REPORT_CATEGORIES = Object.keys(URGENCY_BY_CATEGORY) as [ReportCategory, ...ReportCategory[]];

/** 오늘 날짜(한국 시간) 'YYYY-MM-DD' */
function seoulToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });
}

// ── 요청 형식 (multipart 라 숫자도 글자로 온다) ──
const memo = z
  .string()
  .trim()
  .max(MEMO_MAX_LENGTH)
  .optional()
  .transform((v) => v || null);
const treeId = z.coerce.number().int().positive();

const activityBody = z.object({
  type: z.literal('activity'),
  treeId,
  // 같은 이름으로 여러 번 보내면 배열, 한 번이면 글자 하나로 온다
  activityKinds: z.preprocess(
    (v) => (typeof v === 'string' ? [v] : v),
    z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(ACTIVITY_KIND_MAX_LENGTH)
          .refine((k) => !k.includes(','), '한 일에는 쉼표를 쓸 수 없다.'),
      )
      .min(1)
      .max(MAX_ACTIVITY_KINDS),
  ),
  durationMin: z.coerce.number().int().min(1).max(MAX_DURATION_MIN),
  memo,
});

const reportBody = z
  .object({
    type: z.literal('report'),
    treeId,
    category: z.enum(REPORT_CATEGORIES),
    memo,
    // 신고할 때 내 위치 (선택). 둘 다 보내거나 둘 다 빼야 한다
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine((b) => (b.lat === undefined) === (b.lng === undefined), {
    path: ['lng'],
    message: '위도와 경도는 함께 보내야 한다.',
  });

const recordBody = z.discriminatedUnion('type', [activityBody, reportBody]);

const monthQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식')
    .optional(),
});

// ── 응답 형식 ──
type ReportStatus = 'pending' | 'inspecting' | 'resolved'; // 확인 필요 / 현장 확인 / 조치 완료

export type RecordView = {
  id: number;
  type: 'activity' | 'report';
  recordedAt: string;
  activityDate: string | null; // 활동 기록만
  activityKinds: string[]; // 한 일 (활동 기록만, 신고는 빈 배열)
  durationMin: number | null;
  memo: string | null;
  photos: string[]; // /uploads/... 올린 순서대로
  location: { lat: number; lng: number } | null; // 신고한 위치
  monthlyReportId: number | null; // 월간 보고서에 넣었으면 그 보고서 id
  report: { category: ReportCategory; urgency: 'low' | 'high'; status: ReportStatus } | null;
  tree: { id: number; code: string | null; species: string; district: string; dong: string | null; roadName: string | null };
};

// 생성 응답과 내 기록 목록이 같은 모양을 쓰도록 SELECT를 하나로 둔다. $1 = 기록한 시민
const SELECT_MY_RECORD = `
  SELECT r.id, r.type, r.recorded_at, r.activity_date, r.activity_kind, r.duration_min, r.memo, r.monthly_report_id,
         ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
         (SELECT coalesce(json_agg(p.url ORDER BY p.position), '[]'::json) FROM record_photos p WHERE p.record_id = r.id) AS photos,
         rp.category, rp.urgency, rp.status AS report_status,
         t.id AS tree_id, t.code, t.species, t.district, t.dong, t.road_name
  FROM records r
  JOIN trees t ON t.id = r.tree_id
  LEFT JOIN reports rp ON rp.record_id = r.id
  WHERE r.user_id = $1`;

type RecordRow = {
  id: number;
  type: 'activity' | 'report';
  recorded_at: Date;
  activity_date: string | null;
  activity_kind: string | null;
  duration_min: number | null;
  memo: string | null;
  monthly_report_id: number | null;
  lat: number | null;
  lng: number | null;
  photos: string[];
  category: ReportCategory | null;
  urgency: 'low' | 'high' | null;
  report_status: ReportStatus | null;
  tree_id: number;
  code: string | null;
  species: string;
  district: string;
  dong: string | null;
  road_name: string | null;
};

function toView(r: RecordRow): RecordView {
  return {
    id: r.id,
    type: r.type,
    recordedAt: r.recorded_at.toISOString(),
    activityDate: r.activity_date,
    activityKinds: r.activity_kind ? r.activity_kind.split(KIND_SEPARATOR) : [],
    durationMin: r.duration_min,
    memo: r.memo,
    photos: r.photos,
    location: r.lat === null || r.lng === null ? null : { lat: r.lat, lng: r.lng },
    monthlyReportId: r.monthly_report_id,
    report: r.category && r.urgency && r.report_status ? { category: r.category, urgency: r.urgency, status: r.report_status } : null,
    tree: { id: r.tree_id, code: r.code, species: r.species, district: r.district, dong: r.dong, roadName: r.road_name },
  };
}

// ── 라우터 (/records) ──
export const recordsRouter = Router();
recordsRouter.use(authenticate);

// 기록 만들기. 사진을 먼저 저장하고, 검증·권한에서 막히면 저장한 사진을 지운다.
recordsRouter.post('/', photoUpload(), async (req, res) => {
  try {
    const { id: userId, role } = req.user!;
    if (role !== 'citizen') throw new HttpError(403, 'FORBIDDEN', '시민 계정만 기록할 수 있다.');
    const body = recordBody.parse(req.body);
    const photos = uploadedFiles(req).map(photoUrl);

    const recordId = await withTransaction(async (db) => {
      let id: number;
      if (body.type === 'activity') {
        const today = seoulToday();
        const { rowCount } = await db.query(
          `SELECT 1 FROM caregiver_applications
           WHERE user_id = $1 AND tree_id = $2 AND status = 'approved' AND $3::date BETWEEN period_start AND period_end`,
          [userId, body.treeId, today],
        );
        if (!rowCount) throw new HttpError(403, 'FORBIDDEN', '이 나무의 승인된 돌보미만 활동 기간 안에 기록할 수 있다.');

        const { rows } = await db.query<{ id: number }>(
          `INSERT INTO records (tree_id, user_id, type, activity_date, activity_kind, duration_min, memo, photo_url)
           VALUES ($1, $2, 'activity', $3, $4, $5, $6, $7) RETURNING id`,
          [body.treeId, userId, today, body.activityKinds.join(KIND_SEPARATOR), body.durationMin, body.memo, photos[0] ?? null],
        );
        id = rows[0]!.id;
      } else {
        const { rows: trees } = await db.query<{ agency: string }>('SELECT agency FROM trees WHERE id = $1', [body.treeId]);
        if (!trees[0]) throw notFound('나무를 찾을 수 없다.');

        const { rows } = await db.query<{ id: number }>(
          `INSERT INTO records (tree_id, user_id, type, memo, photo_url, location)
           VALUES ($1, $2, 'report', $3, $4,
                   CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography END)
           RETURNING id`,
          [body.treeId, userId, body.memo, photos[0] ?? null, body.lat ?? null, body.lng ?? null],
        );
        id = rows[0]!.id;
        // 신뢰도: 신고할 때의 교육 이수 여부를 복사해 둔다(db/ERD.md)
        await db.query(
          `INSERT INTO reports (record_id, category, urgency, agency, is_trusted)
           SELECT $1, $2, $3, $4, education_completed_at IS NOT NULL FROM users WHERE id = $5`,
          [id, body.category, URGENCY_BY_CATEGORY[body.category], trees[0].agency, userId],
        );
      }

      for (const [i, url] of photos.entries()) {
        await db.query('INSERT INTO record_photos (record_id, url, position) VALUES ($1, $2, $3)', [id, url, i + 1]);
      }
      return id;
    });

    const { rows } = await getPool().query<RecordRow>(`${SELECT_MY_RECORD} AND r.id = $2`, [userId, recordId]);
    res.status(201).json(toView(rows[0]!));
  } catch (err) {
    await removeUploadedFiles(req);
    throw err;
  }
});

// 내 기록: 고른 달(기본 이번 달, 한국 시간)의 활동 기록과 신고. 최신순
recordsRouter.get('/me', async (req, res) => {
  const month = monthQuery.parse(req.query).month ?? seoulToday().slice(0, 7);
  const { rows } = await getPool().query<RecordRow>(
    `SELECT * FROM (${SELECT_MY_RECORD}) x
     WHERE to_char(COALESCE(x.activity_date, (x.recorded_at AT TIME ZONE '${TIME_ZONE}')::date), 'YYYY-MM') = $2
     ORDER BY COALESCE(x.activity_date, (x.recorded_at AT TIME ZONE '${TIME_ZONE}')::date) DESC, x.recorded_at DESC, x.id DESC`,
    [req.user!.id, month],
  );
  res.json({ month, records: rows.map(toView) });
});
