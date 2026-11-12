// #20 이상 신고 처리 큐 (구청)
// 신고 생성은 시민-BE, 상태 변경은 구청-BE가 한다(CLAUDE.md 경계 규칙). DB 테이블은 reports다.
// 월간 보고서(monthly-reports)와 헷갈리지 않게 API에서는 incident-reports라고 부른다.
// 신고는 공개 게시하지 않는다. 이 API는 구청 담당자만, 자기 관리청(reports.agency)에 배정된 신고만 본다.
// #21 조치 완료 후처리: 조치 완료하면 신고자와 그 나무의 돌보미에게 개별 알림을 보낸다(같은 트랜잭션).
// 나이테의 신고·조치 표식은 reports.created_at·resolved_at으로 집계한다(common/incident-markers.ts).
import { Router } from 'express';
import { z } from 'zod';
import { officerOf } from '../common/auth.js';
import { getPool, withTransaction, type Db } from '../common/db.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { createNotification } from '../common/notifications.js';

// ── 기준값 ──
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const ACTION_NOTE_MAX_LENGTH = 1000;
const TIME_ZONE = 'Asia/Seoul';

const INCIDENT_STATUSES = ['pending', 'inspecting', 'resolved'] as const;
type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** 신고 유형 화면 표시 (ERD.md "신고 유형과 긴급도") */
export const CATEGORY_LABELS: Record<string, string> = {
  leaning: '기울어짐·쓰러짐',
  broken_branch: '가지 꺾임',
  pest: '병해충 의심',
  withering: '시듦·고사 의심',
  other: '기타',
};

