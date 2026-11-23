// 날짜 도우미. 날짜는 "2026-11-12" 같은 문자열(dateKey)로 주고받는다.

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

// Date → "2026-11-12" (휴대폰의 현지 시간 기준)
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayKey(): string {
  return toDateKey(new Date())
}

// "2026-11-12" → "11월 12일 목요일"
export function formatKoreanDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `${m}월 ${d}일 ${WEEKDAYS[date.getDay()]}요일`
}

// "2026-11-12"가 오늘과 같은 달인지
export function isThisMonth(key: string): boolean {
  return key.slice(0, 7) === todayKey().slice(0, 7)
}

// 이번 달 "2026-11"
export function currentMonthKey(): string {
  return todayKey().slice(0, 7)
}

// "2026-11"에서 delta달 옮긴 달 ("2026-11", -1 → "2026-10")
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  return toDateKey(new Date(y, m - 1 + delta, 1)).slice(0, 7)
}

// "2026-11" → "2026년 11월"
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${y}년 ${m}월`
}

// "2026-11-03" → "11월 3일"
export function formatShortDate(key: string): string {
  const [, m, d] = key.split('-').map(Number)
  return `${m}월 ${d}일`
}

// 알림 시각: "방금", "15분 전", "3시간 전", "어제", "11월 20일"
export function formatRelative(iso: string): string {
  const then = new Date(iso)
  const minutes = Math.floor((Date.now() - then.getTime()) / 60000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 60 * 24 && toDateKey(then) === todayKey()) return `${Math.floor(minutes / 60)}시간 전`
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (toDateKey(then) === toDateKey(yesterday)) return '어제'
  return formatShortDate(toDateKey(then))
}

// 활동 종료일: 시작일부터 years년 뒤의 전날 (서버와 같은 규칙). 예: 2026-12-01 → 2027-11-30
export function periodEndOf(start: string, years: number): string {
  const [y, m, d] = start.split('-').map(Number)
  return toDateKey(new Date(y + years, m - 1, d - 1))
}

// "2026-12-01" → "2026년 12월 1일"
export function formatLongDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

// 이번 달은 며칠까지 있는지
export function daysInThisMonth(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
}
