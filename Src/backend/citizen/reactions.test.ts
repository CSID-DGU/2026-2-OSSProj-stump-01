import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createStoryEntry, createTree, createUser, resetData } from '../test/fixtures.js';

const api = createApp();

beforeEach(resetData);
afterAll(closePool);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const DEVICE = 'device-0123456789abcdef'; // 기기마다 브라우저가 한 번 만들어 두는 무작위 값
const react = (entryId: number, body: Record<string, unknown>) => request(api).post(`/story-entries/${entryId}/reactions`).send(body);

let tree: number;
let author: { id: number; token: string };
let entry: number;

beforeEach(async () => {
  tree = await createTree();
  author = await createUser();
  entry = await createStoryEntry({ treeId: tree, userId: author.id });
});

describe('POST /story-entries/:id/reactions', () => {
  it('로그인 없이 좋아요를 남기면 글의 좋아요 수가 늘고, 글쓴 돌보미에게 알림이 간다', async () => {
    const res = await react(entry, { kind: 'like', deviceKey: DEVICE });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'like', likeCount: 1, replyCount: 0 });
    expect(res.body).not.toHaveProperty('deviceKey'); // 기기 값은 돌려주지 않는다

    const story = await request(api).get(`/trees/${tree}/story`);
    expect(story.body.entries[0]).toMatchObject({ likeCount: 1, replyCount: 0 });

    const { rows } = await getPool().query('SELECT user_id, type, tree_id, title, body FROM notifications');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: author.id, type: 'story_reaction', tree_id: tree });
    expect(rows[0].body).toContain('좋아요');
  });

  it('한 줄 응답은 80자까지, 알림에 응답 내용을 담는다', async () => {
    const res = await react(entry, { kind: 'reply', body: '  그늘이 시원해요  ', deviceKey: DEVICE });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'reply', body: '그늘이 시원해요', likeCount: 0, replyCount: 1 });
    const { rows } = await getPool().query('SELECT body FROM notifications');
    expect(rows[0].body).toContain('그늘이 시원해요');

    const other = 'device-other-0123456789';
    expect((await react(entry, { kind: 'reply', body: '가'.repeat(81), deviceKey: other })).status).toBe(400);
    expect((await react(entry, { kind: 'reply', body: '   ', deviceKey: other })).status).toBe(400);
    // 내용 없는 응답·내용 있는 좋아요는 DB 까지 가기 전에 입력 검증에서 막는다
    const noBody = await react(entry, { kind: 'reply', deviceKey: other });
    expect(noBody.status).toBe(400);
    expect(noBody.body.error.code).toBe('VALIDATION_ERROR');
    const likeWithBody = await react(entry, { kind: 'like', body: '좋아요에는 글이 없다', deviceKey: other });
    expect(likeWithBody.status).toBe(400);
    expect(likeWithBody.body.error.code).toBe('VALIDATION_ERROR');
    expect((await react(entry, { kind: 'reply', body: '가'.repeat(80), deviceKey: other })).status).toBe(201);
  });

  it('같은 기기는 글 하나에 하루 한 번만 (좋아요·한 줄 응답 합쳐서). 다른 기기나 다른 글은 된다', async () => {
    expect((await react(entry, { kind: 'like', deviceKey: DEVICE })).status).toBe(201);

    const again = await react(entry, { kind: 'reply', body: '또', deviceKey: DEVICE });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REACTED');

    expect((await react(entry, { kind: 'like', deviceKey: 'device-second-0123456789' })).status).toBe(201);
    const otherEntry = await createStoryEntry({ treeId: tree, userId: author.id });
    expect((await react(otherEntry, { kind: 'like', deviceKey: DEVICE })).status).toBe(201);

    // 409 로 끝난 요청은 알림을 남기지 않는다
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM notifications');
    expect(rows[0].n).toBe(3);
  });

  it('비공개 글·없는 글은 404, 기기 값이 없거나 형식이 틀리면 400', async () => {
    const hidden = await createStoryEntry({ treeId: tree, userId: author.id, isPublic: false });

    expect((await react(hidden, { kind: 'like', deviceKey: DEVICE })).status).toBe(404);
    expect((await react(999999, { kind: 'like', deviceKey: DEVICE })).status).toBe(404);
    expect((await react(entry, { kind: 'like' })).status).toBe(400);
    expect((await react(entry, { kind: 'like', deviceKey: 'short' })).status).toBe(400);
    expect((await react(entry, { kind: 'like', deviceKey: 'has spaces and ! marks 1234' })).status).toBe(400);
    expect((await react(entry, { kind: 'love', deviceKey: DEVICE })).status).toBe(400);
  });
});

describe('GET /me/reactions', () => {
  it('내 글이 받은 호응만 최신순으로, 나무 이름과 함께 준다 (기기 값은 주지 않는다)', async () => {
    const stranger = await createUser();
    const strangerEntry = await createStoryEntry({ treeId: tree, userId: stranger.id });
    await react(entry, { kind: 'like', deviceKey: DEVICE });
    await react(entry, { kind: 'reply', body: '잘 자라렴', deviceKey: 'device-second-0123456789' });
    await react(strangerEntry, { kind: 'like', deviceKey: DEVICE }); // 남의 글

    const res = await request(api).get('/me/reactions').set(auth(author.token));

    expect(res.status).toBe(200);
    expect(res.body.reactions).toHaveLength(2);
    expect(res.body.reactions[0]).toMatchObject({ kind: 'reply', body: '잘 자라렴', entry: { id: entry }, tree: { id: tree } });
    expect(res.body.reactions[0].tree.name).toContain('은행나무');
    expect(res.body.reactions[1]).toMatchObject({ kind: 'like', body: null });
    expect(JSON.stringify(res.body)).not.toContain(DEVICE);
  });

  it('로그인하지 않으면 401', async () => {
    expect((await request(api).get('/me/reactions')).status).toBe(401);
  });
});
