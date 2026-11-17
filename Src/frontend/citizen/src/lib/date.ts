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

// 이번 달은 며칠까지 있는지
export function daysInThisMonth(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
}
