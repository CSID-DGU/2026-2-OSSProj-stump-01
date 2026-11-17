// 활동 기록·이상 신고 화면의 선택 항목과 기준값.
// 구청 보고서 양식(#59)이 확인되면 이 파일만 고친다. 화면 코드에는 항목을 직접 쓰지 않는다.
// 지금 값은 모두 임시값이다.

// 돌봄 기록: "한 일" (여러 개 고를 수 있음)
export const ACTIVITY_OPTIONS = ['보호틀 정리', '쓰레기 줍기', '잎·가지 상태 살피기', '주변 잡초 정리', '기타'] as const

// 이상 신고 유형 (하나만 고름). 시민은 신고까지만 하고 조치는 구청이 한다.
// 값(code)은 백엔드 reports.category와 같다 (Src/backend/db/ERD.md "긴급도" 표). 화면에는 label을 보여 준다.
// 긴급도(urgency)는 시민이 고르지 않고 시민-BE가 유형으로 정한다.
export const REPORT_TYPES = [
  { code: 'leaning', label: '기울어짐·쓰러짐' },
  { code: 'broken_branch', label: '가지 꺾임' },
  { code: 'pest', label: '병해충 의심' },
  { code: 'withering', label: '시듦·고사 의심' },
  { code: 'other', label: '기타' },
] as const

export type ReportCategory = (typeof REPORT_TYPES)[number]['code']

export function reportLabel(code: string): string {
  return REPORT_TYPES.find((t) => t.code === code)?.label ?? code
}

// 활동 시간 선택지 (분)
export const DURATION_OPTIONS = [10, 20, 30, 60, 90, 120] as const

// 짧은 글 최대 글자 수
export const NOTE_MAX_LENGTH = 200

// 한 기록에 올릴 수 있는 사진 수
export const MAX_PHOTOS = 3

// 분을 "1시간 30분"처럼 바꾼다
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}분`
  if (m === 0) return `${h}시간`
  return `${h}시간 ${m}분`
}
