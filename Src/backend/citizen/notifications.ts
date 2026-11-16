// #7 알림 모듈: 내 알림 목록·읽음 처리.
// 알림 생성은 common/notifications.ts 의 createNotification 이다. 구청-BE 는 그 함수만 호출한다(CLAUDE.md 경계 규칙).
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool } from '../common/db.js';
import { notFound } from '../common/errors.js';
import type { NotificationType } from '../common/notifications.js';

// ── 기준값 ──
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });

export type NotificationView = {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  treeId: number | null;
  reportId: number | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  tree_id: number | null;
  report_id: number | null;
  read_at: Date | null;
  created_at: Date;
};

function toView(r: NotificationRow): NotificationView {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    treeId: r.tree_id,
    reportId: r.report_id,
    readAt: r.read_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  };
}

// ── 라우터 (/notifications) ──
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

// 내 알림, 최신순. unreadCount 는 limit 과 상관없는 전체 안 읽은 개수
notificationsRouter.get('/', async (req, res) => {
  const { limit, unreadOnly } = listQuery.parse(req.query);
  const userId = req.user!.id;
  const pool = getPool();
  const [{ rows }, unread] = await Promise.all([
    pool.query<NotificationRow>(
      `SELECT id, type, title, body, tree_id, report_id, read_at, created_at
       FROM notifications WHERE user_id = $1 AND ($3::boolean = false OR read_at IS NULL)
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      [userId, limit, unreadOnly],
    ),
    pool.query<{ count: number }>('SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]),
  ]);
  res.json({ notifications: rows.map(toView), unreadCount: unread.rows[0]!.count });
});

// 읽음 처리. 이미 읽은 알림은 그대로 둔다. 남의 알림은 404
notificationsRouter.patch('/:id/read', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await getPool().query<NotificationRow>(
    `UPDATE notifications SET read_at = COALESCE(read_at, now())
     WHERE id = $1 AND user_id = $2
     RETURNING id, type, title, body, tree_id, report_id, read_at, created_at`,
    [id, req.user!.id],
  );
  if (!rows[0]) throw notFound('알림을 찾을 수 없다.');
  res.json(toView(rows[0]));
});
