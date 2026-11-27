import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import PageTitle from '../components/PageTitle'
import InstallHint from '../components/InstallHint'
import { logout, useAuth } from '../store/authStore'
import { refreshNotifications, useNotifications } from '../store/notificationStore'
import './AuthPages.css'

// 하단 탭 "나". 내 정보(본인인증·주소), 알림(#41), 돌보미 신청 현황(#40), 물품 신청(#81), 홈 화면 추가(#84), 로그아웃.
export default function MePage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()

  useEffect(() => {
    refreshNotifications()
  }, [])

  if (auth.status !== 'signed-in') return null
  const { user } = auth

  return (
    <div className="page">
      <PageTitle title={`${user.nickname} 님`} description={user.email} />

      <div className="tc-rows">
        <Link className="tc-row me-link" to="/me/profile">
          <span>내 정보</span>
          <span className={user.identityVerified ? 'tc-row__value' : 'tc-row__value tc-row__value--earth'}>
            {user.identityVerified ? '본인인증함' : '본인인증 필요'}
          </span>
        </Link>
        <Link className="tc-row me-link" to="/notifications">
          <span>알림</span>
          <span className="tc-row__value">{unreadCount > 0 ? `새 알림 ${unreadCount}개` : '모두 읽음'}</span>
        </Link>
        <div className="tc-row">
          <span>돌보미 교육</span>
          <span className={user.educationCompleted ? 'tc-row__value' : 'tc-row__value tc-row__value--earth'}>
            {user.educationCompleted ? '이수함' : '아직 안 함'}
          </span>
        </div>
        <Link className="tc-row me-link" to="/applications">
          <span>돌보미 신청 현황</span>
          <span className="tc-row__value">보기</span>
        </Link>
        <Link className="tc-row me-link" to="/rentals">
          <span>활동 물품 신청</span>
          <span className="tc-row__value">보기</span>
        </Link>
      </div>

      {/* 홈 화면에 추가 (#84). 휴대폰에서, 아직 홈 화면 앱이 아닐 때만 보인다 */}
      <InstallHint place="me" />

      <div className="page-bottom">
        <button
          className="tc-link tc-link--muted auth-switch auth-logout"
          type="button"
          onClick={() => {
            logout()
            navigate('/login', { replace: true })
          }}
        >
          로그아웃
        </button>
      </div>
    </div>
  )
}
