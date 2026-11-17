// 가짜 데이터. 백엔드 API(김태형님 담당)가 나오기 전까지 화면을 그리는 데만 쓴다.
// API가 나오면 이 파일 대신 API 응답을 쓴다.
import { toDateKey } from '../lib/date'

export type MyTree = {
  id: number
  species: string // 수종
  place: string // 위치
  district: string // 관리청 (신고가 가는 곳)
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

// 이번 달에 이미 기록했다고 가정한 날짜(1·3·5·7·9·10일). 오늘보다 뒤인 날은 뺀다.
const today = new Date()
export const sampleRecordDates: string[] = [1, 3, 5, 7, 9, 10]
  .filter((day) => day < today.getDate())
  .map((day) => toDateKey(new Date(today.getFullYear(), today.getMonth(), day)))

export const thisMonth = {
  stories: 2, // 덧붙인 이야기 수
  responses: 9, // 받은 응답 수
  districtChecked: false, // 구청 확인 여부
}
