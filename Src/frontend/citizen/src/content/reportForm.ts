// 월간 보고서 미리보기에 보여 줄 항목과 순서.
// 구청 보고서 양식(#59)이 확인되면 이 파일의 순서·이름만 고친다. 화면 코드에는 항목을 직접 쓰지 않는다.
// 지금 값은 임시값이다.

export const REPORT_FIELDS = [
  { key: 'date', label: '날짜' },
  { key: 'treeName', label: '나무' },
  { key: 'activities', label: '한 일' },
  { key: 'minutes', label: '활동 시간' },
  { key: 'photoCount', label: '사진' },
  { key: 'note', label: '메모' },
] as const

export type ReportFieldKey = (typeof REPORT_FIELDS)[number]['key']

// 보고서 상태 이름 (monthly_reports.status → 화면 표시)
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
