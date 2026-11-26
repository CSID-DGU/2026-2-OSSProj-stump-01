// #65 QR 호응: 지나가는 시민이 이야기 글에 로그인 없이 남기는 좋아요·한 줄 응답 (Src/용어.md "받은 호응")
// - 로그인이 없어 기기를 deviceKey 로 구분한다. 시민 웹이 기기마다 무작위 값을 한 번 만들어 두고 계속 보낸다.
//   같은 기기는 글 하나에 하루(한국 날짜) 한 번만 남길 수 있다 → DB 유니크 제약 story_reactions_once_a_day 가 막는다.
//   deviceKey 는 개인정보가 아니지만 응답·알림 어디에도 내보내지 않는다.
// - 남기면 글쓴 돌보미에게 알림(story_reaction)이 가고, 나이테 표식(GET /trees/{id}/rings 의 reactions)에 센다.
// - 한 줄 응답 내용은 글쓴 돌보미만 본다(알림, GET /me/reactions). 이야기 페이지에는 수만 보인다.
// - 순위 집계에는 쓰지 않는다.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool, withTransaction } from '../common/db.js';
import { HttpError, notFound } from '../common/errors.js';
import { createNotification } from '../common/notifications.js';
import { treeNameSql } from '../common/tree-name.js';

// ── 기준값 ──
export const REPLY_MAX_LENGTH = 80; // 한 줄 응답 글자 수 (Src/용어.md)
const DEVICE_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/; // 시민 웹이 만드는 무작위 값 (예: crypto.randomUUID())
const MY_REACTIONS_DEFAULT_LIMIT = 50;
const MY_REACTIONS_MAX_LIMIT = 100;

// ── 요청 형식 ──
const idParam = z.object({ id: z.coerce.number().int().positive() });
const reactionBody = z
  .object({
    kind: z.enum(['like', 'reply']), // 좋아요 / 한 줄 응답
    body: z.string().trim().min(1).max(REPLY_MAX_LENGTH).optional(), // 한 줄 응답일 때만
    deviceKey: z.string().regex(DEVICE_KEY_PATTERN, '기기 값은 영문·숫자·-·_ 16~64자다.'),
  })
  .refine((b) => (b.kind === 'reply') === (b.body !== undefined), {
    path: ['body'],
    message: '한 줄 응답은 내용이 있어야 하고, 좋아요에는 내용을 넣지 않는다.',
  });
const myReactionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MY_REACTIONS_MAX_LIMIT).default(MY_REACTIONS_DEFAULT_LIMIT),
});

// ── 응답 형식 ──
export type ReactionCreatedView = {
  id: number;
  kind: 'like' | 'reply';
  body: string | null;
  createdAt: string;
  likeCount: number; // 남긴 뒤 그 글의 좋아요 수 (화면이 바로 고쳐 보이도록)
  replyCount: number;
};

export type MyReactionView = {
  id: number;
  kind: 'like' | 'reply';
  body: string | null;
  createdAt: string;
  entry: { id: number };
  tree: { id: number; name: string };
};

/** 알림 문구. 한 줄 응답이면 내용을 함께 보여 준다 */
function notificationText(kind: 'like' | 'reply', treeName: string, body: string | null) {
  return {
    title: '이야기에 호응이 왔어요',
    body:
      kind === 'like'
        ? `${treeName}에 남긴 이야기에 좋아요가 왔어요.`
        : `${treeName}에 남긴 이야기에 한 줄 응답이 왔어요: "${body}"`,
  };
}

const isOnceADayViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && 'constraint' in err && err.constraint === 'story_reactions_once_a_day';

// ── 글에 호응 남기기 (/story-entries/:id/reactions) ──
export const storyReactionsRouter = Router();

storyReactionsRouter.post('/:id/reactions', async (req, res) => {
  const { id: entryId } = idParam.parse(req.params);
  const body = reactionBody.parse(req.body);

  const created = await withTransaction(async (db) => {
    // 공개 글만 호응을 받는다. 비공개 글은 없는 글처럼 404
    const { rows: entries } = await db.query<{ author_id: number; tree_id: number; tree_name: string }>(
      `SELECT e.user_id AS author_id, t.id AS tree_id, ${treeNameSql('t')} AS tree_name
       FROM story_entries e JOIN stories s ON s.id = e.story_id JOIN trees t ON t.id = s.tree_id
       WHERE e.id = $1 AND e.is_public`,
      [entryId],
    );
    const entry = entries[0];
    if (!entry) throw notFound('이야기 글을 찾을 수 없다.');

    let reaction: { id: number; created_at: Date };
    try {
      const { rows } = await db.query<{ id: number; created_at: Date }>(
        `INSERT INTO story_reactions (story_entry_id, kind, body, device_key) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
        [entryId, body.kind, body.body ?? null, body.deviceKey],
      );
      reaction = rows[0]!;
    } catch (err) {
      if (isOnceADayViolation(err)) throw new HttpError(409, 'ALREADY_REACTED', '이 기기에서는 오늘 이 글에 이미 호응을 남겼다.');
      throw err;
    }

    // 같은 트랜잭션: 알림을 못 만들면 호응도 남기지 않는다
    await createNotification(db, {
      userId: entry.author_id,
      type: 'story_reaction',
      treeId: entry.tree_id,
      ...notificationText(body.kind, entry.tree_name, body.body ?? null),
    });

    const { rows: counts } = await db.query<{ like_count: number; reply_count: number }>(
      `SELECT count(*) FILTER (WHERE kind = 'like')::int AS like_count, count(*) FILTER (WHERE kind = 'reply')::int AS reply_count
       FROM story_reactions WHERE story_entry_id = $1`,
      [entryId],
    );
    return { reaction, counts: counts[0]! };
  });

  const view: ReactionCreatedView = {
    id: created.reaction.id,
    kind: body.kind,
    body: body.body ?? null,
    createdAt: created.reaction.created_at.toISOString(),
    likeCount: created.counts.like_count,
    replyCount: created.counts.reply_count,
  };
  res.status(201).json(view);
});

// ── 내가 받은 호응 (/me/reactions) ──
export const meRouter = Router();

meRouter.get('/reactions', authenticate, async (req, res) => {
  const { limit } = myReactionsQuery.parse(req.query);
  const { rows } = await getPool().query<{
    id: number;
    kind: 'like' | 'reply';
    body: string | null;
    created_at: Date;
    entry_id: number;
    tree_id: number;
    tree_name: string;
  }>(
    `SELECT x.id, x.kind, x.body, x.created_at, e.id AS entry_id, t.id AS tree_id, ${treeNameSql('t')} AS tree_name
     FROM story_reactions x
     JOIN story_entries e ON e.id = x.story_entry_id
     JOIN stories s ON s.id = e.story_id
     JOIN trees t ON t.id = s.tree_id
     WHERE e.user_id = $1
     ORDER BY x.created_at DESC, x.id DESC
     LIMIT $2`,
    [req.user!.id, limit],
  );
  const reactions: MyReactionView[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    body: r.body,
    createdAt: r.created_at.toISOString(),
    entry: { id: r.entry_id },
    tree: { id: r.tree_id, name: r.tree_name },
  }));
  res.json({ reactions });
});
