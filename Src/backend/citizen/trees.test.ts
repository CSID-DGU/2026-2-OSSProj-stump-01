import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createApplication, createTree, createUser, resetData } from '../test/fixtures.js';
import { parseBbox } from './trees.js';

const api = createApp();
// fixtures.createTree 는 경도 126.97 + seq/1e6, 위도 37.56 에 나무를 놓는다. 이 범위면 전부 들어온다.
const BBOX = '126.96,37.55,126.98,37.57';

beforeEach(resetData);
afterAll(closePool);

describe('parseBbox', () => {
  it('정상 입력을 숫자 4개로 바꾼다', () => {
    expect(parseBbox('126.97,37.55,126.99,37.57')).toEqual([126.97, 37.55, 126.99, 37.57]);
  });
  it('순서가 뒤집히거나 서울 밖이거나 개수가 틀리면 400', () => {
    expect(() => parseBbox('126.99,37.55,126.97,37.57')).toThrow();
    expect(() => parseBbox('120,30,121,31')).toThrow();
    expect(() => parseBbox('126.97,37.55')).toThrow();
  });
});

describe('GET /trees', () => {
  it('bbox 안의 나무를 돌보미 수·미처리 신고 여부와 함께 준다 (로그인 없음)', async () => {
    const tree = await createTree({ species: '은행나무' });
    await createTree({ species: '소나무' });
    const citizen = await createUser();
    await createApplication({ userId: citizen.id, treeId: tree, status: 'approved', reviewedBy: (await createUser({ role: 'officer' })).id });
    await createApplication({ userId: (await createUser()).id, treeId: tree }); // 대기 중은 세지 않는다

    const res = await request(api).get(`/trees?bbox=${BBOX}`);

    expect(res.status).toBe(200);
    expect(res.body.trees).toHaveLength(2);
    expect(res.body.truncated).toBe(false);
    const ginkgo = res.body.trees.find((t: { id: number }) => t.id === tree);
    expect(ginkgo).toMatchObject({
      species: '은행나무',
      district: '중구',
      dong: '명동',
      roadName: '명동길',
      caregiverCount: 1,
      hasOpenReport: false,
    });
    expect(ginkgo.location.lat).toBeCloseTo(37.56, 5);
  });

  it('미처리 신고가 있으면 hasOpenReport=true, 조치 완료되면 false', async () => {
    const tree = await createTree();
    const citizen = await createUser();
    const pool = getPool();
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO records (tree_id, user_id, type) VALUES ($1, $2, 'report') RETURNING id`,
      [tree, citizen.id],
    );
    await pool.query(
      `INSERT INTO reports (record_id, category, urgency, agency) VALUES ($1, 'leaning', 'high', '중구')`,
      [rows[0]!.id],
    );
    const open = await request(api).get(`/trees?bbox=${BBOX}`);
    expect(open.body.trees[0].hasOpenReport).toBe(true);

    const officer = await createUser({ role: 'officer' });
    await pool.query(
      `UPDATE reports SET status = 'resolved', inspected_at = now(), resolved_at = now(), handled_by = $1 WHERE record_id = $2`,
      [officer.id, rows[0]!.id],
    );
    const resolved = await request(api).get(`/trees?bbox=${BBOX}`);
    expect(resolved.body.trees[0].hasOpenReport).toBe(false);
  });

  it('district 를 주면 그 구만, limit 에 걸리면 truncated', async () => {
    await createTree({ agency: '중구' });
    await createTree({ agency: '종로구' }); // fixtures 는 agency 를 district 로도 쓴다
    const junggu = await request(api).get(`/trees?bbox=${BBOX}&district=중구`);
    expect(junggu.body.trees).toHaveLength(1);
    expect(junggu.body.trees[0].district).toBe('중구');

    const limited = await request(api).get(`/trees?bbox=${BBOX}&limit=1`);
    expect(limited.body.trees).toHaveLength(1);
    expect(limited.body.truncated).toBe(true);
  });

  it('bbox 가 없거나 limit 이 상한을 넘으면 400', async () => {
    expect((await request(api).get('/trees')).status).toBe(400);
    expect((await request(api).get(`/trees?bbox=${BBOX}&limit=99999`)).status).toBe(400);
  });

  it('관리번호는 assign_tree_codes() 가 자치구코드-순번으로 채운다', async () => {
    const tree = await createTree({ agency: '중구' });
    const before = await request(api).get(`/trees/${tree}`);
    expect(before.body.code).toBeNull();

    const { rows } = await getPool().query<{ assign_tree_codes: number }>('SELECT assign_tree_codes()');
    expect(rows[0]!.assign_tree_codes).toBe(1);
    const after = await request(api).get(`/trees/${tree}`);
    expect(after.body.code).toBe('11140-00001');

    // 다시 돌려도 기존 번호는 그대로, 새 나무만 이어서 번호를 받는다
    const second = await createTree({ agency: '중구' });
    await getPool().query('SELECT assign_tree_codes()');
    expect((await request(api).get(`/trees/${tree}`)).body.code).toBe('11140-00001');
    expect((await request(api).get(`/trees/${second}`)).body.code).toBe('11140-00002');
  });
});

describe('GET /trees/:id', () => {
  it('상세에는 관리청·주소·같은 노선·동의 나무 수가 있다', async () => {
    const tree = await createTree();
    await createTree(); // 같은 노선(명동길)·동(명동)
    const res = await request(api).get(`/trees/${tree}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: tree,
      agency: '중구',
      address: '서울특별시 중구 명동 1',
      sameRoadCount: 2,
      sameDongCount: 2,
      caregiverCount: 0,
    });
  });

  it('상위 10종 수종이면 수종 카드를 붙이고, 아니면 null', async () => {
    const ginkgo = await createTree({ species: '은행나무 암나무' });
    const rare = await createTree({ species: '산딸나무' });

    const withCard = await request(api).get(`/trees/${ginkgo}`);
    const withoutCard = await request(api).get(`/trees/${rare}`);

    expect(withCard.body.speciesCard).toMatchObject({ id: 'ginkgo', name: '은행나무' });
    expect(withCard.body.speciesCard.seasons.autumn).toBeTruthy();
    expect(withoutCard.body.speciesCard).toBeNull();
  });

  it('없는 나무는 404, 숫자가 아닌 id 는 400', async () => {
    expect((await request(api).get('/trees/999999')).status).toBe(404);
    expect((await request(api).get('/trees/abc')).status).toBe(400);
  });
});
