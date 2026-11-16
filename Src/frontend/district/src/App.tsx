// 화면 주소(라우트) 목록. 로그인하지 않았으면 모든 주소가 로그인 화면으로 간다.
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { AdminLayout } from './layout/AdminLayout';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { DashboardPage } from './pages/DashboardPage';

function RequireLogin() {
  const { token } = useAuth();
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireLogin />}>
            <Route element={<AdminLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="applications" element={<ComingSoonPage title="돌보미 신청 심사" issue={74} />} />
              <Route path="monthly-reports" element={<ComingSoonPage title="월간 보고서 검토" issue={75} />} />
              <Route path="rentals" element={<ComingSoonPage title="물품 지급" issue={76} />} />
              <Route path="incident-reports" element={<ComingSoonPage title="신고 처리" issue={29} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
