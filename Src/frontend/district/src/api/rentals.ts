// 물품 지급 관리 API (#70). 형식은 Src/backend/openapi.yaml의 RentalItem·Rental과 같다.
// 물품은 신청 → 승인(재고 차감) → 수령으로 끝난다. 반납은 없다.
import { api } from './client';
import type { Page, Person } from './types';

export type RentalItem = {
  id: number;
  name: string;
  stock: number; // 아직 배정하지 않은 재고
  requestedQuantity: number; // 승인 대기 중인 신청 수량 합계
  awaitingPickupQuantity: number; // 승인했지만 아직 수령하지 않은 수량 합계
  createdAt: string;
};

export type RentalStatus = 'requested' | 'approved' | 'rejected' | 'received';

export type Rental = {
  id: number;
  status: RentalStatus;
  quantity: number;
  rejectReason: string | null;
  createdAt: string;
  handledAt: string | null;
  handledBy: number | null;
  receivedAt: string | null;
  item: { id: number; name: string; stock: number };
  requester: Person;
};

export const RENTAL_STATUS_LABEL: Record<RentalStatus, string> = {
  requested: '승인 대기',
  approved: '수령 대기',
  rejected: '반려',
  received: '수령 완료',
};

export function listRentalItems() {
  return api<{ items: RentalItem[] }>('/admin/rental-items');
}

export function createRentalItem(body: { name: string; stock: number }) {
  return api<RentalItem>('/admin/rental-items', { method: 'POST', body });
}

export function updateRentalItem(id: number, body: { name?: string; stock?: number }) {
  return api<RentalItem>(`/admin/rental-items/${id}`, { method: 'PATCH', body });
}

export function listRentals(opts: { status: RentalStatus; limit: number; offset: number; organizationId?: number | null }) {
  return api<Page<Rental>>('/admin/rentals', { query: opts });
}

export type RentalAction = { status: 'approved' } | { status: 'rejected'; rejectReason?: string } | { status: 'received' };

export function handleRental(id: number, action: RentalAction) {
  return api<Rental>(`/admin/rentals/${id}`, { method: 'PATCH', body: action });
}
