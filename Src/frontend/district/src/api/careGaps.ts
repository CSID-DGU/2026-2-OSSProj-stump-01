// 관리 사각지대 API (#22). 형식은 Src/backend/openapi.yaml의 CareGaps와 같다.
// 돌보미 없음 = 그 달에 활동 기간이 걸친 승인된 신청서가 없는 나무, 활동 끊김 = 돌보미는 있는데 그 달 활동 기록이 없는 나무.
// 나무 기준이라 단체 필터를 받지 않는다.
import { api } from './client';

export type CareGapCounts = {
  trees: number; // 관리 나무
  noCaregiver: number;
  inactive: number;
};

export type InactiveTree = {
  id: number;
  code: string | null; // 관리번호
  species: string;
  district: string;
  dong: string | null;
  roadName: string | null;
  caregiverCount: number; // 그 달 활동 기간이 걸친 돌보미 수
  lastActivityDate: string | null; // 그 달 전 마지막 활동일(YYYY-MM-DD). 활동한 적 없으면 null
};

export type CareGaps = {
  agency: string;
  month: string;
  totals: CareGapCounts;
  byDong: (CareGapCounts & { district: string; dong: string | null })[];
  inactiveTrees: InactiveTree[]; // 오래 끊긴 순(활동한 적 없는 나무 먼저), 최대 100그루
};

export function getCareGaps(month: string) {
  return api<CareGaps>('/admin/care-gaps', { query: { month } });
}
