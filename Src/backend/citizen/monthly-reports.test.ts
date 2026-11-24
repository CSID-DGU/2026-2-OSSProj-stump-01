import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createTree, createUser, resetData } from '../test/fixtures.js';

const api = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let me: { id: number; token: string };
let officer: { id: number; token: string };
let treeA: number; // 중구
let treeB: number; // 중구
let treeC: number; // 종로구

beforeEach(async () => {
  await resetData();
  me = await createUser();
  officer = await createUser({ role: 'officer', agency: '중구' });
  treeA = await createTree({ agency: '중구', species: '은행나무' });
  treeB = await createTree({ agency: '중구', species: '느티나무' });
  treeC = await createTree({ agency: '종로구', species: '이팝나무' });
});
afterAll(closePool);

/** 활동 기록을 DB에 바로 넣는다(POST /records 는 활동일을 오늘로 정해서 지난 날짜를 만들 수 없다). */
async function addActivity(opts: { userId?: number; treeId?: number; date: string; minutes?: number; kinds?: string }) {
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO records (tree_id, user_id, type, activity_date, activity_kind, duration_min, memo)
     VALUES ($1, $2, 'activity', $3, $4, $5, '메모') RETURNING id`,
    [opts.treeId ?? treeA, opts.userId ?? me.id, opts.date, opts.kinds ?? '쓰레기 줍기', opts.minutes ?? 30],
  );
  return rows[0]!.id;
}

const submit = (dates: string[], token = me.token) =>
  request(api).post('/monthly-reports').set(auth(token)).send({ dates });

describe('GET /monthly-reports/dates', () => {
  it('보고서에 안 넣은 활동이 있는 날과, 모두 제출한 날을 나눠 준다', async () => {
    await addActivity({ date: '2026-11-03' });
    await addActivity({ date: '2026-11-05' });
    await addActivity({ date: '2026-11-07' });
    await addActivity({ date: '2026-10-30' }); // 다른 달
    const other = await createUser();
    await addActivity({ userId: other.id, date: '2026-11-09' }); // 남의 기록
    await submit(['2026-11-07']);

    const res = await request(api).get('/monthly-reports/dates?month=2026-11').set(auth(me.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ month: '2026-11', openDates: ['2026-11-03', '2026-11-05'], submittedDates: ['2026-11-07'] });
  });

  it('month 형식이 틀리면 400', async () => {
    const res = await request(api).get('/monthly-reports/dates?month=11').set(auth(me.token));
    expect(res.status).toBe(400);
  });
});

describe('GET /monthly-reports/draft', () => {
  it('고른 날짜의 안 넣은 기록을 양식 순서로 채우고 시간을 더한다', async () => {
    await addActivity({ date: '2026-11-05', treeId: treeA, minutes: 20 });
    await addActivity({ date: '2026-11-03', treeId: treeA, minutes: 30, kinds: '쓰레기 줍기, 보호틀 정리' });
    await addActivity({ date: '2026-11-04', minutes: 99 }); // 고르지 않은 날
    await getPool().query('SELECT assign_tree_codes()'); // 나무 이름의 번호를 매긴다

    const res = await request(api).get('/monthly-reports/draft?dates=2026-11-03,2026-11-05').set(auth(me.token));

    expect(res.status).toBe(200);
    expect(res.body.totalMinutes).toBe(50);
    expect(res.body.dates).toEqual(['2026-11-03', '2026-11-05']);
    expect(res.body.agencies).toEqual(['중구']);
    expect(res.body.fields.map((f: { label: string }) => f.label)).toEqual(['날짜', '나무', '한 일', '활동 시간', '사진', '메모']);
    expect(res.body.rows[0].values).toMatchObject({ date: '2026-11-03', activities: '쓰레기 줍기, 보호틀 정리', minutes: 30 });
    expect(res.body.rows[0].values.treeName).toMatch(/^은행나무, 명동길 \d+번$/); // 나무 상세와 같은 이름
  });

  it('dates 가 없거나 날짜 형식이 틀리면 400', async () => {
    expect((await request(api).get('/monthly-reports/draft').set(auth(me.token))).status).toBe(400);
    expect((await request(api).get('/monthly-reports/draft?dates=2026-11-31').set(auth(me.token))).status).toBe(400);
  });
});

describe('POST /monthly-reports', () => {
  it('제출하면 기록에 보고서 번호가 채워지고 관리청 검토 대기 목록에 들어간다', async () => {
    const r1 = await addActivity({ date: '2026-11-03', treeId: treeA, minutes: 30 });
    const r2 = await addActivity({ date: '2026-11-05', treeId: treeB, minutes: 45 });

    const res = await submit(['2026-11-03', '2026-11-05']);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'submitted',
      agency: '중구',
      totalMinutes: 75,
      dates: ['2026-11-03', '2026-11-05'],
      recordCount: 2,
      reviewNote: null,
      volunteerMinutes: null,
    });
    const { rows } = await getPool().query('SELECT id, monthly_report_id FROM records WHERE id = ANY($1) ORDER BY id', [[r1, r2]]);
    expect(rows.map((r) => r.monthly_report_id)).toEqual([res.body.id, res.body.id]);

    const queue = await request(api).get('/admin/monthly-reports').set(auth(officer.token));
    expect(queue.body.items.map((i: { id: number }) => i.id)).toEqual([res.body.id]);
  });

  it('이미 제출한 날짜는 다시 낼 수 없다(400)', async () => {
    await addActivity({ date: '2026-11-03' });
    await submit(['2026-11-03']);

    const again = await submit(['2026-11-03']);

    expect(again.status).toBe(400);
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM monthly_reports');
    expect(rows[0].n).toBe(1);
  });

  it('관리청이 다른 나무가 섞이면 400이고 아무것도 저장하지 않는다', async () => {
    await addActivity({ date: '2026-11-03', treeId: treeA });
    await addActivity({ date: '2026-11-04', treeId: treeC });

    const res = await submit(['2026-11-03', '2026-11-04']);

    expect(res.status).toBe(400);
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM records WHERE monthly_report_id IS NOT NULL');
    expect(rows[0].n).toBe(0);
  });

  it('달이 다른 날짜가 섞이면 400', async () => {
    await addActivity({ date: '2026-10-31' });
    await addActivity({ date: '2026-11-01' });
    const res = await submit(['2026-10-31', '2026-11-01']);
    expect(res.status).toBe(400);
  });

  it('남의 기록은 묶이지 않는다', async () => {
    const other = await createUser();
    await addActivity({ userId: other.id, date: '2026-11-03' });
    const res = await submit(['2026-11-03']);
    expect(res.status).toBe(400);
  });

  it('구청 담당자 계정은 403, 토큰 없으면 401', async () => {
    expect((await submit(['2026-11-03'], officer.token)).status).toBe(403);
    expect((await request(api).post('/monthly-reports').send({ dates: ['2026-11-03'] })).status).toBe(401);
  });
});

describe('GET /monthly-reports/me', () => {
  it('내 보고서를 최신순으로, 구청 검토 결과와 함께 준다', async () => {
    await addActivity({ date: '2026-11-03' });
    await addActivity({ date: '2026-11-05' });
    const first = await submit(['2026-11-03']);
    const second = await submit(['2026-11-05']);
    await getPool().query(
      `UPDATE monthly_reports SET status = 'revision_requested', review_note = '사진을 더 붙여 주세요', reviewed_by = $2, reviewed_at = now()
       WHERE id = $1`,
      [first.body.id, officer.id],
    );

    const res = await request(api).get('/monthly-reports/me').set(auth(me.token));

    expect(res.status).toBe(200);
    expect(res.body.reports.map((r: { id: number }) => r.id)).toEqual([second.body.id, first.body.id]);
    expect(res.body.reports[1]).toMatchObject({ status: 'revision_requested', reviewNote: '사진을 더 붙여 주세요' });
  });
});
