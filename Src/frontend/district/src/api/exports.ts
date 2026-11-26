// 상부 보고·표창 대상 내려받기 (#73 API, #78 화면). 형식은 Src/backend/openapi.yaml의 MonthlyExport와 같다.
import { api, downloadFile } from './client';

export type ExportCounts = {
  trees: number;
  caredTrees: number;
  caregivers: number;
  activityRecords: number;
  activityMinutes: number;
  volunteerMinutes: number;
  volunteerPeople: number;
  incidentsReceived: number;
  incidentsResolved: number;
};

export type MonthlyExport = {
  agency: string;
  month: string;
  organization: { id: number; name: string } | null;
  regions: (ExportCounts & { district: string; dong: string | null })[];
  totals: ExportCounts;
  monthlyReports: { submitted: number; approved: number; revisionRequested: number };
  rentals: { item: string; approvedQuantity: number; receivedQuantity: number }[];
};

export type Commendations = {
  agency: string;
  year: number;
  minHours: number;
  organization: { id: number; name: string } | null;
  people: {
    rank: number;
    userId: number;
    nickname: string;
    realName: string | null;
    volunteerMinutes: number;
    approvedReports: number;
    trees: number;
  }[];
};

type MonthlyOpts = { month: string; organizationId: number | null };
type CommendationOpts = { year: number; minHours: number; organizationId: number | null };

export function fetchMonthlyExport(o: MonthlyOpts) {
  return api<MonthlyExport>('/admin/exports/monthly', { query: { ...o, format: 'json' } });
}

export function downloadMonthlyExport(o: MonthlyOpts) {
  return downloadFile('/admin/exports/monthly', o, `treecare-monthly-${o.month}.csv`);
}

export function fetchCommendations(o: CommendationOpts) {
  return api<Commendations>('/admin/exports/commendations', { query: { ...o, format: 'json' } });
}

export function downloadCommendations(o: CommendationOpts) {
  return downloadFile('/admin/exports/commendations', o, `treecare-commendations-${o.year}.csv`);
}
