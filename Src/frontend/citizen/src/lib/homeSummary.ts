// 홈 화면 요약 계산 (#79). 화면·API와 분리된 순수 함수다 (CLAUDE.md 규칙).
import type { ApiRecord, MyApplication } from './api'

export type MyTreeSummary = {
  id: number
  species: string
  place: string // 노선 → 동 → 자치구 중 있는 것
  lastActivityDate: string | null // 이번 달 마지막 활동 기록 날짜 (없으면 null)
}

export type MonthSummary = {
  activityDays: number // 기록한 날 수 (같은 날 여러 건이면 하루)
  activityMinutes: number // 활동 시간 합계
  notInReportDays: number // 아직 월간 보고서에 넣지 않은 날 수
  openReports: number // 조치 완료 전인 내 이상 신고 수
}

// 지금 돌보는 나무: 승인됐고 오늘이 활동 기간 안인 신청서의 나무 (같은 나무는 한 번)
export function myActiveTrees(applications: MyApplication[], records: ApiRecord[], today: string): MyTreeSummary[] {
  const seen = new Set<number>()
  const trees: MyTreeSummary[] = []
  for (const a of applications) {
    if (a.status !== 'approved' || a.periodStart > today || today > a.periodEnd || seen.has(a.tree.id)) continue
    seen.add(a.tree.id)
    const dates = records
      .filter((r) => r.type === 'activity' && r.tree.id === a.tree.id && r.activityDate)
      .map((r) => r.activityDate as string)
      .sort()
    trees.push({
      id: a.tree.id,
      species: a.tree.species,
      place: a.tree.roadName ?? a.tree.dong ?? a.tree.district,
      lastActivityDate: dates.at(-1) ?? null,
    })
  }
  return trees
}

export function summarizeMonth(records: ApiRecord[]): MonthSummary {
  const activities = records.filter((r) => r.type === 'activity' && r.activityDate)
  const days = new Set(activities.map((r) => r.activityDate))
  const openDays = new Set(activities.filter((r) => r.monthlyReportId === null).map((r) => r.activityDate))
  return {
    activityDays: days.size,
    activityMinutes: activities.reduce((sum, r) => sum + (r.durationMin ?? 0), 0),
    notInReportDays: openDays.size,
    openReports: records.filter((r) => r.type === 'report' && r.report && r.report.status !== 'resolved').length,
  }
}

// 오늘과 날짜 사이의 날 수 ("2026-11-20", "2026-11-23" → 3)
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}
