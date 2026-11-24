// 내가 이 나무의 돌보미인지 (승인됐고 오늘이 활동 기간 안). 서버(#64 이야기 쓰기)와 같은 기준이다.
import type { MyApplication } from './api'
import { todayKey } from './date'

// 내가 신청한 나무인지 (심사 대기 중이거나, 승인됐고 활동 기간이 아직 안 끝남). "내 나무 찾아가기"를 보여 줄지 정한다
export function isMyTree(applications: MyApplication[], treeId: number): boolean {
  const today = todayKey()
  return applications.some((a) => a.tree.id === treeId && (a.status === 'pending' || (a.status === 'approved' && today <= a.periodEnd)))
}

export function isActiveCaregiver(applications: MyApplication[], treeId: number): boolean {
  const today = todayKey()
  return applications.some((a) => a.tree.id === treeId && a.status === 'approved' && a.periodStart <= today && today <= a.periodEnd)
}
