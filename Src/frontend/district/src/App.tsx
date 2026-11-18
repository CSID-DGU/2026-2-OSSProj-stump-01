// 화면 주소(라우트) 목록. 로그인하지 않았으면 모든 주소가 로그인 화면으로 간다.
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { AdminLayout } from './layout/AdminLayout';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { DashboardPage } from './pages/DashboardPage';
import { MonthlyReportsPage } from './pages/MonthlyReportsPage';
import { RentalsPage } from './pages/RentalsPage';

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
              <Route path="applications" element={<ApplicationsPage />} />
              <Route path="monthly-reports" element={<MonthlyReportsPage />} />
              <Route path="rentals" element={<RentalsPage />} />
              <Route path="incident-reports" element={<ComingSoonPage title="신고 처리" issue={29} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
