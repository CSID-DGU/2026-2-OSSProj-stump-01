import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import {
  createActivity,
  createIncident,
  createMonthlyReport,
  createStoryEntry,
  createTree,
  createUser,
  resetData,
} from '../test/fixtures.js';

const api = createApp();

beforeEach(resetData);
afterAll(closePool);

type Month = {
  month: number;
  rainMm: number | null;
  tempMaxAvg: number | null;
  heatDays: number;
  careMinutes: number;
  careCount: number;
  activityDays: number[];
  stories: { id: number; day: number }[];
  reported: number;
  resolved: number;
  reactions: number;
};

const rings = async (treeId: number, year: number | string) => request(api).get(`/trees/${treeId}/rings?year=${year}`);
const month = (body: { months: Month[] }, m: number) => body.months[m - 1]!;

async function addWeather(date: string, rain: number, tempMax: number) {
  await getPool().query(
    `INSERT INTO weather (date, region, precipitation_mm, temp_max, is_heatwave) VALUES ($1, 'seoul', $2, $3::numeric, $3::numeric >= 33)`,
    [date, rain, tempMax],
  );
}

async function approve(reportId: number, officerId: number) {
  await getPool().query(`UPDATE monthly_reports SET status = 'approved', reviewed_by = $2, reviewed_at = now() WHERE id = $1`, [reportId, officerId]);
}

const addStoryEntry = (treeId: number, userId: number, createdAt: string, isPublic: boolean) =>
  createStoryEntry({ treeId, userId, createdAt, isPublic });

