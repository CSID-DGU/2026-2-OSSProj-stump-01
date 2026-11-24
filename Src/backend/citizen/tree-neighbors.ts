// 내 나무 찾아가기: 거리에서 "양옆 나무"로 내 나무를 확인하게 한다.
// 같은 노선에 같은 수종이 수십 그루 줄지어 있고 GPS 는 5~10m 틀리므로,
// 가장 가까운 나무 하나와 그 반대쪽에서 가장 가까운 나무 하나의 수종·방향·거리를 알려 준다.

// ── 기준값 ──
export const NEIGHBOR_RADIUS_M = 50; // 이 거리 안의 같은 노선 나무만 양옆 후보로 본다
export const NEIGHBOR_CANDIDATES = 20; // 거리순으로 이만큼만 받아 양쪽을 고른다
const OPPOSITE_MIN_ANGLE = 90; // 첫 나무와 방향이 이 각도보다 크게 벌어지면 반대쪽으로 본다

const DIRECTIONS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** DB 가 거리순으로 준 후보. bearing 은 내 나무에서 본 방위각(북쪽 0°, 시계 방향, 0~360) */
export type NeighborCandidate = { id: number; species: string; distanceM: number; bearing: number };

export type TreeNeighbor = { id: number; species: string; direction: Direction; distanceM: number };

/** 방위각 → 8방위 이름 (45°씩, 북쪽은 337.5°~22.5°) */
export function directionLabel(bearing: number): Direction {
  const index = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return DIRECTIONS[index]!;
}

/** 두 방위각 사이의 작은 쪽 각도 (0~180) */
function angleBetween(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** 가장 가까운 나무 + 그 반대쪽에서 가장 가까운 나무. 도로 끝이면 하나, 후보가 없으면 빈 목록 */
export function pickNeighbors(candidates: NeighborCandidate[]): TreeNeighbor[] {
  const first = candidates[0];
  if (!first) return [];
  const opposite = candidates.find((n) => angleBetween(n.bearing, first.bearing) > OPPOSITE_MIN_ANGLE);
  return [first, opposite]
    .filter((n): n is NeighborCandidate => n !== undefined)
    .map((n) => ({ id: n.id, species: n.species, direction: directionLabel(n.bearing), distanceM: Math.round(n.distanceM) }));
}
