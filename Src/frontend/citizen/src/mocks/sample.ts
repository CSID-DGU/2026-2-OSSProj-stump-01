// 가짜 데이터. 백엔드 API(김태형님 담당)가 나오기 전까지 화면을 그리는 데만 쓴다.
// API가 나오면 이 파일 대신 API 응답을 쓴다.
import { toDateKey } from '../lib/date'
import type { ActivityRecord, MonthlyReport } from '../store/recordStore'

export type MyTree = {
  id: number
  species: string // 수종
  place: string // 위치
  district: string // 관리청 (신고·보고서가 가는 곳)
  lastRecordDaysAgo: number // 마지막 기록이 며칠 전인지
  caretakers: number // 함께 돌보는 돌보미 수
}

export const myTrees: MyTree[] = [
  { id: 1, species: '은행나무', place: '명동길 12', district: '중구', lastRecordDaysAgo: 2, caretakers: 3 },
  { id: 2, species: '느티나무', place: '을지로3가역', district: '중구', lastRecordDaysAgo: 9, caretakers: 1 },
]

export function findTree(id: number): MyTree | undefined {
  return myTrees.find((tree) => tree.id === id)
}

export const thisMonth = {
  stories: 2, // 덧붙인 이야기 수
  responses: 9, // 받은 응답 수
  districtChecked: false, // 구청 확인 여부
}

// ---- 처음 열었을 때 저장소에 넣어 두는 예시 기록과 보고서 ----

const now = new Date()
const dayOf = (monthOffset: number, day: number) => toDateKey(new Date(now.getFullYear(), now.getMonth() + monthOffset, day))
const SAMPLE_AT = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

function sampleActivity(id: string, date: string, treeId: number, activities: string[], minutes: number, note: string, reportId: string | null): ActivityRecord {
  return { id, type: 'activity', treeId, date, activities, minutes, note, photoCount: 1, monthlyReportId: reportId, createdAt: SAMPLE_AT }
}

// 지난달 보고서: 이미 내서 구청이 승인한 것
const LAST_MONTH_REPORT_ID = 'sample-report-last-month'
const lastMonthRecords: ActivityRecord[] = [
  sampleActivity('sample-l1', dayOf(-1, 4), 1, ['보호틀 정리'], 30, '보호틀 안 꽁초를 치웠다', LAST_MONTH_REPORT_ID),
  sampleActivity('sample-l2', dayOf(-1, 11), 1, ['쓰레기 줍기', '잎·가지 상태 살피기'], 60, '', LAST_MONTH_REPORT_ID),
  sampleActivity('sample-l3', dayOf(-1, 18), 2, ['주변 잡초 정리'], 60, '', LAST_MONTH_REPORT_ID),
  sampleActivity('sample-l4', dayOf(-1, 25), 1, ['잎·가지 상태 살피기'], 30, '잎이 노랗게 물들기 시작했다', LAST_MONTH_REPORT_ID),
]

// 이번 달: 아직 보고서에 넣지 않은 기록 (1·3·5·7·9·10일 중 오늘 이전)
const thisMonthRecords: ActivityRecord[] = [
  { day: 1, tree: 1, act: ['보호틀 정리'], min: 30, note: '' },
  { day: 3, tree: 2, act: ['쓰레기 줍기'], min: 20, note: '역 출구 쪽에 쓰레기가 많았다' },
  { day: 5, tree: 1, act: ['잎·가지 상태 살피기'], min: 20, note: '' },
  { day: 7, tree: 1, act: ['보호틀 정리', '쓰레기 줍기'], min: 60, note: '' },
  { day: 9, tree: 2, act: ['주변 잡초 정리'], min: 30, note: '' },
  { day: 10, tree: 1, act: ['잎·가지 상태 살피기'], min: 20, note: '잎이 반쯤 노랗게 바뀌었다' },
]
  .filter((s) => s.day < now.getDate())
  .map((s) => sampleActivity(`sample-t${s.day}`, dayOf(0, s.day), s.tree, s.act, s.min, s.note, null))

export const sampleActivityRecords: ActivityRecord[] = [...lastMonthRecords, ...thisMonthRecords]

const lastMonthMinutes = lastMonthRecords.reduce((sum, r) => sum + r.minutes, 0)

export const sampleMonthlyReports: MonthlyReport[] = [
  {
    id: LAST_MONTH_REPORT_ID,
    month: dayOf(-1, 1).slice(0, 7),
    agency: '중구',
    dates: lastMonthRecords.map((r) => r.date),
    recordIds: lastMonthRecords.map((r) => r.id),
    totalMinutes: lastMonthMinutes,
    status: 'approved',
    reviewNote: null,
    submittedAt: new Date(now.getFullYear(), now.getMonth(), 2).toISOString(),
    volunteerMinutes: lastMonthMinutes,
  },
]
