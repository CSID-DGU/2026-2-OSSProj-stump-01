// #64 나무별 공동 이야기 (시민)
// 이야기(stories)는 나무마다 하나이고, 그 나무의 승인된 돌보미들이 글(story_entries)을 덧붙인다.
// QR 이야기 페이지는 로그인 없이 공개 글만 본다. 공개 여부와 실명/별명 표시는 글쓴 돌보미가 글마다 고른다(CLAUDE.md 절대 규칙).
// 받은 호응(좋아요·한 줄 응답, #65)은 수만 보여 준다.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool, withTransaction } from '../common/db.js';
import { badRequest, HttpError, notFound } from '../common/errors.js';
import { treeNameSql } from '../common/tree-name.js';

// ── 기준값 ──
const ENTRY_MAX_LENGTH = 1000; // 글 하나 (임시값)
const TIME_ZONE = 'Asia/Seoul'; // 활동 기간은 한국 날짜 기준

// ── 요청 형식 ──
const idParam = z.object({ id: z.coerce.number().int().positive() });
const entryBody = z.object({
  body: z.string().trim().min(1).max(ENTRY_MAX_LENGTH),
  authorDisplay: z.enum(['nickname', 'real_name']).default('nickname'), // 별명 / 실명
  isPublic: z.boolean().default(true),
});

// ── 응답 형식 ──
export type StoryEntryView = {
  id: number;
  body: string;
  isPublic: boolean;
  author: { displayName: string }; // 글쓴 돌보미가 고른 별명 또는 실명. 다른 신원 정보는 주지 않는다
  likeCount: number;
  replyCount: number;
  createdAt: string;
};

// 글 + 표시 이름 + 호응 수. 실명을 골랐으면 실명, 아니면 별명
const SELECT_ENTRY = `
  SELECT e.id, e.body, e.is_public, e.created_at, s.tree_id,
         CASE WHEN e.author_display = 'real_name' THEN u.real_name ELSE u.nickname END AS display_name,
         (SELECT count(*) FROM story_reactions x WHERE x.story_entry_id = e.id AND x.kind = 'like') AS like_count,
         (SELECT count(*) FROM story_reactions x WHERE x.story_entry_id = e.id AND x.kind = 'reply') AS reply_count
  FROM story_entries e
  JOIN stories s ON s.id = e.story_id
  JOIN users u ON u.id = e.user_id`;

type EntryRow = {
  id: number;
  body: string;
  is_public: boolean;
  created_at: Date;
  tree_id: number;
  display_name: string;
  like_count: number;
  reply_count: number;
};

function toView(r: EntryRow): StoryEntryView {
  return {
    id: r.id,
    body: r.body,
    isPublic: r.is_public,
    author: { displayName: r.display_name },
    likeCount: r.like_count,
    replyCount: r.reply_count,
    createdAt: r.created_at.toISOString(),
  };
}

async function treeExists(id: number): Promise<boolean> {
  const { rowCount } = await getPool().query('SELECT 1 FROM trees WHERE id = $1', [id]);
  return Boolean(rowCount);
}

// ── 나무의 이야기 (/trees/:id/story) ──
export const treeStoryRouter = Router();

// 로그인 없이: 공개 글만 오래된 순
treeStoryRouter.get('/:id/story', async (req, res) => {
  const { id } = idParam.parse(req.params);
  if (!(await treeExists(id))) throw notFound('나무를 찾을 수 없다.');
  const { rows } = await getPool().query<EntryRow>(
    `${SELECT_ENTRY} WHERE s.tree_id = $1 AND e.is_public ORDER BY e.created_at, e.id`,
    [id],
  );
  res.json({ treeId: id, entries: rows.map(toView) });
});

// 글 덧붙이기: 그 나무의 승인된 돌보미(오늘이 활동 기간 안)만. 이야기 묶음이 없으면 같이 만든다
treeStoryRouter.post('/:id/story/entries', authenticate, async (req, res) => {
  const { id: userId, role } = req.user!;
  if (role !== 'citizen') throw new HttpError(403, 'FORBIDDEN', '시민 계정만 이야기를 쓸 수 있다.');
  const { id: treeId } = idParam.parse(req.params);
  const body = entryBody.parse(req.body);
  if (!(await treeExists(treeId))) throw notFound('나무를 찾을 수 없다.');

  const entryId = await withTransaction(async (db) => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });
    const { rows: me } = await db.query<{ approved: boolean; real_name: string | null }>(
      `SELECT EXISTS (SELECT 1 FROM caregiver_applications
                      WHERE user_id = $1 AND tree_id = $2 AND status = 'approved' AND $3::date BETWEEN period_start AND period_end) AS approved,
              real_name
       FROM users WHERE id = $1`,
      [userId, treeId, today],
    );
    if (!me[0]?.approved) throw new HttpError(403, 'FORBIDDEN', '이 나무의 승인된 돌보미만 이야기를 덧붙일 수 있다.');
    if (body.authorDisplay === 'real_name' && !me[0].real_name) throw badRequest('실명이 등록되어 있지 않아 실명으로 쓸 수 없다.');

    // 나무당 이야기 하나(stories.tree_id 유일). 이미 있으면 그것을 쓴다
    await db.query('INSERT INTO stories (tree_id) VALUES ($1) ON CONFLICT (tree_id) DO NOTHING', [treeId]);
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO story_entries (story_id, user_id, body, author_display, is_public)
       SELECT id, $2, $3, $4, $5 FROM stories WHERE tree_id = $1
       RETURNING id`,
      [treeId, userId, body.body, body.authorDisplay, body.isPublic],
    );
    await db.query('UPDATE stories SET updated_at = now() WHERE tree_id = $1', [treeId]);
    return rows[0]!.id;
  });

  const { rows } = await getPool().query<EntryRow>(`${SELECT_ENTRY} WHERE e.id = $1`, [entryId]);
  res.status(201).json(toView(rows[0]!));
});

// ── 글 하나 (/story-entries/:id) ──
export const storyEntriesRouter = Router();

// 로그인 없이: 나이테 표식에서 글 하나로 이동할 때. 비공개 글은 없는 글처럼 404
storyEntriesRouter.get('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await getPool().query<EntryRow & { species: string; code: string | null; tree_name: string; road_name: string | null; district: string }>(
    `SELECT x.*, t.species, t.code, ${treeNameSql('t')} AS tree_name, t.road_name, t.district FROM (${SELECT_ENTRY} WHERE e.id = $1 AND e.is_public) x
     JOIN trees t ON t.id = x.tree_id`,
    [id],
  );
  const r = rows[0];
  if (!r) throw notFound('이야기 글을 찾을 수 없다.');
  res.json({
    ...toView(r),
    tree: { id: r.tree_id, code: r.code, name: r.tree_name, species: r.species, district: r.district, roadName: r.road_name },
  });
});
