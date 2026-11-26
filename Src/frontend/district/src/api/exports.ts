// 상부 보고·표창 대상 내려받기 API (#73). 형식은 Src/backend/openapi.yaml의 /admin/exports/*와 같다.
// format=json은 화면 미리보기, format=csv(기본)는 엑셀에서 바로 열리는 파일이다.
import { api, apiDownload } from './client';

type Org = { id: number; name: string } | null;

/** 구·동 한 줄(또는 합계)의 돌봄 현황 */
export type ExportRegionCounts = {
  trees: number; // 관리 나무
  caredTrees: number; // 그 달 돌보미가 있던 나무
  caregivers: number; // 그 달 활동 기간이 걸친 돌보미
  activityRecords: number;
  activityMinutes: number;
  volunteerMinutes: number; // 그 달 승인된 봉사시간(기록한 나무 위치 기준)
  volunteerPeople: number;
  incidentsReceived: number;
  incidentsResolved: number;
};

export type MonthlyExport = {
  agency: string;
  month: string;
  organization: Org;
  regions: (ExportRegionCounts & { district: string; dong: string | null })[];
  totals: ExportRegionCounts;
  monthlyReports: { submitted: number; approved: number; revisionRequested: number };
  rentals: { item: string; approvedQuantity: number; receivedQuantity: number }[];
};

export type Commendation = {
  rank: number;
  userId: number;
  nickname: string;
  realName: string | null;
  volunteerMinutes: number; // 그 해 승인된 봉사시간(분)
  approvedReports: number;
  trees: number;
};

export type CommendationExport = {
  agency: string;
  year: number;
  minHours: number;
  organization: Org;
  people: Commendation[];
};

type MonthlyOpts = { month: string; organizationId: number | null };
type CommendationOpts = { year: number; minHours: number; organizationId: number | null };

export function getMonthlyExport(opts: MonthlyOpts) {
  return api<MonthlyExport>('/admin/exports/monthly', { query: { ...opts, format: 'json' } });
}

export function downloadMonthlyExport(opts: MonthlyOpts) {
  return apiDownload('/admin/exports/monthly', { ...opts, format: 'csv' }, `treecare-monthly-${opts.month}.csv`);
}

export function getCommendations(opts: CommendationOpts) {
  return api<CommendationExport>('/admin/exports/commendations', { query: { ...opts, format: 'json' } });
}

export function downloadCommendations(opts: CommendationOpts) {
  return apiDownload('/admin/exports/commendations', { ...opts, format: 'csv' }, `treecare-commendations-${opts.year}.csv`);
}
