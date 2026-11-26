// #143 단체 관심 구간과 구간 리포트 (서울환경연합 피드백: 여러 돌보미의 기록을 구간·거리 단위로 묶어 보고, 단체 이름으로 내보낸다)
// - 단체 관리자가 관심 구간(자치구 + 길)을 추가·삭제하고, 단체 회원은 구간과 리포트를 본다
// - 리포트는 그 구간의 "모든 돌보미"(단체 회원이 아니어도) 활동을 나무·구간 단위 익명 합계로 준다.
//   사람(이름·별명·id)·사진·메모는 담지 않는다(절대 규칙: 다른 참여자의 신원은 익명 합계로만)
// - 익명 합계만 보이므로 구청 승인 없이 누구나 단체를 열어도 노출 위험이 낮다(구청 업무를 늘리지 않는 경로)
// - 단체는 읽기만 하고 기록·신청서의 상태를 바꾸지 않는다(CLAUDE.md 경계 규칙)
import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { activeCaregiverSql, activityInMonthSql } from '../common/care-gaps.js';
import { getPool } from '../common/db.js';
import { HttpError, notFound } from '../common/errors.js';
import { treeNameSql } from '../common/tree-name.js';
import { minutesToHours, toCsv, type Cell } from '../district/csv.js'; // 구청-BE(#73)의 CSV 함수를 그대로 쓴다
import { buildSectionReport, type SectionReport, type TreeStatus } from './section-report.js';

// ── 기준값 ──
export const MAX_SECTIONS_PER_ORGANIZATION = 20; // 단체당 관심 구간 수 (임시값)
const TIME_ZONE = 'Asia/Seoul';
const PLACE_SQL = (t: string) => `COALESCE(${t}.road_name, ${t}.dong, ${t}.district)`; // 구간의 "길" (common/tree-name.ts 와 같은 기준)

// ── 요청 형식 ──
const idParam = z.object({ id: z.coerce.number().int().positive() });
const sectionParam = z.object({ id: z.coerce.number().int().positive(), sectionId: z.coerce.number().int().positive() });
const sectionBody = z.object({
  district: z.string().trim().min(1).max(20), // 자치구 (예: 중구)
  place: z.string().trim().min(1).max(100), // 길 (나무의 노선명 → 동 → 자치구 중 있는 것. 예: 소파로)
});
const reportQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '달은 YYYY-MM 형식이다.'),
  format: z.enum(['json', 'csv']).default('json'),
});

// ── 응답 형식 ──
export type SectionListItem = { id: number; district: string; place: string; treeCount: number; createdAt: string };
export type SectionReportView = SectionReport & { organization: { id: number; name: string }; month: string };

const STATUS_LABEL: Record<TreeStatus, string> = { cared: '돌봄 중', inactive: '활동 끊김', no_caregiver: '돌보미 없음' };

/** 단체와 내 역할. 없는 단체 404, 회원이 아니면 403 */
async function membership(organizationId: number, userId: number) {
  const { rows } = await getPool().query<{ name: string; role: 'admin' | 'member' | null }>(
    `SELECT o.name, (SELECT m.role FROM organization_members m WHERE m.organization_id = o.id AND m.user_id = $2) AS role
     FROM organizations o WHERE o.id = $1`,
    [organizationId, userId],
  );
  const org = rows[0];
  if (!org) throw notFound('단체를 찾을 수 없다.');
  if (!org.role) throw new HttpError(403, 'FORBIDDEN', '이 단체의 회원만 볼 수 있다.');
  return { name: org.name, role: org.role };
}

