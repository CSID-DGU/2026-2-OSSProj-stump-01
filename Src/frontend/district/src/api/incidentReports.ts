// 이상 신고 처리 큐 API (#20, #21). 형식은 Src/backend/openapi.yaml의 IncidentReport와 같다.
// 신고는 공개 게시하지 않는다. 구청 담당자만 보고, 조치 결과는 신고자와 그 나무 돌보미에게만 알림으로 간다.
import { api } from './client';
import type { Page } from './types';

export type IncidentStatus = 'pending' | 'inspecting' | 'resolved';
/** 목록 필터. unresolved = 확인 필요 + 현장 확인 (처리 큐 기본값) */
export type IncidentFilter = 'unresolved' | IncidentStatus;

export type IncidentReport = {
  id: number;
  status: IncidentStatus;
  category: string;
  categoryLabel: string; // 예: 기울어짐·쓰러짐
  urgency: 'low' | 'high';
  isTrusted: boolean; // 신고 시점에 교육을 이수한 신고자인지
  actionNote: string | null; // 처리 메모·조치 내용
  createdAt: string;
  inspectedAt: string | null;
  resolvedAt: string | null;
  handledBy: number | null;
  elapsedDays: number; // 접수 후 지난 날 수. 조치 완료면 완료까지 걸린 날 수
  photoUrl: string | null;
  location: { lat: number; lng: number } | null; // 신고한 위치
  reporter: { id: number; nickname: string };
  tree: {
    id: number;
    species: string;
    roadName: string | null;
    address: string | null;
    location: { lat: number; lng: number };
  };
};

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  pending: '확인 필요',
  inspecting: '현장 확인',
  resolved: '조치 완료',
};

export const INCIDENT_FILTER_LABEL: Record<IncidentFilter, string> = {
  unresolved: '처리 중',
  ...INCIDENT_STATUS_LABEL,
};

export function listIncidentReports(opts: { status: IncidentFilter; limit: number; offset: number; organizationId?: number | null }) {
  return api<Page<IncidentReport>>('/admin/incident-reports', { query: opts });
}

export function getIncidentReport(id: number) {
  return api<IncidentReport>(`/admin/incident-reports/${id}`);
}

/** 상태를 한 단계 넘기거나(현장 확인·조치 완료) 메모만 고친다 */
export type IncidentUpdate = { status?: 'inspecting' | 'resolved'; actionNote?: string };

export function updateIncidentReport(id: number, body: IncidentUpdate) {
  return api<IncidentReport>(`/admin/incident-reports/${id}`, { method: 'PATCH', body });
}
