// 내가 이 나무의 돌보미인지 (승인됐고 오늘이 활동 기간 안). 서버(#64 이야기 쓰기)와 같은 기준이다.
import type { MyApplication } from './api'
import { todayKey } from './date'

export function isActiveCaregiver(applications: MyApplication[], treeId: number): boolean {
  const today = todayKey()
  return applications.some((a) => a.tree.id === treeId && a.status === 'approved' && a.periodStart <= today && today <= a.periodEnd)
}
