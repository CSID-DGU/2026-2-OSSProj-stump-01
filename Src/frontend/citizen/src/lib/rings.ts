// 디지털 나이테 규칙 (#44). 화면과 분리된 순수 함수다.
// 용어(Src/용어.md): 1년 1겹, 월별 12조각. 두께 = 받은 비와 돌봄, 색 = 더위, 점 = 활동한 날,
// 별 = 이야기, 표식 = 신고·조치·받은 호응.
// 두께는 돌보미 개인 활동이 아니라 "나무가 받은 것"이라 비가 많이 온 달도 두꺼워진다. 돌보미가 자책하지 않게 하려는 것이다.
import type { RingMonth, StoryEntry, TreeRings } from './api'

// ---- 기준값 (임시값, #12에서 두께 산정 방식이 정해지면 고친다) ----
export const RAIN_FULL_MM = 200 // 한 달 강수가 이만큼이면 "비" 몫이 가득
export const CARE_FULL_MINUTES = 600 // 한 달 돌봄이 10시간이면 "돌봄" 몫이 가득
export const RAIN_SHARE = 0.5 // 두께에서 비가 차지하는 몫 (나머지는 돌봄)
export const THICKNESS_MIN = 10 // 아무것도 받지 않은 달의 두께(px)
export const THICKNESS_MAX = 36 // 비와 돌봄을 가득 받은 달의 두께(px)
export const HEAT_DAYS_HOT = 3 // 폭염(최고기온 33℃ 이상)인 날이 이만큼 있으면 가장 더운 색

// 받은 비와 돌봄 → 두께(px)
export function ringThickness(m: RingMonth): number {
  if (m.rainMm === null && m.careMinutes === 0) return THICKNESS_MIN
  const rain = Math.min((m.rainMm ?? 0) / RAIN_FULL_MM, 1)
  const care = Math.min(m.careMinutes / CARE_FULL_MINUTES, 1)
  return THICKNESS_MIN + (THICKNESS_MAX - THICKNESS_MIN) * (RAIN_SHARE * rain + (1 - RAIN_SHARE) * care)
}

// 더위 → 색 단계. none: 아직 오지 않은 달 (CSS 클래스 ring-heat-* 와 짝)
export type HeatLevel = 'none' | 'cold' | 'cool' | 'mild' | 'warm' | 'hot'

export function heatLevel(m: RingMonth): HeatLevel {
  if (m.heatDays >= HEAT_DAYS_HOT) return 'hot'
  const t = m.tempMaxAvg
  if (t === null) return 'none'
  if (t >= 28 || m.heatDays > 0) return 'warm'
  if (t >= 18) return 'mild'
  if (t >= 8) return 'cool'
  return 'cold'
}

export const HEAT_LABEL: Record<HeatLevel, string> = {
  none: '아직',
  cold: '추운 달',
  cool: '선선한 달',
  mild: '따뜻한 달',
  warm: '더운 달',
  hot: '폭염이 잦던 달',
}

// 그 달이 아직 오지 않았는지 (그리지 않고 바탕만 둔다)
export function isFuture(year: number, month: number, today: string): boolean {
  const [ty, tm] = today.split('-').map(Number)
  return year > ty || (year === ty && month > tm)
}

// ---- 예시 데이터 ----
// 나이테 API(#12)가 아직 없을 때 화면을 보여 주려고 만든다. 화면에 "예시"라고 반드시 표시한다.
// 이야기 별은 그 나무의 진짜 공개 이야기를 쓰고, 날씨는 서울 평년 값에 가깝게, 돌봄·신고·호응은 나무 번호로 정한 값이다.

const SEOUL_RAIN = [17, 25, 47, 72, 103, 129, 414, 348, 141, 52, 52, 22] // 월 강수(mm) 대략
const SEOUL_TMAX = [2, 5, 11, 18, 24, 27, 29, 30, 26, 20, 12, 4] // 월 평균 최고기온(℃) 대략
const SEOUL_HEAT = [0, 0, 0, 0, 0, 0, 4, 7, 1, 0, 0, 0] // 폭염일 대략

// 같은 나무·같은 달이면 늘 같은 값이 나오는 0~1 수 (화면이 새로 그려져도 예시가 바뀌지 않게)
function seeded(treeId: number, year: number, month: number, salt: number): number {
  let x = (treeId * 73856093) ^ (year * 19349663) ^ (month * 83492791) ^ (salt * 2654435761)
  x = (x ^ (x >>> 13)) * 1274126177
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295
}

export function sampleRings(treeId: number, year: number, stories: StoryEntry[], today: string): TreeRings {
  const months: RingMonth[] = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const r = (salt: number) => seeded(treeId, year, month, salt)
    const monthStories = stories
      .map((s) => ({ s, d: new Date(s.createdAt) }))
      .filter(({ d }) => d.getFullYear() === year && d.getMonth() + 1 === month)
    if (isFuture(year, month, today)) {
      return { month, rainMm: null, tempMaxAvg: null, heatDays: 0, careMinutes: 0, careCount: 0, activityDays: [], stories: [], reported: 0, resolved: 0, reactions: 0 }
    }
    const days = new Date(year, month, 0).getDate()
    const activityDays = [...new Set(Array.from({ length: Math.floor(r(1) * 9) }, (_, k) => 1 + Math.floor(r(10 + k) * days)))].sort((a, b) => a - b)
    return {
      month,
      rainMm: Math.round(SEOUL_RAIN[i] * (0.6 + r(2) * 0.8)),
      tempMaxAvg: SEOUL_TMAX[i] + Math.round((r(3) - 0.5) * 4),
      heatDays: SEOUL_HEAT[i] > 0 ? Math.round(SEOUL_HEAT[i] * (0.5 + r(4))) : 0,
      careMinutes: activityDays.length * (20 + Math.floor(r(5) * 3) * 10),
      careCount: activityDays.length,
      activityDays,
      stories: monthStories.map(({ s, d }) => ({ id: s.id, day: d.getDate() })),
      reported: r(6) > 0.9 ? 1 : 0,
      resolved: r(7) > 0.93 ? 1 : 0,
      reactions: monthStories.reduce((sum, { s }) => sum + s.likeCount + s.replyCount, 0) + (r(8) > 0.88 ? 1 + Math.floor(r(9) * 3) : 0),
    }
  })
  return { treeId, year, months }
}

// 한 달 요약 문장 (조각을 눌렀을 때 아래에 보여 줄 것, 화면 낭독기 설명에도 쓴다)
export function monthSummary(m: RingMonth): string {
  const parts: string[] = []
  if (m.rainMm !== null) parts.push(`비 ${m.rainMm}mm`)
  if (m.tempMaxAvg !== null) parts.push(`평균 최고 ${m.tempMaxAvg}°`)
  if (m.heatDays > 0) parts.push(`폭염 ${m.heatDays}일`)
  parts.push(m.careCount > 0 ? `돌봄 ${m.careCount}번` : '돌봄 없음')
  if (m.stories.length > 0) parts.push(`이야기 ${m.stories.length}편`)
  if (m.reported > 0) parts.push(`신고 ${m.reported}건`)
  if (m.resolved > 0) parts.push(`조치 ${m.resolved}건`)
  if (m.reactions > 0) parts.push(`호응 ${m.reactions}`)
  return parts.join(' · ')
}