// ── 요청 형식 ──
const listQuery = z.object({
  // unresolved = 확인 필요 + 현장 확인 (처리 큐 기본값)
  status: z.enum(['unresolved', ...INCIDENT_STATUSES]).default('unresolved'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

// 상태를 한 단계 넘기거나(현장 확인·조치 완료), 처리 메모만 고친다
const updateBody = z
  .object({
    status: z.enum(['inspecting', 'resolved']).optional(),
    actionNote: z.string().trim().min(1).max(ACTION_NOTE_MAX_LENGTH).optional(),
  })
  .refine((b) => b.status !== undefined || b.actionNote !== undefined, '바꿀 값(status 또는 actionNote)이 없다.');

// 다음 상태로만 넘어간다: pending → inspecting → resolved
const NEXT_FROM: Record<'inspecting' | 'resolved', IncidentStatus> = {
  inspecting: 'pending',
  resolved: 'inspecting',
};

// ── 응답 형식 ──
export type IncidentView = {
  id: number;
  status: IncidentStatus;
  category: string;
  categoryLabel: string;
  urgency: 'low' | 'high';
  isTrusted: boolean; // 신고 시점에 교육을 이수한 신고자인지
  actionNote: string | null;
  createdAt: string;
  inspectedAt: string | null;
  resolvedAt: string | null;
  handledBy: number | null;
  elapsedDays: number; // 접수 후 지난 날 수(한국 날짜 기준). 조치 완료면 완료까지 걸린 날 수
  photoUrl: string | null;
  location: { lat: number; lng: number } | null; // 신고한 위치
  reporter: { id: number; nickname: string };
  tree: {
    id: number;
    species: string;
    roadName: string | null;
    address: string | null;
    location: { lat: number; lng: number };
  };
};

// $1 = 담당자 관리청
const SELECT_INCIDENT = `
  SELECT p.id, p.status, p.category, p.urgency, p.is_trusted, p.action_note,
         p.created_at, p.inspected_at, p.resolved_at, p.handled_by,
         ((coalesce(p.resolved_at, now()) AT TIME ZONE '${TIME_ZONE}')::date
           - (p.created_at AT TIME ZONE '${TIME_ZONE}')::date) AS elapsed_days,
         rc.photo_url, ST_Y(rc.location::geometry) AS lat, ST_X(rc.location::geometry) AS lng,
         u.id AS user_id, u.nickname,
         t.id AS tree_id, t.species, t.road_name, t.address,
         ST_Y(t.location::geometry) AS tree_lat, ST_X(t.location::geometry) AS tree_lng
  FROM reports p
  JOIN records rc ON rc.id = p.record_id
  JOIN users u ON u.id = rc.user_id
  JOIN trees t ON t.id = rc.tree_id
  WHERE p.agency = $1`;

function toView(r: any): IncidentView {
  return {
    id: r.id,
    status: r.status,
    category: r.category,
    categoryLabel: CATEGORY_LABELS[r.category] ?? r.category,
    urgency: r.urgency,
    isTrusted: r.is_trusted,
    actionNote: r.action_note,
    createdAt: r.created_at.toISOString(),
    inspectedAt: r.inspected_at?.toISOString() ?? null,
    resolvedAt: r.resolved_at?.toISOString() ?? null,
    handledBy: r.handled_by,
    elapsedDays: r.elapsed_days,
    photoUrl: r.photo_url,
    location: r.lat === null ? null : { lat: r.lat, lng: r.lng },
    reporter: { id: r.user_id, nickname: r.nickname },
    tree: {
      id: r.tree_id,
      species: r.species,
      roadName: r.road_name,
      address: r.address,
      location: { lat: r.tree_lat, lng: r.tree_lng },
    },
  };
}

export async function findIncident(db: Db, agency: string, id: number): Promise<IncidentView | undefined> {
  const { rows } = await db.query(`${SELECT_INCIDENT} AND p.id = $2`, [agency, id]);
  return rows[0] && toView(rows[0]);
}

/** 나무를 부르는 이름: "노선 수종" (노선이 없으면 주소) */
function treeLabel(tree: IncidentView['tree']): string {
  return `${tree.roadName ?? tree.address ?? ''} ${tree.species}`.trim();
}

/**
 * #21 조치 완료 알림. 신고자와, 그 나무에 지금 승인된 돌보미에게 한 번씩 보낸다.
 * 신고자가 그 나무의 돌보미이기도 하면 신고자 알림 하나만 보낸다.
 */
async function notifyResolved(db: Db, incident: IncidentView): Promise<void> {
  const tree = treeLabel(incident.tree);
  const what = `${tree} ${incident.categoryLabel} 신고`;
  const action = incident.actionNote ? ` 조치 내용: ${incident.actionNote}` : '';

  await createNotification(db, {
    userId: incident.reporter.id,
    type: 'report_resolved',
    treeId: incident.tree.id,
    reportId: incident.id,
    title: '신고하신 나무의 조치가 끝났어요',
    body: `${what}가 조치 완료되었어요.${action}`,
  });

  const { rows } = await db.query<{ user_id: number }>(
    `SELECT DISTINCT user_id FROM caregiver_applications
     WHERE tree_id = $1 AND status = 'approved' AND user_id <> $2`,
    [incident.tree.id, incident.reporter.id],
  );
  for (const { user_id } of rows) {
    await createNotification(db, {
      userId: user_id,
      type: 'report_resolved',
      treeId: incident.tree.id,
      reportId: incident.id,
      title: '돌보는 나무의 신고가 조치되었어요',
      body: `${what}가 조치 완료되었어요.${action}`,
    });
  }
}

// ── 라우터 (/admin/incident-reports) ──
export const incidentReportsRouter = Router();

// 목록: 미처리(확인 필요·현장 확인)는 오래 기다린 순(경과일순), 조치 완료는 최근 완료 순
incidentReportsRouter.get('/', async (req, res) => {
  const { agency } = officerOf(req);
  const { status, limit, offset } = listQuery.parse(req.query);
  const where = status === 'unresolved' ? `p.status <> 'resolved'` : `p.status = '${status}'`; // status는 zod enum으로 검증된 값
  const order = status === 'resolved' ? 'p.resolved_at DESC, p.id DESC' : 'p.created_at ASC, p.id ASC';

  const pool = getPool();
  const [{ rows }, total] = await Promise.all([
    pool.query(`${SELECT_INCIDENT} AND ${where} ORDER BY ${order} LIMIT $2 OFFSET $3`, [agency, limit, offset]),
    pool.query<{ count: number }>(`SELECT count(*) FROM reports p WHERE p.agency = $1 AND ${where}`, [agency]),
  ]);
  res.json({ items: rows.map(toView), total: total.rows[0]!.count, limit, offset });
});

// 상세
incidentReportsRouter.get('/:id', async (req, res) => {
  const { agency } = officerOf(req);
  const { id } = idParam.parse(req.params);
  const incident = await findIncident(getPool(), agency, id);
  if (!incident) throw notFound('신고를 찾을 수 없다.');
  res.json(incident);
});

// 처리: 상태를 한 단계 넘기거나 처리 메모를 고친다. 조치 완료에는 조치 내용(처리 메모)이 필요하다.
incidentReportsRouter.patch('/:id', async (req, res) => {
  const officer = officerOf(req);
  const { id } = idParam.parse(req.params);
  const body = updateBody.parse(req.body);

  const incident = await withTransaction(async (db) => {
    const { rows } = await db.query<{ status: IncidentStatus; action_note: string | null }>(
      'SELECT status, action_note FROM reports WHERE id = $1 AND agency = $2 FOR UPDATE',
      [id, officer.agency],
    );
    const current = rows[0];
    if (!current) throw notFound('신고를 찾을 수 없다.');
    if (current.status === 'resolved') throw conflict('이미 조치 완료한 신고다.');

    if (body.status) {
      if (current.status !== NEXT_FROM[body.status]) {
        throw conflict(`지금 상태(${current.status})에서는 ${body.status}로 바꿀 수 없다. 확인 필요 → 현장 확인 → 조치 완료 순서로 바꾼다.`);
      }
      if (body.status === 'resolved' && !(body.actionNote ?? current.action_note)) {
        throw badRequest('조치 완료에는 조치 내용(actionNote)이 필요하다.');
      }
    }

    await db.query(
      `UPDATE reports SET
         status       = coalesce($2, status),
         action_note  = coalesce($3, action_note),
         handled_by   = $4,
         inspected_at = CASE WHEN $2 = 'inspecting' THEN now() ELSE inspected_at END,
         resolved_at  = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END
       WHERE id = $1`,
      [id, body.status ?? null, body.actionNote ?? null, officer.id],
    );
    const updated = (await findIncident(db, officer.agency, id))!;
    if (body.status === 'resolved') await notifyResolved(db, updated); // #21
    return updated;
  });

  res.json(incident);
});