async function requireAdmin(organizationId: number, userId: number) {
  const m = await membership(organizationId, userId);
  if (m.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '단체 관리자만 관심 구간을 바꿀 수 있다.');
  return m;
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && 'constraint' in err && err.constraint === 'organization_sections_unique';

/** 단체 이름이 든 엑셀용 CSV: 머리말 → 구간 합계 표 → 나무별 표 */
function sectionReportCsv(view: SectionReportView): string {
  const now = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, dateStyle: 'short', timeStyle: 'short' }).format(new Date());
  const rows: Cell[][] = [
    ['단체', view.organization.name],
    ['기간', view.month],
    ['만든 시각', now],
    ['안내', '관심 구간의 모든 돌보미 활동을 익명 합계로 묶었습니다. 개인 정보는 담지 않습니다.'],
    [],
    ['자치구', '구간', '나무 수', '돌보미 있는 나무', '활동 끊긴 나무', '돌보미 없는 나무', '돌보미 수', '활동 횟수', '활동 시간(시간)', '활동한 날', '신고 접수', '조치 완료'],
    ...view.sections.map((s) => [
      s.district,
      s.place,
      s.treeCount,
      s.caredTreeCount,
      s.inactiveTreeCount,
      s.noCaregiverTreeCount,
      s.caregiverCount,
      s.activityCount,
      minutesToHours(s.minutes),
      s.activityDays,
      s.reported,
      s.resolved,
    ]),
    [],
    ['자치구', '구간', '나무', '상태', '돌보미 수', '활동 횟수', '활동 시간(시간)', '활동한 날', '마지막 활동', '신고 접수', '조치 완료'],
    ...view.sections.flatMap((s) =>
      s.trees.map((t) => [
        s.district,
        s.place,
        t.name,
        STATUS_LABEL[t.status],
        t.caregiverCount,
        t.activityCount,
        minutesToHours(t.minutes),
        t.activityDays,
        t.lastActivityDate,
        t.reported,
        t.resolved,
      ]),
    ),
  ];
  return toCsv(rows);
}

function sendCsv(res: Response, view: SectionReportView, content: string) {
  const asciiName = `treecare-org${view.organization.id}-sections-${view.month}.csv`;
  const koreanName = encodeURIComponent(`${view.organization.name}_관심구간_${view.month}.csv`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${koreanName}`);
  res.send(content);
}

// ── 라우터 (/organizations) ──
export const organizationSectionsRouter = Router();
organizationSectionsRouter.use(authenticate);

// 관심 구간 목록 (단체 회원)
organizationSectionsRouter.get('/:id/sections', async (req, res) => {
  const { id } = idParam.parse(req.params);
  await membership(id, req.user!.id);
  const { rows } = await getPool().query<{ id: number; district: string; place: string; tree_count: number; created_at: Date }>(
    `SELECT s.id, s.district, s.place, s.created_at,
            (SELECT count(*)::int FROM trees t WHERE t.district = s.district AND ${PLACE_SQL('t')} = s.place) AS tree_count
     FROM organization_sections s WHERE s.organization_id = $1 ORDER BY s.created_at, s.id`,
    [id],
  );
  const sections: SectionListItem[] = rows.map((r) => ({
    id: r.id,
    district: r.district,
    place: r.place,
    treeCount: r.tree_count,
    createdAt: r.created_at.toISOString(),
  }));
  res.json({ sections });
});

// 관심 구간 추가 (단체 관리자). 나무가 있는 구간만
organizationSectionsRouter.post('/:id/sections', async (req, res) => {
  const { id } = idParam.parse(req.params);
  await requireAdmin(id, req.user!.id);
  const { district, place } = sectionBody.parse(req.body);
  const pool = getPool();

  const { rows: trees } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM trees t WHERE t.district = $1 AND ${PLACE_SQL('t')} = $2`,
    [district, place],
  );
  const treeCount = trees[0]!.n;
  if (treeCount === 0) throw notFound('그 구간에 가로수가 없다. 자치구와 길 이름(노선명)을 확인한다.');

  const { rows: count } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM organization_sections WHERE organization_id = $1', [id]);
  if (count[0]!.n >= MAX_SECTIONS_PER_ORGANIZATION) {
    throw new HttpError(400, 'SECTION_LIMIT', `관심 구간은 단체당 ${MAX_SECTIONS_PER_ORGANIZATION}개까지다.`);
  }

  try {
    const { rows } = await pool.query<{ id: number; created_at: Date }>(
      'INSERT INTO organization_sections (organization_id, district, place) VALUES ($1, $2, $3) RETURNING id, created_at',
      [id, district, place],
    );
    const item: SectionListItem = { id: rows[0]!.id, district, place, treeCount, createdAt: rows[0]!.created_at.toISOString() };
    res.status(201).json(item);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'SECTION_EXISTS', '이미 관심 구간이다.');
    throw err;
  }
});

// 관심 구간 지우기 (단체 관리자)
organizationSectionsRouter.delete('/:id/sections/:sectionId', async (req, res) => {
  const { id, sectionId } = sectionParam.parse(req.params);
  await requireAdmin(id, req.user!.id);
  const { rowCount } = await getPool().query('DELETE FROM organization_sections WHERE id = $1 AND organization_id = $2', [sectionId, id]);
  if (!rowCount) throw notFound('이 단체의 관심 구간이 아니다.');
  res.status(204).end();
});

