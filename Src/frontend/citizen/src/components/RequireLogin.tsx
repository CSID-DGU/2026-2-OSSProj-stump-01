import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../store/authStore'

// 로그인이 필요한 화면을 감싼다. 로그인 안 했으면 로그인 화면으로 보내고,
// 로그인하면 원래 가려던 화면(next)으로 돌아오게 한다.
export default function RequireLogin() {
  const auth = useAuth()
  const location = useLocation()

  // 저장된 로그인 확인(checkSavedLogin)은 App이 앱을 열 때 한 번 한다
  if (auth.status === 'checking') {
    // 저장된 로그인을 확인하는 짧은 순간. 빈 화면 대신 바탕만 보여 준다.
    return <div className="app-shell tc-screen" aria-busy="true" />
  }

  if (auth.status === 'guest') {
    const next = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }

  return <Outlet />
}

