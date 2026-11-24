// #4 나무 조회 (지도·상세·QR). 로그인 없이 쓴다.
import { Router } from 'express';
import { z } from 'zod';
import { careGapSql, type CareGap } from '../common/care-gaps.js';
import { getPool } from '../common/db.js';
import { badRequest, notFound } from '../common/errors.js';
import { treeNameSql } from '../common/tree-name.js';
import { findSpeciesCard, type SpeciesCard } from './species-cards.js';
import { NEIGHBOR_CANDIDATES, NEIGHBOR_RADIUS_M, pickNeighbors, type NeighborCandidate, type TreeNeighbor } from './tree-neighbors.js';

// ── 기준값 ──
const DEFAULT_LIMIT = 500; // 한 번에 내려 주는 나무 수
const MAX_LIMIT = 2000;
const SEOUL_BBOX = { minLng: 126, maxLng: 128, minLat: 37, maxLat: 38 }; // 이 밖의 bbox 는 거절

// ── 요청 형식 ──
const listQuery = z.object({
  bbox: z.string(), // "minLng,minLat,maxLng,maxLat"
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  district: z.string().trim().min(1).optional(), // 자치구 이름. 주면 그 구의 나무만
});
const idParam = z.object({ id: z.coerce.number().int().positive() });

/** "minLng,minLat,maxLng,maxLat" → 숫자 4개. 순서가 틀리거나 서울 밖이면 400 */
export function parseBbox(raw: string): [number, number, number, number] {
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) throw badRequest('bbox 는 숫자 4개를 쉼표로 이어 쓴다. 예: 126.97,37.55,126.99,37.57');
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  if (minLng >= maxLng || minLat >= maxLat) throw badRequest('bbox 는 (서남쪽 경도,위도, 동북쪽 경도,위도) 순서다.');
  if (minLng < SEOUL_BBOX.minLng || maxLng > SEOUL_BBOX.maxLng || minLat < SEOUL_BBOX.minLat || maxLat > SEOUL_BBOX.maxLat) {
    throw badRequest('bbox 가 서울 범위를 벗어났다.');
  }
  return [minLng, minLat, maxLng, maxLat];
}

// ── 응답 형식 ──
export type TreeView = {
  id: number;
  code: string | null; // 관리번호 "자치구코드-순번". 적재 직후 assign_tree_codes() 전이면 null
  name: string; // 화면에 보여 줄 이름 "은행나무, 소파로 3번" (common/tree-name.ts). 서울 전체에서 겹치지 않는다
  species: string;
  location: { lng: number; lat: number };
  district: string;
  dong: string | null;
  roadName: string | null;
  caregiverCount: number; // 승인된 돌보미 수
  hasOpenReport: boolean; // 미처리(조치 완료 전) 이상 신고가 있는지
  careGap: CareGap | null; // 관리 사각지대(#22): 돌보미 없음 / 이번 달 활동 끊김. 지도에 "관리가 필요한 나무"로 보여 준다
};

export type TreeDetailView = TreeView & {
  agency: string; // 관리청. 신고 배정·돌보미 심사 기준
  address: string | null;
  sameRoadCount: number; // 같은 자치구·노선의 나무 수
  sameDongCount: number; // 같은 자치구·동의 나무 수
  speciesCard: SpeciesCard | null; // 수종별 기본 콘텐츠 카드. 상위 10종 밖이면 null
  neighbors: TreeNeighbor[]; // 양옆 나무(같은 노선, 50m 안). 거리에서 내 나무를 확인하는 표시. 가까운 나무 → 반대쪽 나무 순
};

type TreeRow = {
  id: number;
  code: string | null;
  name: string;
  species: string;
  lng: number;
  lat: number;
  district: string;
  dong: string | null;
  road_name: string | null;
  caregiver_count: number;
  has_open_report: boolean;
  care_gap: CareGap | null;
};

type TreeDetailRow = TreeRow & { agency: string; address: string | null; same_road_count: number; same_dong_count: number };