describe('GET /trees/:id/rings', () => {
  it('로그인 없이 1월~12월 12조각을 준다', async () => {
    const tree = await createTree();

    const res = await rings(tree, 2026);

    expect(res.status).toBe(200);
    expect(res.body.treeId).toBe(tree);
    expect(res.body.year).toBe(2026);
    expect(res.body.months.map((m: Month) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(month(res.body, 1)).toMatchObject({ rainMm: null, tempMaxAvg: null, heatDays: 0, careMinutes: 0, activityDays: [], reactions: 0 });
  });

  it('받은 비·평균 최고기온·폭염일은 그해 그달 서울 기상 자료로 센다', async () => {
    const tree = await createTree();
    await addWeather('2026-03-01', 10.5, 12);
    await addWeather('2026-03-02', 4.5, 14);
    await addWeather('2026-08-01', 0, 34);
    await addWeather('2026-08-02', 0, 35);
    await addWeather('2026-08-03', 12, 30);
    await addWeather('2025-03-05', 99, 20); // 다른 해

    const res = await rings(tree, 2026);

    expect(month(res.body, 3)).toMatchObject({ rainMm: 15, tempMaxAvg: 13, heatDays: 0 });
    expect(month(res.body, 8)).toMatchObject({ rainMm: 12, tempMaxAvg: 33, heatDays: 2 });
    expect(month(res.body, 4)).toMatchObject({ rainMm: null, tempMaxAvg: null }); // 기상 자료가 없는 달
  });

  it('돌봄 시간·횟수는 구청이 승인한 보고서의 기록만, 그 나무의 모든 돌보미 것을 더한다', async () => {
    const tree = await createTree();
    const otherTree = await createTree();
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const officer = await createUser({ role: 'officer' });
    await approve(await createMonthlyReport({ userId: a.id, treeId: tree, dates: ['2026-03-03', '2026-03-10'], minutesEach: 30 }), officer.id);
    await approve(await createMonthlyReport({ userId: b.id, treeId: tree, dates: ['2026-03-10'], minutesEach: 20 }), officer.id);
    await createMonthlyReport({ userId: c.id, treeId: tree, dates: ['2026-03-12'], minutesEach: 40 }); // 아직 검토 전
    await createActivity({ userId: a.id, treeId: tree, date: '2026-03-15' }); // 보고서에 안 넣은 기록
    await approve(await createMonthlyReport({ userId: a.id, treeId: otherTree, dates: ['2026-03-20'] }), officer.id); // 다른 나무

    const res = await rings(tree, 2026);

    expect(month(res.body, 3)).toMatchObject({ careMinutes: 50 + 30, careCount: 3 });
  });

  it('활동한 날(점)은 승인 여부와 상관없이 그 나무의 활동 기록이 있는 날이다 (같은 날은 한 번)', async () => {
    const tree = await createTree();
    const [a, b] = [await createUser(), await createUser()];
    await createActivity({ userId: a.id, treeId: tree, date: '2026-03-15' });
    await createActivity({ userId: b.id, treeId: tree, date: '2026-03-03' });
    await createActivity({ userId: b.id, treeId: tree, date: '2026-03-15' });
    await createActivity({ userId: a.id, treeId: tree, date: '2025-03-20' }); // 다른 해

    const res = await rings(tree, 2026);

    expect(month(res.body, 3)!.activityDays).toEqual([3, 15]);
  });

  it('별은 공개 이야기 글만, 한국 시간 날짜로 놓는다', async () => {
    const tree = await createTree();
    const me = await createUser();
    const open = await addStoryEntry(tree, me.id, '2026-04-01T00:30:00+09:00', true); // UTC 로는 3월 31일
    await addStoryEntry(tree, me.id, '2026-04-05T12:00:00+09:00', false); // 비공개

    const res = await rings(tree, 2026);

    expect(month(res.body, 4)!.stories).toEqual([{ id: open, day: 1 }]);
    expect(month(res.body, 3)!.stories).toEqual([]);
  });

  it('신고는 접수한 달, 조치는 조치 완료한 달에 센다', async () => {
    const tree = await createTree();
    const me = await createUser();
    const officer = await createUser({ role: 'officer' });
    const report = await createIncident({ userId: me.id, treeId: tree, createdAt: '2026-05-02T10:00:00+09:00' });
    await getPool().query(
      `UPDATE reports SET status = 'resolved', inspected_at = '2026-05-30T10:00:00+09:00', resolved_at = '2026-06-01T09:00:00+09:00', handled_by = $2 WHERE id = $1`,
      [report, officer.id],
    );

    const res = await rings(tree, 2026);

    expect(month(res.body, 5)).toMatchObject({ reported: 1, resolved: 0 });
    expect(month(res.body, 6)).toMatchObject({ reported: 0, resolved: 1 });
  });

  it('받은 호응은 그 나무 이야기 글에 남은 좋아요·한 줄 응답을 남긴 날(한국 날짜)의 달에 센다 (#65)', async () => {
    const tree = await createTree();
    const otherTree = await createTree();
    const me = await createUser();
    const entry = await createStoryEntry({ treeId: tree, userId: me.id });
    const otherEntry = await createStoryEntry({ treeId: otherTree, userId: me.id });
    const react = (entryId: number, device: string, on: string, kind = 'like') =>
      getPool().query(
        `INSERT INTO story_reactions (story_entry_id, kind, body, device_key, reacted_on) VALUES ($1, $2, $3, $4, $5)`,
        [entryId, kind, kind === 'reply' ? '고마워요' : null, device, on],
      );
    await react(entry, 'device-a', '2026-07-03');
    await react(entry, 'device-b', '2026-07-20', 'reply');
    await react(entry, 'device-a', '2026-09-01');
    await react(entry, 'device-a', '2025-07-03'); // 다른 해
    await react(otherEntry, 'device-a', '2026-07-03'); // 다른 나무

    const res = await rings(tree, 2026);

    expect(month(res.body, 7)!.reactions).toBe(2);
    expect(month(res.body, 9)!.reactions).toBe(1);
    expect(month(res.body, 8)!.reactions).toBe(0);
  });

  it('없는 나무는 404, 연도가 숫자가 아니거나 범위 밖이면 400', async () => {
    const tree = await createTree();
    expect((await rings(999999, 2026)).status).toBe(404);
    expect((await rings(tree, 'abc')).status).toBe(400);
    expect((await rings(tree, 1999)).status).toBe(400);
  });

  it('연도를 안 주면 올해(한국 시간)로 본다', async () => {
    const tree = await createTree();
    const thisYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()));

    const res = await request(api).get(`/trees/${tree}/rings`);

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(thisYear);
  });
});
