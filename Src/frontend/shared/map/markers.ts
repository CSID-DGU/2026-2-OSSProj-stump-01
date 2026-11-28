// 마커 구분과 묶음(클러스터). 지도 바탕(카카오·OSM)과 상관없이 같은 규칙을 쓴다.
import type { MapTree } from './types';

/**
 * 마커 종류. 배열 순서가 우선순위다(앞일수록 급함).
 * 한 나무가 여러 조건에 걸리면 앞의 것으로 보이고, 묶음은 안에 든 나무 중 가장 급한 종류의 색을 쓴다.
 * - report: 조치 완료 전인 이상 신고가 있는 나무
 * - inactive: 관리 사각지대. 돌보미는 있는데 이번 달 활동 기록이 없음
 * - cared: 돌보미가 이번 달 활동한 나무
 * - uncared: 관리 사각지대. 이번 달 활동 기간이 걸친 돌보미가 없음(대부분의 가로수)
 */
export const MARKER_KINDS = ['report', 'inactive', 'cared', 'uncared'] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

export const MARKER_LABEL: Record<MarkerKind, string> = {
  report: '미처리 신고',
  inactive: '활동이 끊긴 나무',
  cared: '돌보미 나무',
  uncared: '돌보미 없는 나무',
};

export function markerKind(tree: MapTree): MarkerKind {
  if (tree.hasOpenReport) return 'report';
  if (tree.careGap === 'inactive') return 'inactive';
  if (tree.careGap === 'no_caregiver') return 'uncared';
  return 'cared';
}

/** 여러 종류 중 가장 급한 것 */
export function mostUrgent(kinds: Iterable<MarkerKind>): MarkerKind {
  let best: MarkerKind = 'uncared';
  for (const k of kinds) if (MARKER_KINDS.indexOf(k) < MARKER_KINDS.indexOf(best)) best = k;
  return best;
}

export type ScreenPoint<T> = { x: number; y: number; item: T };
export type Cluster<T> = { x: number; y: number; items: T[] };

/**
 * 화면 좌표(px)를 cellPx 크기 칸으로 나눠 같은 칸의 점을 하나로 묶는다.
 * 묶음 위치는 칸 안 점들의 평균이다. cellPx가 0이면 묶지 않는다.
 */
export function clusterByGrid<T>(points: ScreenPoint<T>[], cellPx: number): Cluster<T>[] {
  if (cellPx <= 0) return points.map((p) => ({ x: p.x, y: p.y, items: [p.item] }));
  const cells = new Map<string, { sx: number; sy: number; items: T[] }>();
  for (const p of points) {
    const key = `${Math.floor(p.x / cellPx)}:${Math.floor(p.y / cellPx)}`;
    const cell = cells.get(key);
    if (cell) {
      cell.sx += p.x;
      cell.sy += p.y;
      cell.items.push(p.item);
    } else {
      cells.set(key, { sx: p.x, sy: p.y, items: [p.item] });
    }
  }
  return [...cells.values()].map((c) => ({ x: c.sx / c.items.length, y: c.sy / c.items.length, items: c.items }));
}