// 목록·상세가 같은 컬럼을 쓰도록 SELECT 를 하나로 둔다
const SELECT_TREE = `
  SELECT t.id, t.code, ${treeNameSql('t')} AS name, t.species, ST_X(t.location::geometry) AS lng, ST_Y(t.location::geometry) AS lat,
         t.district, t.dong, t.road_name,
         (SELECT count(*)::int FROM caregiver_applications a WHERE a.tree_id = t.id AND a.status = 'approved') AS caregiver_count,
         EXISTS (SELECT 1 FROM reports r JOIN records rc ON rc.id = r.record_id
                 WHERE rc.tree_id = t.id AND r.status <> 'resolved') AS has_open_report,
         ${careGapSql('t')} AS care_gap`;

function toView(r: TreeRow): TreeView {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    species: r.species,
    location: { lng: r.lng, lat: r.lat },
    district: r.district,
    dong: r.dong,
    roadName: r.road_name,
    caregiverCount: r.caregiver_count,
    hasOpenReport: r.has_open_report,
    careGap: r.care_gap,
  };
}

// ── 라우터 (/trees) ──
export const treesRouter = Router();

// 지도 범위 안의 나무. 공간 인덱스(GiST)로 찾는다. limit 에 걸리면 truncated=true (지도를 더 확대하라는 뜻)
treesRouter.get('/', async (req, res) => {
  const { bbox, limit, district } = listQuery.parse(req.query);
  const [minLng, minLat, maxLng, maxLat] = parseBbox(bbox);
  const { rows } = await getPool().query<TreeRow>(
    `${SELECT_TREE}
     FROM trees t
     WHERE ST_Intersects(t.location, ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography)
       AND ($6::text IS NULL OR t.district = $6)
     LIMIT $5`,
    [minLng, minLat, maxLng, maxLat, limit, district ?? null],
  );
  res.json({ trees: rows.map(toView), truncated: rows.length >= limit });
});

// 나무 상세. QR 이야기 페이지도 이걸 쓴다(로그인 없음)
treesRouter.get('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const pool = getPool();
  const [{ rows }, neighborRows] = await Promise.all([
    pool.query<TreeDetailRow>(
      `${SELECT_TREE}, t.agency, t.address,
              (SELECT count(*)::int FROM trees s WHERE s.district = t.district AND s.road_name IS NOT DISTINCT FROM t.road_name) AS same_road_count,
              (SELECT count(*)::int FROM trees s WHERE s.district = t.district AND s.dong IS NOT DISTINCT FROM t.dong) AS same_dong_count
       FROM trees t WHERE t.id = $1`,
      [id],
    ),
    // 양옆 나무 후보: 같은 자치구·노선, 반경 안, 가까운 순. 방위각은 내 나무에서 본 방향(북쪽 0°, 시계 방향)
    pool.query<{ id: number; species: string; distance_m: number; bearing: number }>(
      `WITH me AS (SELECT location, district, road_name FROM trees WHERE id = $1)
       SELECT n.id, n.species,
              ST_Distance(n.location, me.location) AS distance_m,
              degrees(ST_Azimuth(me.location, n.location)) AS bearing
       FROM trees n, me
       WHERE n.id <> $1 AND n.district = me.district AND n.road_name IS NOT DISTINCT FROM me.road_name
         AND ST_DWithin(n.location, me.location, $2)
       ORDER BY distance_m
       LIMIT $3`,
      [id, NEIGHBOR_RADIUS_M, NEIGHBOR_CANDIDATES],
    ),
  ]);
  const candidates: NeighborCandidate[] = neighborRows.rows.map((n) => ({ id: n.id, species: n.species, distanceM: n.distance_m, bearing: n.bearing }));
  const row = rows[0];
  if (!row) throw notFound('나무를 찾을 수 없다.');
  const view: TreeDetailView = {
    ...toView(row),
    agency: row.agency,
    address: row.address,
    sameRoadCount: row.same_road_count,
    sameDongCount: row.same_dong_count,
    speciesCard: findSpeciesCard(row.species),
    neighbors: pickNeighbors(candidates),
  };
  res.json(view);
});
