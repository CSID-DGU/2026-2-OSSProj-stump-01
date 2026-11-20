import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createApplication, createTree, createUser, resetData } from '../test/fixtures.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const UPLOAD_DIR = process.env.UPLOAD_DIR!;

// 작은 가짜 이미지. 서버는 파일 형식(MIME)만 보고 내용은 해석하지 않는다.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const photo = (name = 'leaf.jpg') => ({ buffer: JPEG, name, type: 'image/jpeg' });

/** 오늘(한국 시간)에서 days일 옮긴 날짜 'YYYY-MM-DD' */
function seoulDate(days = 0): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

let me: { id: number; token: string };
let officer: { id: number; token: string };
let tree: number;

beforeEach(async () => {
  await resetData();
  me = await createUser();
  officer = await createUser({ role: 'officer', agency: '중구' });
  tree = await createTree({ agency: '중구' });
});
afterAll(closePool);

/** 오늘을 포함하는 기간으로 승인된 돌보미를 만든다. */
async function approveCaregiver(userId: number, treeId: number, period = { start: seoulDate(-30), end: seoulDate(300) }) {
  await getPool().query(
    `INSERT INTO caregiver_applications (user_id, tree_id, status, period_start, period_end, reviewed_by, reviewed_at)
     VALUES ($1, $2, 'approved', $3, $4, $5, now())`,
    [userId, treeId, period.start, period.end, officer.id],
  );
}

type Fields = Record<string, string | string[]>;

/** multipart/form-data 로 기록을 보낸다. 같은 이름을 여러 번 보내면 배열이 된다. */
function submit(fields: Fields, photos: ReturnType<typeof photo>[] = [], token = me.token) {
  let req = request(api).post('/records').set(auth(token));
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) req = req.field(k, one);
  }
  for (const p of photos) req = req.attach('photos', p.buffer, { filename: p.name, contentType: p.type });
  return req;
}

const activity = (over: Fields = {}): Fields => ({
  type: 'activity',
  treeId: String(tree),
  activityKinds: ['쓰레기 줍기', '보호틀 정리'],
  durationMin: '30',
  memo: '낙엽이 많았어요',
  ...over,
});

const report = (over: Fields = {}): Fields => ({
  type: 'report',
  treeId: String(tree),
  category: 'leaning',
  memo: '바람에 기울었어요',
  lat: '37.5601',
  lng: '126.9701',
  ...over,
});

async function countRecords(userId: number): Promise<number> {
  const { rows } = await getPool().query<{ count: number }>('SELECT count(*)::int FROM records WHERE user_id = $1', [userId]);
  return rows[0]!.count;
}

const uploadedFiles = () => (existsSync(UPLOAD_DIR) ? readdirSync(UPLOAD_DIR).length : 0);

describe('POST /records (type=activity)', () => {
  it('승인된 돌보미는 사진과 함께 오늘 활동을 기록한다', async () => {
    await approveCaregiver(me.id, tree);

    const res = await submit(activity(), [photo('a.jpg'), photo('b.jpg')]);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'activity',
      activityDate: seoulDate(0),
      activityKinds: ['쓰레기 줍기', '보호틀 정리'],
      durationMin: 30,
      memo: '낙엽이 많았어요',
      monthlyReportId: null,
      report: null,
      tree: { id: tree },
    });
    expect(res.body.photos).toHaveLength(2);
    for (const url of res.body.photos) {
      expect(url).toMatch(/^\/uploads\/[\w-]+\.jpg$/);
      expect(existsSync(join(UPLOAD_DIR, url.replace('/uploads/', '')))).toBe(true);
    }
    // 구청 화면이 읽는 records.photo_url 에는 첫 사진이 들어간다
    const { rows } = await getPool().query('SELECT photo_url FROM records WHERE id = $1', [res.body.id]);
    expect(rows[0].photo_url).toBe(res.body.photos[0]);
  });

  it('올린 사진은 /uploads 주소로 내려받을 수 있다', async () => {
    await approveCaregiver(me.id, tree);
    const res = await submit(activity(), [photo()]);

    const file = await request(api).get(res.body.photos[0]);

    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('image/jpeg');
  });

  it('사진 없이도 기록한다', async () => {
    await approveCaregiver(me.id, tree);
    const res = await submit(activity());
    expect(res.status).toBe(201);
    expect(res.body.photos).toEqual([]);
  });

  it('승인되지 않은(대기 중) 돌보미는 403이고 저장하지 않는다', async () => {
    await createApplication({ userId: me.id, treeId: tree, status: 'pending' });
    const res = await submit(activity());
    expect(res.status).toBe(403);
    expect(await countRecords(me.id)).toBe(0);
  });

  it('승인됐어도 오늘이 활동 기간 밖이면 403', async () => {
    await approveCaregiver(me.id, tree, { start: seoulDate(10), end: seoulDate(300) });
    const res = await submit(activity());
    expect(res.status).toBe(403);
  });

  it('구청 담당자 계정은 기록할 수 없다(403)', async () => {
    const res = await submit(activity(), [], officer.token);
    expect(res.status).toBe(403);
  });

  it('사진이 4장이면 400이고 올린 파일도 남기지 않는다', async () => {
    await approveCaregiver(me.id, tree);
    const before = uploadedFiles();
    const res = await submit(activity(), [photo(), photo(), photo(), photo()]);
    expect(res.status).toBe(400);
    expect(await countRecords(me.id)).toBe(0);
    expect(uploadedFiles()).toBe(before);
  });

  it('이미지가 아닌 파일은 400', async () => {
    await approveCaregiver(me.id, tree);
    const res = await submit(activity(), [{ buffer: Buffer.from('hello'), name: 'a.txt', type: 'text/plain' }]);
    expect(res.status).toBe(400);
  });

  it('입력 값이 틀리면 올린 사진을 지운다', async () => {
    await approveCaregiver(me.id, tree);
    const before = uploadedFiles();
    const res = await submit(activity({ durationMin: '0' }), [photo()]);
    expect(res.status).toBe(400);
    expect(uploadedFiles()).toBe(before);
  });

  it.each<[string, string, Fields]>([
    ['한 일을 안 고르면', 'activityKinds', { activityKinds: [] }],
    ['한 일에 쉼표가 있으면', 'activityKinds', { activityKinds: ['청소, 물주기'] }],
    ['활동 시간이 0분이면', 'durationMin', { durationMin: '0' }],
    ['활동 시간이 숫자가 아니면', 'durationMin', { durationMin: '삼십' }],
    ['짧은 글이 200자를 넘으면', 'memo', { memo: '가'.repeat(201) }],
  ])('%s 400', async (_, field, over) => {
    await approveCaregiver(me.id, tree);
    const fields = activity(over);
    if (Array.isArray(fields.activityKinds) && fields.activityKinds.length === 0) delete fields.activityKinds;
    const res = await submit(fields);
    expect(res.status).toBe(400);
    expect(res.body.error.issues.map((i: { path: string[] }) => i.path[0])).toEqual([field]);
  });

  it('토큰 없으면 401', async () => {
    const res = await request(api).post('/records').field('type', 'activity');
    expect(res.status).toBe(401);
  });
});

