// 알림 종류별 이름과, 눌렀을 때 갈 화면.
// 아직 없는 화면(물품 #81)은 "나" 탭으로 보낸다. 화면이 생기면 여기만 고친다.
import type { Notification, NotificationType } from '../lib/api'

export const NOTIFICATION_LABEL: Record<NotificationType, string> = {
  application_result: '돌보미 신청',
  monthly_report_result: '월간 보고서',
  rental_result: '물품',
  report_resolved: '신고 조치',
  story_reaction: '받은 응답',
}

export function notificationLink(n: Notification): string {
  switch (n.type) {
    case 'application_result':
      return '/applications'
    case 'monthly_report_result':
      return '/volunteer-hours'
    case 'rental_result':
      return '/me' // TODO(#81): 물품 신청 현황 화면
    case 'report_resolved':
    case 'story_reaction':
      return n.treeId ? `/trees/${n.treeId}` : '/records'
  }
}
