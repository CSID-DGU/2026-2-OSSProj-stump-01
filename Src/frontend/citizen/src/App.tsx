import { BrowserRouter, Routes, Route } from 'react-router'
import AppLayout from './components/AppLayout'
import HomePage from './pages/HomePage'
import PlaceholderPage from './pages/PlaceholderPage'
import RecordNewPage from './pages/RecordNewPage'
import RecordsPage from './pages/RecordsPage'
import ReportWritePage from './pages/ReportWritePage'
import VolunteerHoursPage from './pages/VolunteerHoursPage'

// 주소(URL)와 화면을 연결하는 곳.
// AppLayout 안에 있는 화면에는 하단 탭이 붙고, 밖에 있는 화면(기록 작성 등)에는 붙지 않는다.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route
            path="map"
            element={<PlaceholderPage title="나무 지도" issue="#37" plan="지도에서 나무를 고르고 상세로 들어가요. 공용 지도 컴포넌트가 나오면 만들어요." />}
          />
          <Route path="records" element={<RecordsPage />} />
          <Route
            path="group"
            element={<PlaceholderPage title="우리 단체" issue="#83" plan="초대 코드로 단체에 연결하고, 회원 활동을 묶어 봐요." />}
          />
          <Route
            path="me"
            element={<PlaceholderPage title="나" issue="#40, #41, #81" plan="신청 현황, 알림, 물품 신청이 들어가요." />}
          />
          <Route
            path="trees/:id"
            element={<PlaceholderPage title="나무 상세" issue="#38" plan="수종 카드, 공동 이야기, 나이테가 들어가요." />}
          />
        </Route>
        <Route path="records/new" element={<RecordNewPage />} />
        <Route path="reports/new" element={<ReportWritePage />} />
        <Route path="volunteer-hours" element={<VolunteerHoursPage />} />
      </Routes>
    </BrowserRouter>
  )
}
