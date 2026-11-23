// 돌보미 신청서 화면의 선택지·안내 문구·기준값.
// 항목은 구청 「나무돌보미(Adopt a Tree) 신청서(안)」 양식을 따른다 (백엔드 citizen/applications.ts와 같은 기준).
// 구청 양식이 바뀌면(#59) 이 파일과 백엔드를 같이 고친다.

export const PARTICIPATION_TYPES = [
  { code: 'individual', label: '개인·가족' },
  { code: 'company', label: '기업' },
  { code: 'civic_group', label: '시민단체' },
  { code: 'religious_group', label: '종교단체' },
  { code: 'village_community', label: '마을공동체' },
  { code: 'other', label: '기타' },
] as const

export type ParticipationType = (typeof PARTICIPATION_TYPES)[number]['code']

export function participationLabel(code: string | null): string {
  return PARTICIPATION_TYPES.find((t) => t.code === code)?.label ?? '-'
}

// 서버와 같은 기준값
export const MAX_TREES = 10 // 한 번에 신청할 수 있는 나무 수 (임시값)
export const PERIOD_YEARS = 1 // 활동 기간 (양식: 1년 기본)
export const NAME_MAX = 100
export const ADDRESS_MAX = 200
export const MOTIVATION_MAX = 500
export const LONG_TEXT_MAX = 2000
export const HEADCOUNT_MAX = 1000

// 참여 안내 사항 (동의해야 신청할 수 있다). 시민은 기록·신고까지만 한다는 팀 규칙을 함께 안내한다.
export const PARTICIPATION_NOTICE = [
  '나무돌보미는 봉사 활동이라 비용이 들지 않아요.',
  '보호틀 정리, 주변 쓰레기 줍기처럼 나무 둘레를 돌보고, 활동한 날을 기록해 주세요.',
  '가지치기나 약제 처리는 하지 않아요. 나무가 아파 보이면 앱으로 신고해 주시면 구청이 조치해요.',
  '활동 기록은 월간 보고서로 묶어 구청에 내고, 구청이 승인하면 봉사시간으로 기록돼요.',
  '신청서의 이름·연락처·주소는 심사와 연락에만 쓰이고, 관리청 담당자만 볼 수 있어요.',
]

// 신청서 상태 (caregiver_applications.status → 화면)
export const APPLICATION_STATUS = {
  pending: { label: '심사 대기', className: 'tc-status--wait' },
  approved: { label: '승인', className: 'tc-status--done' },
  rejected: { label: '반려', className: 'tc-status--alert' },
  ended: { label: '종료', className: 'tc-status--wait' },
} as const
