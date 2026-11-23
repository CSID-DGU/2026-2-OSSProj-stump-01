// 지도에서 나무를 구분하는 규칙 (#37 "돌보미 나무·내 나무 구분"). 화면과 분리된 순수 함수다.
// 지도 부품(TreeMap·KakaoTreeMap, 나중에 공용 지도 #27)은 이 결과로 점 모양만 바꾼다.
import type { Tree } from './api'

export type TreeKind = 'mine' | 'cared' | 'waiting'

export const TREE_KIND_LABEL: Record<TreeKind, string> = {
  mine: '내가 돌보는 나무',
  cared: '돌보미가 있는 나무',
  waiting: '돌보미를 기다리는 나무',
}

// mine: 내가 승인된 돌보미인 나무 / cared: 다른 돌보미가 있는 나무 / waiting: 돌보미가 없는 나무
export function treeKind(tree: Tree, myTreeIds: ReadonlySet<number>): TreeKind {
  if (myTreeIds.has(tree.id)) return 'mine'
  if (tree.caregiverCount > 0) return 'cared'
  return 'waiting'
}

export function countKinds(trees: Tree[], myTreeIds: ReadonlySet<number>): Record<TreeKind, number> {
  const counts: Record<TreeKind, number> = { mine: 0, cared: 0, waiting: 0 }
  for (const t of trees) counts[treeKind(t, myTreeIds)]++
  return counts
}
