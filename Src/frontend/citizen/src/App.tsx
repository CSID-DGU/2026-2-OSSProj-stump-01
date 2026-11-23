import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import AppLayout from './components/AppLayout'
import RequireLogin from './components/RequireLogin'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import MapPage from './pages/MapPage'
import MePage from './pages/MePage'
import PlaceholderPage from './pages/PlaceholderPage'
import RecordNewPage from './pages/RecordNewPage'
import RecordsPage from './pages/RecordsPage'
import ReportWritePage from './pages/ReportWritePage'
import SignupPage from './pages/SignupPage'
import VolunteerHoursPage from './pages/VolunteerHoursPage'
import { checkSavedLogin } from './store/authStore'

// 주소(URL)와 화면을 연결하는 곳.
// - AppLayout 안에 있는 화면에는 하단 탭이 붙고, 밖에 있는 화면(기록 작성 등)에는 붙지 않는다.
// - RequireLogin 안에 있는 화면은 로그인해야 볼 수 있다. 지도·나무 상세는 QR로 들어온 시민도 보므로 로그인 없이 연다.
export default function App() {
  // 앱을 열 때 저장된 로그인이 아직 유효한지 확인한다
  useEffect(() => {
    checkSavedLogin()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        {/* 로그인 없이 */}
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route element={<AppLayout />}>
          <Route path="map" element={<MapPage />} />
          <Route
            path="trees/:id"
            element={<PlaceholderPage title="나무 상세" issue="#38" plan="수종 카드, 공동 이야기, 나이테가 들어가요." />}
          />
        </Route>

        {/* 로그인해야 */}
        <Route element={<RequireLogin />}>
          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="records" element={<RecordsPage />} />
            <Route
              path="group"
              element={<PlaceholderPage title="우리 단체" issue="#83" plan="초대 코드로 단체에 연결하고, 회원 활동을 묶어 봐요." />}
            />
            <Route path="me" element={<MePage />} />
          </Route>
          <Route path="records/new" element={<RecordNewPage />} />
          <Route path="reports/new" element={<ReportWritePage />} />
          <Route path="volunteer-hours" element={<VolunteerHoursPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
