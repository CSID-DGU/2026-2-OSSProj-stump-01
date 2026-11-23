import { useNavigate } from 'react-router'
import PageTitle from '../components/PageTitle'
import { logout, useAuth } from '../store/authStore'

// 하단 탭 "나". 지금은 내 정보와 로그아웃만 있다.
// 신청 현황(#40), 알림(#41), 물품 신청(#81)이 여기에 들어온다.
export default function MePage() {
  const auth = useAuth()
  const navigate = useNavigate()
  if (auth.status !== 'signed-in') return null
  const { user } = auth

  return (
    <div className="page">
      <PageTitle title={`${user.nickname} 님`} description={user.email} />

      <div className="tc-rows">
        <div className="tc-row">
          <span>돌보미 교육</span>
          <span className={user.educationCompleted ? 'tc-row__value' : 'tc-row__value tc-row__value--earth'}>
            {user.educationCompleted ? '이수함' : '아직 안 함'}
          </span>
        </div>
        <div className="tc-row">
          <span>돌보미 신청</span>
          <span className="tc-row__value tc-row__value--earth">준비 중 (#40)</span>
        </div>
        <div className="tc-row">
          <span>알림</span>
          <span className="tc-row__value tc-row__value--earth">준비 중 (#41)</span>
        </div>
        <div className="tc-row">
          <span>물품 신청</span>
          <span className="tc-row__value tc-row__value--earth">준비 중 (#81)</span>
        </div>
      </div>

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
