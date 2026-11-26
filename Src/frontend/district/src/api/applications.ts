// 돌보미 신청 심사 API (#68). 형식은 Src/backend/openapi.yaml의 Application과 같다.
import { api } from './client';
import type { Page, Person } from './types';

export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'ended';

/** 참여 유형 (구청 「나무돌보미 신청서(안)」 양식) */
export type ParticipationType = 'individual' | 'company' | 'civic_group' | 'religious_group' | 'village_community' | 'other';

export type Application = {
  id: number;
  status: ApplicationStatus;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  // 신청서 양식 항목(#68). 양식이 들어가기 전에 낸 신청서는 모두 null이다
  applicantName: string | null; // 신청인 성명 또는 단체명
  contactPerson: string | null; // 기업·단체의 담당부서·담당자
  headcount: number | null;
  postalCode: string | null;
  address: string | null; // 신청인 주소 (나무 주소는 tree.address)
  phone: string | null;
  participationType: ParticipationType | null;
  motivation: string | null; // 신청사유
  activityPlan: string | null;
  organizationIntro: string | null;
  agreedAt: string | null; // 참여 안내 사항 동의 시각
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: number | null;
  applicant: Person;
  tree: {
    id: number;
    code: string | null; // 관리번호 (예: 11140-00123)
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

export const PARTICIPATION_TYPE_LABEL: Record<ParticipationType, string> = {
  individual: '개인/가족',
  company: '기업',
  civic_group: '시민단체',
  religious_group: '종교단체',
  village_community: '마을공동체',
  other: '기타',
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
