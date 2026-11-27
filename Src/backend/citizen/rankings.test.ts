import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createActivity, createMonthlyReport, createTree, createUser, resetData } from '../test/fixtures.js';
import { seoulMonth } from './rewards.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(resetData);
afterAll(closePool);

const month = seoulMonth(); // 활동 순위는 이번 달(한국 시간)
const day = (d: number) => `${month}-${String(d).padStart(2, '0')}`;
const lastMonthDay = () => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12-15` : `${y}-${String(m - 1).padStart(2, '0')}-15`;
};

/** 현장 확인된 활동 기록 (순위에 들어가는 기록) */
const credit = (userId: number, treeId: number, date: string, opts: { at?: string; verification?: 'none' | 'location' | 'photo' } = {}) =>
  createActivity({ userId, treeId, date, verification: opts.verification ?? 'photo', recordedAt: opts.at ?? `${date}T08:00:00+09:00` });

const getRanking = (token: string, type?: string) =>
  request(api)
    .get('/rankings')
    .query(type ? { type } : {})
    .set(auth(token));

describe('GET /rankings?type=activity', () => {
  it('이번 달 인정 활동 횟수 → 돌본 나무 수 순이고, 같은 나무 하루 1회·현장 확인 기록만 센다', async () => {
    const a = await createUser({ nickname: '은행지기' });
    const b = await createUser({ nickname: '느티사랑' });
    const c = await createUser({ nickname: '확인전' });
    const [t1, t2] = [await createTree(), await createTree()];

    // a: 3회(나무 2그루). 같은 나무 같은 날 두 번은 한 번으로
    await credit(a.id, t1, day(1));
    await credit(a.id, t1, day(1), { at: `${day(1)}T19:00:00+09:00` });
    await credit(a.id, t1, day(2));
    await credit(a.id, t2, day(1), { verification: 'location' });
    await credit(a.id, t1, lastMonthDay()); // 지난달은 안 센다
    // b: 3회(나무 1그루) → 같은 횟수면 나무 수가 많은 a가 위
    for (const d of [1, 2, 3]) await credit(b.id, t1, day(d));
    // c: 확인 전 기록(none)만 → 순위에 없다
    await credit(c.id, t1, day(1), { verification: 'none' });

    const res = await getRanking(a.token);

    expect(res.status).toBe(200);
    expect(res.body.month).toBe(month);
    expect(res.body.top).toEqual([
      { rank: 1, nickname: '은행지기', activityCount: 3, treeCount: 2, isMe: true },
      { rank: 2, nickname: '느티사랑', activityCount: 3, treeCount: 1, isMe: false },
    ]);
    expect(res.body.me).toEqual({ visible: true, rank: 1, activityCount: 3, treeCount: 2 });
    expect(JSON.stringify(res.body)).not.toContain('실명'); // 실명은 내보내지 않는다
  });

  it('폭염 날 낮(11~17시)에 남긴 기록은 빼고, 아침 기록은 센다', async () => {
    const me = await createUser();
    const [t1, t2] = [await createTree(), await createTree()];
    await getPool().query(`INSERT INTO weather (date, region, temp_max, is_heatwave) VALUES ($1, 'seoul', 34.5, true)`, [day(3)]);
    await credit(me.id, t1, day(3), { at: `${day(3)}T13:00:00+09:00` }); // 낮 → 뺀다
    await credit(me.id, t2, day(3), { at: `${day(3)}T07:30:00+09:00` }); // 아침 → 센다

    const res = await getRanking(me.token);

    expect(res.body.me).toMatchObject({ activityCount: 1, treeCount: 1, rank: 1 });
  });

  it('순위를 끄면 목록에서 빠지고, 내 점수는 나에게만 보인다', async () => {
    const a = await createUser({ nickname: '숨김' });
    const b = await createUser({ nickname: '공개' });
    const tree = await createTree();
    for (const d of [1, 2]) await credit(a.id, tree, day(d));
    await credit(b.id, tree, day(1));

    const off = await request(api).put('/me/ranking').set(auth(a.token)).send({ visible: false });
    expect(off.body).toEqual({ visible: false });

    const res = await getRanking(a.token);
    expect(res.body.top).toEqual([{ rank: 1, nickname: '공개', activityCount: 1, treeCount: 1, isMe: false }]);
    expect(res.body.me).toEqual({ visible: false, rank: null, activityCount: 2, treeCount: 1 });

    await request(api).put('/me/ranking').set(auth(a.token)).send({ visible: true });
    expect((await getRanking(a.token)).body.me.rank).toBe(1);
  });

  it('상위 10위까지만 보이고, 10위 밖이면 내 순위 숫자도 주지 않는다. 구청 담당자는 순위에 없다', async () => {
    const tree = await createTree();
    const users = [];
    for (let i = 0; i < 11; i++) {
      const u = await createUser();
      users.push(u);
      for (let d = 1; d <= 11 - i; d++) await credit(u.id, tree, day(d)); // 11회, 10회, ... 1회
    }
    const officer = await createUser({ role: 'officer' });
    for (let d = 1; d <= 20; d++) await credit(officer.id, tree, day(d));

    const last = await getRanking(users[10]!.token);

    expect(last.body.top).toHaveLength(10);
    expect(last.body.top.map((e: { rank: number }) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(last.body.me).toEqual({ visible: true, rank: null, activityCount: 1, treeCount: 1 });
  });

  it('기록이 없으면 내 점수는 0이고 순위는 없다', async () => {
    const me = await createUser();
    const res = await getRanking(me.token);
    expect(res.body).toMatchObject({ type: 'activity', top: [], me: { visible: true, rank: null, activityCount: 0, treeCount: 0 } });
  });

  it('로그인이 필요하다', async () => {
    expect((await request(api).get('/rankings')).status).toBe(401);
  });
});

describe('GET /rankings?type=official', () => {
  it('승인된 봉사시간 누적 순이고, 이달의 MVP는 이번 달 기록된 봉사시간 1위다', async () => {
    const officer = await createUser({ role: 'officer' });
    const a = await createUser({ nickname: '꾸준이' });
    const b = await createUser({ nickname: '이번달' });
    const tree = await createTree();
    const hours = async (userId: number, minutes: number, recordedAt: string) => {
      const reportId = await createMonthlyReport({ userId, treeId: tree, dates: [lastMonthDay()] });
      await getPool().query(
        `INSERT INTO volunteer_hours (user_id, monthly_report_id, minutes, recorded_by, recorded_at) VALUES ($1, $2, $3, $4, $5)`,
        [userId, reportId, minutes, officer.id, recordedAt],
      );
    };
    await hours(a.id, 120, `${lastMonthDay()}T10:00:00+09:00`);
    await hours(b.id, 90, `${day(2)}T10:00:00+09:00`);

    const res = await getRanking(b.token, 'official');

    expect(res.status).toBe(200);
    expect(res.body.top).toEqual([
      { rank: 1, nickname: '꾸준이', minutes: 120, isMe: false },
      { rank: 2, nickname: '이번달', minutes: 90, isMe: true },
    ]);
    expect(res.body.me).toEqual({ visible: true, rank: 2, minutes: 90 });
    expect(res.body.mvp).toEqual({ month, winners: [{ nickname: '이번달', minutes: 90, isMe: true }] });
  });
});

describe('GET /me/stats, GET /me/badges', () => {
  it('돌본 나무 수·누적 활동·스탬프와 배지 목록을 준다', async () => {
    const me = await createUser();
    const [t1, t2] = [await createTree(), await createTree()];
    for (const d of [1, 2, 3, 4]) await credit(me.id, t1, day(d));
    await credit(me.id, t2, lastMonthDay(), { verification: 'none' }); // 내 통계는 확인 여부·기간과 상관없이 센다
    await getPool().query(`INSERT INTO user_badges (user_id, badge_code) VALUES ($1, 'caregiver_5')`, [me.id]);

    const stats = await request(api).get('/me/stats').set(auth(me.token));
    expect(stats.body).toEqual({ treeCount: 2, activityCount: 5, totalMinutes: 150, stamps: 5, rankingVisible: true });

    const badges = await request(api).get('/me/badges').set(auth(me.token));
    expect(badges.body.badges).toHaveLength(2);
    expect(badges.body.badges[0]).toMatchObject({ code: 'caregiver_5', stamps: 5, earned: true });
    expect(badges.body.badges[0].earnedAt).not.toBeNull();
    expect(badges.body.badges[1]).toMatchObject({ code: 'caregiver_10', stamps: 10, earned: false, earnedAt: null });
  });

  it('순위 켜기/끄기는 visible 값이 있어야 한다', async () => {
    const me = await createUser();
    expect((await request(api).put('/me/ranking').set(auth(me.token)).send({})).status).toBe(400);
  });
});
