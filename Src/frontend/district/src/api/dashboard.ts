// GET /admin/dashboard (#71). 형식은 Src/backend/openapi.yaml의 Dashboard와 같다.
import { useEffect, useState } from 'react';
import { api } from './client';

export type Dashboard = {
  agency: string;
  month: string; // YYYY-MM
  organizationId: number | null;
  monthlyReports: { pending: number; revisionRequested: number };
  applications: { pending: number };
  rentals: { requested: number; awaitingPickup: number };
  incidentReports: { pending: number; inspecting: number; oldestUnresolvedAt: string | null };
  caregivers: {
    active: number;
    missingReport: number;
    missingReportList: { userId: number; nickname: string; realName: string | null; treeCount: number }[];
  };
  volunteerHours: { minutes: number; people: number };
  careGaps: { noCaregiver: number; inactive: number }; // 관리 사각지대(#22). 나무 기준이라 단체 필터와 상관없이 관리청 전체
  organizations: { id: number; name: string }[];
};

export function fetchDashboard(opts: { month?: string; organizationId?: number | null } = {}): Promise<Dashboard> {
  return api<Dashboard>('/admin/dashboard', { query: { month: opts.month, organizationId: opts.organizationId } });
}

type State = { data: Dashboard | null; error: Error | null; loading: boolean };

/** 한눈에 보기 집계를 불러온다. reloadKey를 바꾸면 다시 불러온다. */
export function useDashboard(opts: { month?: string; organizationId?: number | null }, reloadKey = 0): State {
  const [state, setState] = useState<State>({ data: null, error: null, loading: true });
  const { month, organizationId } = opts;

  useEffect(() => {
    let cancelled = false; // 화면을 떠난 뒤 늦게 온 응답은 버린다
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchDashboard({ month, organizationId })
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error: Error) => !cancelled && setState({ data: null, error, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [month, organizationId, reloadKey]);

  return state;
}
