import { describe, expect, it } from 'vitest';
import { directionLabel, pickNeighbors, type NeighborCandidate } from './tree-neighbors.js';

// 후보는 가까운 순으로 들어온다 (DB 가 거리순으로 준다)
const c = (id: number, distanceM: number, bearing: number, species = '은행나무'): NeighborCandidate => ({ id, species, distanceM, bearing });

describe('directionLabel', () => {
  it('방위각(북쪽 0°, 시계 방향)을 8방위 이름으로 바꾼다', () => {
    expect(directionLabel(0)).toBe('북');
    expect(directionLabel(350)).toBe('북');
    expect(directionLabel(30)).toBe('북동');
    expect(directionLabel(90)).toBe('동');
    expect(directionLabel(135)).toBe('남동');
    expect(directionLabel(200)).toBe('남');
    expect(directionLabel(225)).toBe('남서');
    expect(directionLabel(270)).toBe('서');
    expect(directionLabel(315)).toBe('북서');
  });
});

describe('pickNeighbors', () => {
  it('가장 가까운 나무 하나와, 그 반대쪽에서 가장 가까운 나무 하나를 고른다', () => {
    const picked = pickNeighbors([c(1, 4.2, 90), c(2, 8, 95), c(3, 18.4, 270, '느티나무')]);

    expect(picked).toEqual([
      { id: 1, species: '은행나무', direction: '동', distanceM: 4 },
      { id: 3, species: '느티나무', direction: '서', distanceM: 18 },
    ]);
  });

  it('반대쪽은 첫 나무와 방향이 90°보다 크게 벌어져야 한다 (같은 쪽 두 그루를 고르지 않는다)', () => {
    // 2번은 첫 나무와 80° 차이라 같은 쪽으로 본다. 4번(150° 차이)이 반대쪽이다
    const picked = pickNeighbors([c(1, 3, 10), c(2, 5, 90), c(4, 9, 160)]);

    expect(picked.map((n) => n.id)).toEqual([1, 4]);
  });

  it('359°와 10°처럼 0°를 사이에 둔 방향은 가까운 쪽으로 본다', () => {
    const picked = pickNeighbors([c(1, 3, 355), c(2, 5, 10), c(3, 7, 180)]);

    expect(picked.map((n) => n.id)).toEqual([1, 3]);
  });

  it('도로 끝이라 한쪽에만 나무가 있으면 하나만, 후보가 없으면 빈 목록', () => {
    expect(pickNeighbors([c(1, 4, 90), c(2, 8, 92)]).map((n) => n.id)).toEqual([1]);
    expect(pickNeighbors([])).toEqual([]);
  });
});
