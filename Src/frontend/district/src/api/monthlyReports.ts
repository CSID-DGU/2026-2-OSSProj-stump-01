// 월간 보고서 검토 API (#69). 형식은 Src/backend/openapi.yaml의 MonthlyReport·MonthlyReportDetail과 같다.
import { api } from './client';
import type { Page, Person } from './types';

export type ReportStatus = 'submitted' | 'approved' | 'revision_requested';

export type MonthlyReport = {
  id: number;
  status: ReportStatus;
  agency: string;
  totalMinutes: number; // 묶인 기록의 활동 시간 합계(분)
  reviewNote: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: number | null;
  caregiver: Person;
  recordCount: number;
  treeCount: number;
  firstDate: string | null; // YYYY-MM-DD
  lastDate: string | null;
  volunteerMinutes: number | null; // 승인되어 기록된 봉사시간(분)
};

export type Verification = 'none' | 'location' | 'photo';

export type ReportRecord = {
  id: number;
  activityDate: string; // YYYY-MM-DD
  activityKind: string | null;
  durationMin: number;
  memo: string | null;
  photoUrl: string | null;
  verification: Verification;
  tree: { id: number; species: string; roadName: string | null; address: string | null };
};

export type MonthlyReportDetail = MonthlyReport & { records: ReportRecord[] };

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  submitted: '검토 대기',
  revision_requested: '보완 요청',
  approved: '승인',
};

export const VERIFICATION_LABEL: Record<Verification, string> = {
  none: '확인 없음',
  location: '위치 확인',
  photo: '사진',
};

export function listMonthlyReports(opts: { status: ReportStatus; limit: number; offset: number }) {
  return api<Page<MonthlyReport>>('/admin/monthly-reports', { query: opts });
}

export function getMonthlyReport(id: number) {
  return api<MonthlyReportDetail>(`/admin/monthly-reports/${id}`);
}

export type ReportReview =
  | { status: 'approved'; reviewNote?: string }
  | { status: 'revision_requested'; reviewNote: string };

export function reviewMonthlyReport(id: number, review: ReportReview) {
  return api<MonthlyReportDetail>(`/admin/monthly-reports/${id}`, { method: 'PATCH', body: review });
}
