// 알림 종류별 이름과, 눌렀을 때 갈 화면. 화면 주소가 바뀌면 여기만 고친다.
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
      return '/rentals'
    case 'report_resolved':
    case 'story_reaction':
      return n.treeId ? `/trees/${n.treeId}` : '/records'
  }
}