// 구간 리포트 (단체 회원). format=csv 면 단체 이름이 든 CSV 파일
organizationSectionsRouter.get('/:id/section-report', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { month, format } = reportQuery.parse(req.query);
  const org = await membership(id, req.user!.id);
  const pool = getPool();

  // m.start = 그 달 1일. 사각지대 판정은 common/care-gaps.ts 와 같은 정의를 쓴다
  const FROM_SECTION_TREES = `
    FROM organization_sections s
    CROSS JOIN (SELECT to_date($2, 'YYYY-MM') AS start) m
    JOIN trees t ON t.district = s.district AND ${PLACE_SQL('t')} = s.place
    WHERE s.organization_id = $1`;
  const IN_MONTH = (col: string) => `${col} >= m.start AND ${col} < m.start + interval '1 month'`;

  const [sections, trees, caregivers] = await Promise.all([
    pool.query<{ id: number; district: string; place: string }>(
      'SELECT id, district, place FROM organization_sections WHERE organization_id = $1 ORDER BY created_at, id',
      [id],
    ),
    pool.query<{
      section_id: number;
      tree_id: number;
      name: string;
      place_no: number | null;
      caregiver_count: number;
      activity_count: number;
      minutes: number;
      activity_dates: string[];
      reported: number;
      resolved: number;
    }>(
      `SELECT s.id AS section_id, t.id AS tree_id, ${treeNameSql('t')} AS name, t.place_no,
              (SELECT count(*)::int FROM caregiver_applications a WHERE a.tree_id = t.id AND ${activeCaregiverSql('a', 'm.start')}) AS caregiver_count,
              (SELECT count(*)::int FROM records r WHERE r.tree_id = t.id AND ${activityInMonthSql('r', 'm.start')}) AS activity_count,
              (SELECT COALESCE(sum(r.duration_min), 0)::int FROM records r WHERE r.tree_id = t.id AND ${activityInMonthSql('r', 'm.start')}) AS minutes,
              (SELECT COALESCE(array_agg(DISTINCT to_char(r.activity_date, 'YYYY-MM-DD')), '{}')
                 FROM records r WHERE r.tree_id = t.id AND ${activityInMonthSql('r', 'm.start')}) AS activity_dates,
              (SELECT count(*)::int FROM reports p JOIN records rc ON rc.id = p.record_id
                WHERE rc.tree_id = t.id AND ${IN_MONTH(`(p.created_at AT TIME ZONE '${TIME_ZONE}')`)}) AS reported,
              (SELECT count(*)::int FROM reports p JOIN records rc ON rc.id = p.record_id
                WHERE rc.tree_id = t.id AND p.resolved_at IS NOT NULL AND ${IN_MONTH(`(p.resolved_at AT TIME ZONE '${TIME_ZONE}')`)}) AS resolved
       ${FROM_SECTION_TREES}`,
      [id, month],
    ),
    // 구간마다 그 달 돌보미 수: 한 사람이 여러 그루를 돌봐도 한 명 (누군지는 세기만 하고 내보내지 않는다)
    pool.query<{ section_id: number; caregiver_count: number }>(
      `SELECT s.id AS section_id, count(DISTINCT a.user_id)::int AS caregiver_count
       ${FROM_SECTION_TREES.replace('WHERE s.organization_id = $1', `JOIN caregiver_applications a ON a.tree_id = t.id AND ${activeCaregiverSql('a', 'm.start')}
    WHERE s.organization_id = $1`)}
       GROUP BY s.id`,
      [id, month],
    ),
  ]);

  const view: SectionReportView = {
    organization: { id, name: org.name },
    month,
    ...buildSectionReport(
      sections.rows,
      trees.rows.map((t) => ({
        sectionId: t.section_id,
        treeId: t.tree_id,
        name: t.name,
        placeNo: t.place_no,
        caregiverCount: t.caregiver_count,
        activityCount: t.activity_count,
        minutes: t.minutes,
        activityDates: t.activity_dates,
        reported: t.reported,
        resolved: t.resolved,
      })),
      caregivers.rows.map((c) => ({ sectionId: c.section_id, caregiverCount: c.caregiver_count })),
    ),
  };
  if (format === 'csv') sendCsv(res, view, sectionReportCsv(view));
  else res.json(view);
});
