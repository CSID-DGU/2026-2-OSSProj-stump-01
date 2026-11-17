// 월간 보고서 취합 로직. 화면·API와 분리된 순수 함수로 둔다 (CLAUDE.md 규칙).
// 같은 입력이면 항상 같은 결과를 내고, 저장소나 화면을 건드리지 않는다.
import type { ActivityRecord, TreeRecord } from '../store/recordStore'

type TreeLookup = (id: number) => { species: string; place: string; district: string } | undefined

// 그 달("2026-11")의 활동 기록만
export function activitiesInMonth(records: TreeRecord[], month: string): ActivityRecord[] {
  return records.filter((r): r is ActivityRecord => r.type === 'activity' && r.date.startsWith(month))
}

// 보고서에 아직 안 넣은 기록이 있는 날짜 → 고를 수 있는 날
export function selectableDates(records: TreeRecord[], month: string): Set<string> {
  return new Set(activitiesInMonth(records, month).filter((r) => r.monthlyReportId === null).map((r) => r.date))
}

// 기록이 모두 보고서에 들어간 날짜 → "제출함" 표시
export function submittedDates(records: TreeRecord[], month: string): Set<string> {
  const open = selectableDates(records, month)
  return new Set(
    activitiesInMonth(records, month)
      .filter((r) => r.monthlyReportId !== null && !open.has(r.date))
      .map((r) => r.date),
  )
}

export type DraftRow = {
  recordId: string
  date: string
  treeName: string
  activities: string[]
  minutes: number
  photoCount: number
  note: string
}

export type ReportDraft = {
  rows: DraftRow[] // 날짜순, 같은 날이면 나무 이름순
  recordIds: string[]
  dates: string[]
  totalMinutes: number
  treeCount: number
  agencies: string[] // 관리청. 보고서 하나는 관리청 하나에만 낼 수 있다
}

// 고른 날짜의 "아직 안 넣은" 활동 기록을 모아 보고서 초안을 만든다
export function buildDraft(records: TreeRecord[], dates: string[], findTree: TreeLookup): ReportDraft {
  const chosen = new Set(dates)
  const picked = records.filter((r): r is ActivityRecord => r.type === 'activity' && r.monthlyReportId === null && chosen.has(r.date))

  const rows: DraftRow[] = picked
    .map((r) => {
      const tree = findTree(r.treeId)
      return {
        recordId: r.id,
        date: r.date,
        treeName: tree ? `${tree.species}, ${tree.place}` : `나무 ${r.treeId}`,
        activities: r.activities,
        minutes: r.minutes,
        photoCount: r.photoCount,
        note: r.note,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.treeName.localeCompare(b.treeName))

  const agencies = [...new Set(picked.map((r) => findTree(r.treeId)?.district ?? '알 수 없음'))]

  return {
    rows,
    recordIds: rows.map((r) => r.recordId),
    dates: [...new Set(rows.map((r) => r.date))],
    totalMinutes: rows.reduce((sum, r) => sum + r.minutes, 0),
    treeCount: new Set(picked.map((r) => r.treeId)).size,
    agencies,
  }
}
