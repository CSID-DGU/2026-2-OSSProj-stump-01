// 월간 보고서 취합. 화면·API·DB와 분리된 순수 함수로 둔다(CLAUDE.md: 보고서 취합 로직은 분리).
// 같은 입력이면 항상 같은 결과를 낸다. DB에서 기록을 읽는 일은 monthly-reports.ts 가 한다.
import { MONTHLY_REPORT_FIELDS, type MonthlyReportFieldKey } from './monthly-report-form.js';

/** 취합에 쓰는 활동 기록 한 건 */
export type DraftSource = {
  recordId: number;
  date: string; // 활동일 'YYYY-MM-DD'
  treeId: number;
  treeName: string; // "은행나무, 명동길"
  agency: string; // 나무의 관리청 = 보고서를 낼 곳
  activityKinds: string[];
  minutes: number;
  photoCount: number;
  memo: string | null;
};

export type DraftRow = {
  recordId: number;
  values: Record<MonthlyReportFieldKey, string | number>; // 양식 항목 키 → 칸에 들어갈 값
};

export type ReportDraft = {
  fields: typeof MONTHLY_REPORT_FIELDS; // 칸 순서와 이름
  rows: DraftRow[]; // 날짜순, 같은 날이면 나무 이름순
  dates: string[];
  totalMinutes: number; // 묶인 기록의 활동 시간 합계
  treeCount: number;
  agencies: string[]; // 관리청 (가나다순). 둘 이상이면 제출할 수 없다
};

const KIND_JOINER = ', ';

export function buildDraft(records: DraftSource[]): ReportDraft {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.treeName.localeCompare(b.treeName, 'ko'));

  const rows = sorted.map((r) => {
    const all: Record<MonthlyReportFieldKey, string | number> = {
      date: r.date,
      treeName: r.treeName,
      activities: r.activityKinds.join(KIND_JOINER),
      minutes: r.minutes,
      photoCount: r.photoCount,
      note: r.memo ?? '',
    };
    // 양식에 있는 항목만, 양식 순서대로 담는다
    const values = Object.fromEntries(MONTHLY_REPORT_FIELDS.map((f) => [f.key, all[f.key]])) as DraftRow['values'];
    return { recordId: r.recordId, values };
  });

  return {
    fields: MONTHLY_REPORT_FIELDS,
    rows,
    dates: [...new Set(sorted.map((r) => r.date))],
    totalMinutes: sorted.reduce((sum, r) => sum + r.minutes, 0),
    treeCount: new Set(sorted.map((r) => r.treeId)).size,
    agencies: [...new Set(sorted.map((r) => r.agency))].sort((a, b) => a.localeCompare(b, 'ko')),
  };
}
