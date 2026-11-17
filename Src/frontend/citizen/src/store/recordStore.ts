// 가짜 기록 저장소. API(#5 날짜별 활동 기록·이상 신고 생성 API)가 나오기 전까지 쓴다.
// 기록을 브라우저(localStorage)에 저장해서 새로고침해도 남게 한다.
// 사진 파일은 크기가 커서 저장하지 않고 장 수만 남긴다.
import { useSyncExternalStore } from 'react'
import { isThisMonth } from '../lib/date'
import { sampleRecordDates } from '../mocks/sample'

export type ActivityRecord = {
  id: string
  type: 'activity' // 날짜별 활동 기록 (records.type = activity)
  treeId: number
  date: string // "2026-11-12"
  activities: string[] // 한 일
  note: string // 짧은 글
  minutes: number // 활동 시간(분)
  photoCount: number
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

const STORAGE_KEY = 'treecare.records.v1'

function load(): TreeRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as TreeRecord[]) : []
  } catch {
    return []
  }
}

let records: TreeRecord[] = load()
const listeners = new Set<() => void>()

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // 저장 공간이 막혀 있어도 화면은 계속 동작하게 둔다
  }
  listeners.forEach((listener) => listener())
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function addActivity(input: Omit<ActivityRecord, 'id' | 'type' | 'createdAt'>): ActivityRecord {
  const record: ActivityRecord = { ...input, id: newId(), type: 'activity', createdAt: new Date().toISOString() }
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

// React 화면에서 기록 목록을 쓰는 방법. 기록이 바뀌면 화면이 다시 그려진다.
export function useRecords(): TreeRecord[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => records,
  )
}

// 이번 달에 활동 기록이 있는 날짜 수 (가짜 과거 기록 + 저장한 기록, 같은 날은 한 번만)
export function countRecordDaysThisMonth(list: TreeRecord[]): number {
  const days = new Set(sampleRecordDates)
  list.forEach((r) => {
    if (r.type === 'activity' && isThisMonth(r.date)) days.add(r.date)
  })
  return days.size
}
