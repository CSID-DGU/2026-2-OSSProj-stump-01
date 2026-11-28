// 구청 웹 공통 틀: 왼쪽 메뉴 + 오른쪽 화면. 데스크탑 레이아웃만 둔다(용어.md 목표).
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useDashboard } from '../api/dashboard';
import { useAuth } from '../auth/AuthContext';
import { onCountsChanged } from '../lib/counts';
import styles from './AdminLayout.module.css';

export function AdminLayout() {
  const { user, logout } = useAuth();
  // 메뉴 옆 대기 건수와 관리청 이름은 한눈에 보기 집계(이번 달)에서 가져온다.
  // 처리 화면에서 승인·반려하면 notifyCountsChanged()가 불려 건수를 다시 센다.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => onCountsChanged(() => setReloadKey((k) => k + 1)), []);
  const { data } = useDashboard({}, reloadKey);

  const menu = [
    { to: '/', label: '한눈에 보기', count: null, end: true },
    { to: '/map', label: '나무 지도', count: null },
    { to: '/applications', label: '돌보미 신청 심사', count: data?.applications.pending },
    { to: '/monthly-reports', label: '월간 보고서 검토', count: data?.monthlyReports.pending },
    { to: '/rentals', label: '물품 지급', count: data?.rentals.requested },
    {
      to: '/incident-reports',
      label: '신고 처리',
      count: data ? data.incidentReports.pending + data.incidentReports.inspecting : undefined,
    },
    { to: '/exports', label: '상부 보고', count: null },
  ];

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="구청 메뉴">
        <div className={styles.brand}>
          <span className={styles.logo}>TreeCare 구청</span>
          <span className={styles.agency}>
            {[data?.agency ?? user?.agency, user?.nickname].filter(Boolean).join(', ') || ' '}
          </span>
        </div>
        <ul className={styles.menu}>
          {menu.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
              >
                <span>{item.label}</span>
                {item.count ? <span className={styles.count}>{item.count}</span> : null}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className={styles.spacer} />
        <button type="button" className={styles.logout} onClick={logout}>
          로그아웃
        </button>
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
