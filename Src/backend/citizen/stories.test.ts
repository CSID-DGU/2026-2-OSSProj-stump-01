import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createApplication, createTree, createUser, resetData } from '../test/fixtures.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** 오늘(한국 시간)에서 days일 옮긴 날짜 'YYYY-MM-DD' */
function seoulDate(days = 0): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

let me: { id: number; token: string };
let officer: { id: number; token: string };
let tree: number;

beforeEach(async () => {
  await resetData();
  me = await createUser({ nickname: '은행지기' });
  officer = await createUser({ role: 'officer' });
  tree = await createTree();
});
afterAll(closePool);

async function approveCaregiver(userId: number, treeId: number) {
  await getPool().query(
    `INSERT INTO caregiver_applications (user_id, tree_id, status, period_start, period_end, reviewed_by, reviewed_at)
     VALUES ($1, $2, 'approved', $3, $4, $5, now())`,
    [userId, treeId, seoulDate(-30), seoulDate(300), officer.id],
  );
}

const write = (body: object, treeId = tree, token = me.token) =>
  request(api).post(`/trees/${treeId}/story/entries`).set(auth(token)).send(body);

describe('POST /trees/:id/story/entries', () => {
  it('승인된 돌보미가 글을 덧붙이면 그 나무 이야기가 생기고 작성자가 남는다', async () => {
    await approveCaregiver(me.id, tree);

    const res = await write({ body: '오늘 첫 잎이 났어요' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ body: '오늘 첫 잎이 났어요', isPublic: true, author: { displayName: '은행지기' } });
    const { rows } = await getPool().query('SELECT user_id, author_display FROM story_entries WHERE id = $1', [res.body.id]);
    expect(rows[0]).toEqual({ user_id: me.id, author_display: 'nickname' });
  });

  it('두 번째 글은 같은 이야기에 이어 붙는다(나무당 이야기 하나)', async () => {
    await approveCaregiver(me.id, tree);
    const other = await createUser();
    await approveCaregiver(other.id, tree);

    await write({ body: '첫 글' });
    await write({ body: '둘째 글' }, tree, other.token);

    const { rows } = await getPool().query('SELECT count(DISTINCT story_id)::int AS stories, count(*)::int AS entries FROM story_entries');
    expect(rows[0]).toEqual({ stories: 1, entries: 2 });
  });

  it('실명으로 쓰면 실명이 보인다', async () => {
    await approveCaregiver(me.id, tree);
    await getPool().query(`UPDATE users SET real_name = '김돌봄' WHERE id = $1`, [me.id]);
    const res = await write({ body: '실명으로 남겨요', authorDisplay: 'real_name' });
    expect(res.body.author.displayName).toBe('김돌봄');
  });

  it('실명이 없는데 실명으로 쓰려 하면 400', async () => {
    await approveCaregiver(me.id, tree);
    await getPool().query('UPDATE users SET real_name = NULL WHERE id = $1', [me.id]);
    const res = await write({ body: '글', authorDisplay: 'real_name' });
    expect(res.status).toBe(400);
  });

  it('승인되지 않은(대기 중) 돌보미는 403', async () => {
    await createApplication({ userId: me.id, treeId: tree, status: 'pending' });
    expect((await write({ body: '글' })).status).toBe(403);
  });

  it('없는 나무는 404', async () => {
    expect((await write({ body: '글' }, 999_999)).status).toBe(404);
  });

  it.each([
    ['본문이 공백뿐이면', { body: '   ' }, 'body'],
    ['본문이 1000자를 넘으면', { body: '가'.repeat(1001) }, 'body'],
    ['표시 방식이 목록에 없으면', { body: '글', authorDisplay: 'anonymous' }, 'authorDisplay'],
  ])('%s 400', async (_, body, field) => {
    await approveCaregiver(me.id, tree);
    const res = await write(body);
    expect(res.status).toBe(400);
    expect(res.body.error.issues.map((i: { path: string[] }) => i.path[0])).toEqual([field]);
  });

  it('구청 담당자 계정은 403, 토큰 없으면 401', async () => {
    expect((await write({ body: '글' }, tree, officer.token)).status).toBe(403);
    expect((await request(api).post(`/trees/${tree}/story/entries`).send({ body: '글' })).status).toBe(401);
  });
});

describe('GET /trees/:id/story', () => {
  it('로그인 없이 공개 글만 오래된 순으로, 받은 호응 수와 함께 준다', async () => {
    await approveCaregiver(me.id, tree);
    const first = await write({ body: '첫 글' });
    await write({ body: '나만 볼 글', isPublic: false });
    const third = await write({ body: '셋째 글' });
    await getPool().query(
      `INSERT INTO story_reactions (story_entry_id, kind, body, device_key) VALUES
         ($1, 'like', NULL, 'device-a'), ($1, 'like', NULL, 'device-b'), ($1, 'reply', '고마워요', 'device-c')`,
      [first.body.id],
    );

    const res = await request(api).get(`/trees/${tree}/story`);

    expect(res.status).toBe(200);
    expect(res.body.treeId).toBe(tree);
    expect(res.body.entries.map((e: { id: number }) => e.id)).toEqual([first.body.id, third.body.id]);
    expect(res.body.entries[0]).toMatchObject({ author: { displayName: '은행지기' }, likeCount: 2, replyCount: 1 });
    expect(JSON.stringify(res.body)).not.toContain('나만 볼 글');
  });

  it('아직 이야기가 없으면 빈 목록', async () => {
    const res = await request(api).get(`/trees/${tree}/story`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
  });

  it('없는 나무는 404', async () => {
    expect((await request(api).get('/trees/999999/story')).status).toBe(404);
  });
});

describe('GET /story-entries/:id', () => {
  it('공개 글 하나를 나무 정보와 함께 로그인 없이 준다', async () => {
    await approveCaregiver(me.id, tree);
    const entry = await write({ body: '나이테에서 온 글' });
    await getPool().query('SELECT assign_tree_codes()'); // 나무 이름의 번호를 매긴다

    const res = await request(api).get(`/story-entries/${entry.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: entry.body.id, body: '나이테에서 온 글', tree: { id: tree, species: '은행나무' } });
    expect(res.body.tree.name).toMatch(/^은행나무, 명동길 \d+번$/);
  });

  it('비공개 글과 없는 글은 404', async () => {
    await approveCaregiver(me.id, tree);
    const hidden = await write({ body: '비공개', isPublic: false });
    expect((await request(api).get(`/story-entries/${hidden.body.id}`)).status).toBe(404);
    expect((await request(api).get('/story-entries/999999')).status).toBe(404);
  });
});
