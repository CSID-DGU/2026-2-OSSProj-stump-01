import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createNotification } from '../common/notifications.js';
import { createTree, createUser, resetData } from '../test/fixtures.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let me: { id: number; token: string };
let other: { id: number; token: string };
let tree: number;

beforeEach(async () => {
  await resetData();
  me = await createUser();
  other = await createUser();
  tree = await createTree();
});
afterAll(closePool);

describe('GET /notifications', () => {
  it('내 알림만 최신순으로 주고 안 읽은 개수를 센다', async () => {
    const pool = getPool();
    const first = await createNotification(pool, { userId: me.id, type: 'application_result', treeId: tree, title: '첫 알림', body: 'a' });
    const second = await createNotification(pool, { userId: me.id, type: 'rental_result', title: '둘째 알림', body: 'b' });
    await createNotification(pool, { userId: other.id, type: 'rental_result', title: '남의 알림', body: 'c' });

    const res = await request(api).get('/notifications').set(auth(me.token));

    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(2);
    expect(res.body.notifications.map((n: { id: number }) => n.id)).toEqual([second, first]);
    expect(res.body.notifications[1]).toMatchObject({ type: 'application_result', treeId: tree, title: '첫 알림', readAt: null });
  });

  it('unreadOnly=true 면 읽은 알림은 뺀다', async () => {
    const pool = getPool();
    const read = await createNotification(pool, { userId: me.id, type: 'rental_result', title: '읽음', body: '' });
    await createNotification(pool, { userId: me.id, type: 'rental_result', title: '안 읽음', body: '' });
    await request(api).patch(`/notifications/${read}/read`).set(auth(me.token));

    const res = await request(api).get('/notifications?unreadOnly=true').set(auth(me.token));
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].title).toBe('안 읽음');
    expect(res.body.unreadCount).toBe(1);
  });

  it('토큰 없으면 401', async () => {
    expect((await request(api).get('/notifications')).status).toBe(401);
  });
});

describe('PATCH /notifications/:id/read', () => {
  it('내 알림은 읽음 시각이 생기고, 두 번 눌러도 처음 시각을 유지한다', async () => {
    const id = await createNotification(getPool(), { userId: me.id, type: 'rental_result', title: 't', body: 'b' });
    const first = await request(api).patch(`/notifications/${id}/read`).set(auth(me.token));
    expect(first.status).toBe(200);
    expect(first.body.readAt).not.toBeNull();
    const second = await request(api).patch(`/notifications/${id}/read`).set(auth(me.token));
    expect(second.body.readAt).toBe(first.body.readAt);
  });

  it('남의 알림은 404', async () => {
    const id = await createNotification(getPool(), { userId: other.id, type: 'rental_result', title: 't', body: 'b' });
    const res = await request(api).patch(`/notifications/${id}/read`).set(auth(me.token));
    expect(res.status).toBe(404);
  });
});
