// 월간 보고서 양식: 보고서 한 줄(활동 기록 하나)에 넣을 항목과 순서.
// 구청 보고서 양식(#59)이 확인되면 이 파일만 고친다. 취합 코드에는 항목을 직접 쓰지 않는다.
// 시민 웹의 content/reportForm.ts(REPORT_FIELDS)와 키·이름을 맞춘다. 지금 값은 임시값이다.
export const MONTHLY_REPORT_FIELDS = [
  { key: 'date', label: '날짜' },
  { key: 'treeName', label: '나무' },
  { key: 'activities', label: '한 일' },
  { key: 'minutes', label: '활동 시간' },
  { key: 'photoCount', label: '사진' },
  { key: 'note', label: '메모' },
] as const;

export type MonthlyReportFieldKey = (typeof MONTHLY_REPORT_FIELDS)[number]['key'];
