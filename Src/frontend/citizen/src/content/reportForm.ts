// 월간 보고서 상태 이름과 색 (monthly_reports.status → 화면 표시).
// 보고서 양식 칸의 순서와 이름은 서버가 미리보기(GET /monthly-reports/draft)의 fields로 정해 준다 (#59 확인 후 서버에서 고친다).

export const REPORT_STATUS_LABEL = {
  submitted: '검토 대기',
  approved: '승인',
  revision_requested: '보완 요청',
} as const

// 상태 점 색 (디자인 가이드 Status)
export const REPORT_STATUS_CLASS = {
  submitted: 'tc-status--wait',
  approved: 'tc-status--done',
  revision_requested: 'tc-status--alert',
} as const
