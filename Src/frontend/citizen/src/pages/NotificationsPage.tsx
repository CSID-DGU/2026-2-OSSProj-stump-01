import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import TopBar from '../components/TopBar'
import { NOTIFICATION_LABEL, notificationLink } from '../content/notificationTypes'
import { formatRelative } from '../lib/date'
import type { Notification } from '../lib/api'
import { markNotificationRead, refreshNotifications, useNotifications } from '../store/notificationStore'
import './NotificationsPage.css'

// 알림 화면 (#41)
// 구청이 신청·보고서·물품을 처리하거나 신고를 조치 완료하면, 또는 이야기에 응답을 받으면 알림이 온다.
// 누르면 읽음으로 바뀌고 관련 화면으로 간다.
export default function NotificationsPage() {
  const navigate = useNavigate()
  const { status, items, unreadCount, error } = useNotifications()
  const [unreadOnly, setUnreadOnly] = useState(false)

  useEffect(() => {
    refreshNotifications()
  }, [])

  function open(n: Notification) {
    markNotificationRead(n.id) // 기다리지 않는다. 실패하면 저장소가 알아서 되돌린다
    navigate(notificationLink(n))
  }

  const shown = unreadOnly ? items.filter((n) => !n.readAt) : items

  return (
    <div className="app-shell tc-screen">
      <TopBar title="알림" kind="back" />
      <div className="page">
        <div className="page-title">
          <h1 className="display">{unreadCount > 0 ? `새 알림 ${unreadCount}개` : '알림'}</h1>
          <p className="body">신청·보고서·물품 결과와 신고 조치, 받은 응답이 여기로 와요.</p>
        </div>

        {items.length > 0 && (
          <div className="tc-choices__list">
            <button type="button" className="tc-choice" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(!unreadOnly)}>
              안 읽은 알림만
            </button>
          </div>
        )}

        {status === 'loading' && <p className="body notice-muted">알림을 불러오는 중이에요.</p>}

        {status === 'error' && (
          <div className="notice-error">
            <p className="tc-field__error" role="alert">
              {error}
            </p>
            <button type="button" className="tc-choice" onClick={() => refreshNotifications()}>
              다시 불러오기
            </button>
          </div>
        )}

        {status === 'ready' && shown.length === 0 && (
          <p className="body notice-muted">{unreadOnly ? '안 읽은 알림이 없어요.' : '아직 받은 알림이 없어요. 돌보미 신청을 하면 결과가 여기로 와요.'}</p>
        )}

        {shown.length > 0 && (
          <ul className="notice-list">
            {shown.map((n) => (
              <li key={n.id}>
                <button type="button" className={n.readAt ? 'notice-item' : 'notice-item is-unread'} onClick={() => open(n)}>
                  <span className="notice-item__meta caption">
                    {!n.readAt && <span className="notice-item__dot" role="img" aria-label="안 읽음" />}
                    {NOTIFICATION_LABEL[n.type]} · {formatRelative(n.createdAt)}
                  </span>
                  <span className="notice-item__title">{n.title}</span>
                  <span className="notice-item__body body">{n.body}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
