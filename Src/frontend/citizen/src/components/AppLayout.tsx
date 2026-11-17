import { Outlet } from 'react-router'
import BottomNav from './BottomNav'

// 하단 탭이 있는 화면(홈·지도·기록·우리 단체·나)의 공통 틀.
// <Outlet />자리에 주소에 맞는 화면이 들어간다.
export default function AppLayout() {
  return (
    <div className="app-shell tc-screen">
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
