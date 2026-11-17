// 가짜 저장소. API(#5 기록·신고 생성, #62 월간 보고서)가 나오기 전까지 쓴다.
// 기록과 보고서를 브라우저(localStorage)에 저장해서 새로고침해도 남게 한다.
// 사진 파일은 크기가 커서 저장하지 않고 장 수만 남긴다.
import { useSyncExternalStore } from 'react'
import { isThisMonth } from '../lib/date'
import { sampleActivityRecords, sampleMonthlyReports } from '../mocks/sample'

export type ActivityRecord = {
  id: string
  type: 'activity' // 날짜별 활동 기록 (records.type = activity)
  treeId: number
  date: string // "2026-11-12"
  activities: string[] // 한 일
  note: string // 짧은 글
  minutes: number // 활동 시간(분)
  photoCount: number
  monthlyReportId: string | null // 보고서에 넣었으면 그 보고서 id (records.monthly_report_id)
  createdAt: string
}

export type ReportRecord = {
  id: string
  type: 'report' // 이상 신고 (records.type = report)
  treeId: number
  date: string
  reportType: string // 신고 유형 코드 (reports.category: leaning, broken_branch, pest, withering, other)
  note: string
  photoCount: number
  location: { lat: number; lng: number; accuracy: number } | null // 신고할 때 내 위치 (보내지 않았으면 null)
  status: '확인 필요' | '현장 확인' | '조치 완료'
  createdAt: string
}

export type TreeRecord = ActivityRecord | ReportRecord

// 월간 보고서 (monthly_reports). 상태는 구청이 바꾼다.
export type MonthlyReport = {
  id: string
  month: string // "2026-11"
  agency: string // 낸 관리청
  dates: string[] // 고른 날짜
  recordIds: string[] // 묶인 기록
  totalMinutes: number // 묶인 기록의 활동 시간 합계
  status: 'submitted' | 'approved' | 'revision_requested' // 검토 대기 / 승인 / 보완 요청
  reviewNote: string | null // 구청 의견 (보완 요청 사유)
  submittedAt: string
  volunteerMinutes: number | null // 승인되어 기록된 봉사시간 (승인 전에는 null)
}

const STORAGE_KEY = 'treecare.store.v2'
const OLD_KEY = 'treecare.records.v1' // #39 때 쓰던 저장 이름

type Saved = { records: TreeRecord[]; reports: MonthlyReport[] }

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Saved
    // 처음 열면 예시 기록·보고서를 넣는다. #39 때 저장한 기록이 있으면 같이 가져온다.
    const old = localStorage.getItem(OLD_KEY)
    const oldRecords = old ? (JSON.parse(old) as TreeRecord[]).map(withReportId) : []
    return { records: [...sampleActivityRecords, ...oldRecords], reports: [...sampleMonthlyReports] }
  } catch {
    return { records: [...sampleActivityRecords], reports: [...sampleMonthlyReports] }
  }
}

// 예전 기록에는 monthlyReportId가 없으므로 null로 채운다
function withReportId(r: TreeRecord): TreeRecord {
  return r.type === 'activity' ? { ...r, monthlyReportId: r.monthlyReportId ?? null } : r
}

const initial = load()
let records: TreeRecord[] = initial.records
let reports: MonthlyReport[] = initial.reports
const listeners = new Set<() => void>()

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ records, reports }))
  } catch {
    // 저장 공간이 막혀 있어도 화면은 계속 동작하게 둔다
  }
  listeners.forEach((listener) => listener())
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function addActivity(input: Omit<ActivityRecord, 'id' | 'type' | 'createdAt' | 'monthlyReportId'>): ActivityRecord {
  const record: ActivityRecord = { ...input, id: newId(), type: 'activity', monthlyReportId: null, createdAt: new Date().toISOString() }
  records = [...records, record]
  save()
  return record
}

export function addReport(input: Omit<ReportRecord, 'id' | 'type' | 'createdAt' | 'status'>): ReportRecord {
  const record: ReportRecord = {
    ...input,
    id: newId(),
    type: 'report',
    status: '확인 필요', // 신고 상태는 구청이 바꾼다. 시민 쪽은 처음 값만 넣는다.
    createdAt: new Date().toISOString(),
  }
  records = [...records, record]
  save()
  return record
}

// 월간 보고서 내기: 보고서를 만들고, 묶인 기록에 보고서 id를 채운다 (그 날짜는 다시 못 고름)
export function submitMonthlyReport(input: Pick<MonthlyReport, 'month' | 'agency' | 'dates' | 'recordIds' | 'totalMinutes'>): MonthlyReport {
  const report: MonthlyReport = {
    ...input,
    id: newId(),
    status: 'submitted',
    reviewNote: null,
    submittedAt: new Date().toISOString(),
    volunteerMinutes: null,
  }
  const included = new Set(input.recordIds)
  records = records.map((r) => (r.type === 'activity' && included.has(r.id) ? { ...r, monthlyReportId: report.id } : r))
  reports = [...reports, report]
  save()
  return report
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// React 화면에서 기록 목록을 쓰는 방법. 기록이 바뀌면 화면이 다시 그려진다.
export function useRecords(): TreeRecord[] {
  return useSyncExternalStore(subscribe, () => records)
}

export function useMonthlyReports(): MonthlyReport[] {
  return useSyncExternalStore(subscribe, () => reports)
}

// 이번 달에 활동 기록이 있는 날짜 수 (같은 날은 한 번만)
export function countRecordDaysThisMonth(list: TreeRecord[]): number {
  const days = new Set<string>()
  list.forEach((r) => {
    if (r.type === 'activity' && isThisMonth(r.date)) days.add(r.date)
  })
  return days.size
}
