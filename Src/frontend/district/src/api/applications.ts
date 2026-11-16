// 돌보미 신청 심사 API (#68). 형식은 Src/backend/openapi.yaml의 Application과 같다.
import { api } from './client';
import type { Page, Person } from './types';

export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'ended';

export type Application = {
  id: number;
  status: ApplicationStatus;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  motivation: string | null;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: number | null;
  applicant: Person;
  tree: {
    id: number;
    species: string;
    district: string;
    dong: string | null;
    roadName: string | null;
    address: string | null;
    caregiverCount: number;
  };
};

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
  ended: '종료',
};

export function listApplications(opts: { status: ApplicationStatus; limit: number; offset: number }) {
  return api<Page<Application>>('/admin/applications', { query: opts });
}

export function getApplication(id: number) {
  return api<Application>(`/admin/applications/${id}`);
}

export type ApplicationReview = { status: 'approved' } | { status: 'rejected'; rejectReason: string };

export function reviewApplication(id: number, review: ApplicationReview) {
  return api<Application>(`/admin/applications/${id}`, { method: 'PATCH', body: review });
}
