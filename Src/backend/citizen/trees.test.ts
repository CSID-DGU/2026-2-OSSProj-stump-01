import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createActivity, createApplication, createTree, createUser, resetData } from '../test/fixtures.js';
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

  it('관리 사각지대 상태(careGap)를 이번 달 기준으로 준다 (#22)', async () => {
    // 날짜에 흔들리지 않게 오늘(한국 시간)을 기준으로 활동 기간과 활동일을 잡는다
    const { rows } = await getPool().query<{ today: string; start: string; end: string }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS today, to_char(d - 30, 'YYYY-MM-DD') AS start, to_char(d + 30, 'YYYY-MM-DD') AS end
       FROM (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS d) x`,
    );
    const { today, start, end } = rows[0]!;
    const officer = await createUser({ role: 'officer' });
    const citizen = await createUser();
    const [none, pendingOnly, inactive, active] = [await createTree(), await createTree(), await createTree(), await createTree()];
    await createApplication({ userId: citizen.id, treeId: pendingOnly, periodStart: start, periodEnd: end }); // 대기 중은 돌보미가 아니다
    for (const treeId of [inactive, active]) {
      await createApplication({ userId: citizen.id, treeId, status: 'approved', reviewedBy: officer.id, periodStart: start, periodEnd: end });
    }
    await createActivity({ userId: citizen.id, treeId: active, date: today });

    const res = await request(api).get(`/trees?bbox=${BBOX}`);
    const gapOf = (id: number) => res.body.trees.find((t: { id: number }) => t.id === id).careGap;
    expect([gapOf(none), gapOf(pendingOnly), gapOf(inactive), gapOf(active)]).toEqual(['no_caregiver', 'no_caregiver', 'inactive', null]);

    const detail = await request(api).get(`/trees/${inactive}`);
    expect(detail.body.careGap).toBe('inactive');
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

describe('나무 이름 (같은 길·같은 수종 나무 구분)', () => {
  const assign = () => getPool().query('SELECT assign_tree_codes()');
  const nameOf = async (id: number) => (await request(api).get(`/trees/${id}`)).body.name as string;

  it('이름은 "수종, 길 N번". N 은 같은 길의 나무를 관리번호 순(서쪽부터)으로 센 번호다', async () => {
    const west = await createTree({ lng: 126.97, roadName: '소파로' });
    const east = await createTree({ lng: 126.971, roadName: '소파로', species: '느티나무' });
    const otherRoad = await createTree({ lng: 126.9705, roadName: '을지로' });
    await assign();

    expect(await nameOf(west)).toBe('은행나무, 소파로 1번');
    expect(await nameOf(east)).toBe('느티나무, 소파로 2번');
    expect(await nameOf(otherRoad)).toBe('은행나무, 을지로 1번');
    // 목록에도 같은 이름
    const list = await request(api).get(`/trees?bbox=${BBOX}`);
    expect(list.body.trees.map((t: { name: string }) => t.name).sort()).toEqual(['느티나무, 소파로 2번', '은행나무, 소파로 1번', '은행나무, 을지로 1번']);
  });

  it('같은 이름의 길이 여러 구에 있어도 번호를 이어 매겨 서울 전체에서 이름이 겹치지 않는다', async () => {
    const jung = await createTree({ agency: '중구', roadName: '세종대로' });
    const jongno = await createTree({ agency: '종로구', roadName: '세종대로' });
    await assign();

    // 관리번호 순(종로구 11110 → 중구 11140)으로 센다
    expect(await nameOf(jongno)).toBe('은행나무, 세종대로 1번');
    expect(await nameOf(jung)).toBe('은행나무, 세종대로 2번');
  });

  it('번호를 매기기 전(적재 직후)에는 번호 없이 "수종, 길", 길 이름이 없으면 동으로 부른다', async () => {
    const tree = await createTree({ roadName: '소파로' });
    expect(await nameOf(tree)).toBe('은행나무, 소파로');

    await getPool().query('UPDATE trees SET road_name = NULL WHERE id = $1', [tree]);
    await assign();
    expect(await nameOf(tree)).toBe('은행나무, 명동 1번');
  });

  it('다시 돌려도 기존 번호는 그대로, 새 나무는 그 길의 마지막 번호 다음을 받는다', async () => {
    const first = await createTree({ lng: 126.972, roadName: '소파로' });
    await assign();
    const added = await createTree({ lng: 126.97, roadName: '소파로' }); // 더 서쪽이지만 나중에 들어왔다
    await assign();

    expect(await nameOf(first)).toBe('은행나무, 소파로 1번');
    expect(await nameOf(added)).toBe('은행나무, 소파로 2번');
  });

  it('원본 갱신으로 길 이름이 바뀐 나무는 번호를 비웠다가 새 길의 다음 번호를 받는다', async () => {
    const moved = await createTree({ roadName: '소파로' });
    await createTree({ roadName: '을지로' });
    await assign(); // 둘 다 각자 길의 1번

    // 적재 스크립트처럼 길 이름을 고친다. 을지로 1번과 겹치면 안 된다
    await getPool().query(`UPDATE trees SET road_name = '을지로' WHERE id = $1`, [moved]);
    expect(await nameOf(moved)).toBe('은행나무, 을지로');
    await assign();
    expect(await nameOf(moved)).toBe('은행나무, 을지로 2번');
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

describe('GET /trees/:id 양옆 나무 (내 나무 찾아가기)', () => {
  // 위도 37.565 에서 경도 1° ≈ 88.3km. 동서로 미터 단위 간격을 두고 나무를 놓는다
  const LNG = 126.98;
  const LAT = 37.565;
  const east = (meters: number) => LNG + meters / 88_300;

  it('같은 노선에서 가장 가까운 나무와 그 반대쪽 나무의 수종·방향·거리를 준다', async () => {
    const tree = await createTree({ lng: LNG, lat: LAT });
    const eastNear = await createTree({ lng: east(4), lat: LAT });
    await createTree({ lng: east(8), lat: LAT }); // 같은 쪽(동쪽)이라 고르지 않는다
    const westNear = await createTree({ lng: east(-18), lat: LAT, species: '느티나무' });
    await createTree({ lng: east(2), lat: LAT, roadName: '다른길' }); // 더 가깝지만 다른 노선

    const res = await request(api).get(`/trees/${tree}`);

    expect(res.status).toBe(200);
    expect(res.body.neighbors).toEqual([
      { id: eastNear, species: '은행나무', direction: '동', distanceM: 4 },
      { id: westNear, species: '느티나무', direction: '서', distanceM: 18 },
    ]);
  });

  it('반경(50m) 안에 같은 노선 나무가 없으면 빈 목록', async () => {
    const tree = await createTree({ lng: LNG, lat: LAT });
    await createTree({ lng: east(80), lat: LAT });

    const res = await request(api).get(`/trees/${tree}`);

    expect(res.body.neighbors).toEqual([]);
  });
});