describe('POST /records (type=report)', () => {
  it('돌보미가 아니어도 신고하면 "확인 필요" 상태로 그 나무 관리청 신고 큐에 들어간다', async () => {
    const res = await submit(report(), [photo()]);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'report',
      memo: '바람에 기울었어요',
      location: { lat: 37.5601, lng: 126.9701 },
      report: { category: 'leaning', urgency: 'high', status: 'pending' },
    });

    const queue = await request(api).get('/admin/incident-reports').set(auth(officer.token));
    expect(queue.status).toBe(200);
    expect(JSON.stringify(queue.body)).toContain(res.body.photos[0]);
  });

  it('긴급도는 유형으로 정하고, 교육을 이수했으면 신뢰도를 남긴다', async () => {
    await getPool().query('UPDATE users SET education_completed_at = now() WHERE id = $1', [me.id]);

    const res = await submit(report({ category: 'pest' }));

    expect(res.status).toBe(201);
    expect(res.body.report).toMatchObject({ category: 'pest', urgency: 'low' });
    const { rows } = await getPool().query('SELECT agency, is_trusted FROM reports');
    expect(rows[0]).toEqual({ agency: '중구', is_trusted: true });
  });

  it('위치 없이도 신고한다', async () => {
    const fields = report();
    delete fields.lat;
    delete fields.lng;
    const res = await submit(fields);
    expect(res.status).toBe(201);
    expect(res.body.location).toBeNull();
  });

  it('없는 나무는 404', async () => {
    const res = await submit(report({ treeId: '999999' }));
    expect(res.status).toBe(404);
  });

  it.each<[string, string, Fields]>([
    ['신고 유형이 목록에 없으면', 'category', { category: 'fire' }],
    ['위도만 있고 경도가 없으면', 'lng', { lng: '' }],
    ['위도가 범위를 벗어나면', 'lat', { lat: '120' }],
  ])('%s 400', async (_, field, over) => {
    const fields = report(over);
    if (over.lng === '') delete fields.lng;
    const res = await submit(fields);
    expect(res.status).toBe(400);
    expect(res.body.error.issues.map((i: { path: string[] }) => i.path[0])).toEqual([field]);
  });
});

describe('GET /records/me', () => {
  it('이번 달 내 기록을 최신순으로, 신고는 처리 상태와 함께 준다', async () => {
    await approveCaregiver(me.id, tree);
    const other = await createUser();
    const act = await submit(activity());
    const rep = await submit(report());
    await submit(report(), [], other.token);
    // 지난달 기록은 이번 달 목록에 안 나온다
    await getPool().query(
      `INSERT INTO records (tree_id, user_id, type, activity_date, activity_kind, duration_min)
       VALUES ($1, $2, 'activity', $3, '쓰레기 줍기', 20)`,
      [tree, me.id, seoulDate(-45)],
    );

    const res = await request(api).get('/records/me').set(auth(me.token));

    expect(res.status).toBe(200);
    expect(res.body.month).toBe(seoulDate(0).slice(0, 7));
    expect(res.body.records.map((r: { id: number }) => r.id)).toEqual([rep.body.id, act.body.id]);
    expect(res.body.records[0].report.status).toBe('pending');
  });

  it('month 로 다른 달을 고른다', async () => {
    await getPool().query(
      `INSERT INTO records (tree_id, user_id, type, activity_date, activity_kind, duration_min)
       VALUES ($1, $2, 'activity', '2026-10-05', '쓰레기 줍기', 20)`,
      [tree, me.id],
    );
    const res = await request(api).get('/records/me?month=2026-10').set(auth(me.token));
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0]).toMatchObject({ activityDate: '2026-10-05', activityKinds: ['쓰레기 줍기'] });
  });

  it('month 형식이 틀리면 400', async () => {
    const res = await request(api).get('/records/me?month=2026-13').set(auth(me.token));
    expect(res.status).toBe(400);
  });
});
