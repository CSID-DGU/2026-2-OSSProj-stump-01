// GET /trees (#4). 나무 지도(#27)가 화면 범위 안의 나무를 받는다. 형식은 Src/backend/openapi.yaml의 Tree와 같다.
import type { Bbox, MapTree } from '../../../shared/map';
import { api } from './client';

// 한 번에 받는 나무 수. API 최대값(2000)까지 받아 묶음(클러스터)으로 보여 준다
export const TREE_LIST_LIMIT = 2000;

export type Tree = MapTree & {
  code: string | null; // 관리번호 "자치구코드-순번"
  species: string;
  district: string;
  dong: string | null;
  roadName: string | null;
};

export type TreeList = { trees: Tree[]; truncated: boolean };

export function listTrees(bbox: Bbox, opts: { district?: string; limit?: number } = {}): Promise<TreeList> {
  return api<TreeList>('/trees', {
    query: { bbox: bbox.map((n) => n.toFixed(6)).join(','), district: opts.district, limit: opts.limit ?? TREE_LIST_LIMIT },
  });
}

/** GET /trees/{id}. 지도에서 나무를 누르면 관리번호·위치 같은 자세한 정보를 다시 받는다 */
export function getTree(id: number): Promise<Tree> {
  return api<Tree>(`/trees/${id}`);
}
