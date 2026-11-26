// 상부 보고 (#78). 월·단체를 골라 구·동별 집계를 미리 보고 엑셀(CSV)로 내려받는다. 아래쪽은 연말 표창 대상.
// API: GET /admin/exports/monthly, /admin/exports/commendations (#73). 미리보기는 format=json, 내려받기는 CSV 파일.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDashboard } from '../api/dashboard';
import {
  downloadCommendations,
  downloadMonthlyExport,
  fetchCommendations,
  fetchMonthlyExport,
  type ExportCounts,
} from '../api/exports';
import { useAsync } from '../api/useAsync';
import ui from '../components/ui.module.css';
import { addMonths, currentMonth, formatMinutes, monthLabel } from '../lib/format';
import styles from './ExportsPage.module.css';

const MONTH_OPTIONS = 12; // 월 선택에 보여 줄 달 수(이번 달부터 거꾸로)
const YEAR_OPTIONS = 3; // 표창 연도 선택(올해부터 거꾸로)
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function ExportsPage() {
  const [params, setParams] = useSearchParams();
  const thisMonth = currentMonth();
  const monthParam = params.get('month');
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : thisMonth;
  const orgParam = Number(params.get('organizationId'));
  const organizationId = Number.isInteger(orgParam) && orgParam > 0 ? orgParam : null;

  // 단체 목록은 한눈에 보기 집계의 organizations를 쓴다(이 관리청 나무를 돌보는 회원이 있는 단체)
  const { data: dashboard } = useDashboard({});

  function setFilter(key: 'month' | 'organizationId', value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const months = Array.from({ length: MONTH_OPTIONS }, (_, i) => addMonths(thisMonth, -i));
  if (!months.includes(month)) months.push(month);

  return (
    <div className={ui.page}>
      <header>
        <h1 className={ui.title}>상부 보고</h1>
        <p className={ui.lead}>
          고른 달의 구·동별 돌봄 현황을 미리 보고 엑셀에서 열리는 파일(CSV)로 내려받습니다. 구·동은 나무가 서 있는 위치
          기준입니다.
        </p>
      </header>

      <div className={styles.filters}>
        <label>
          단체
          <select className={ui.input} value={organizationId ?? ''} onChange={(e) => setFilter('organizationId', e.target.value)}>
            <option value="">{dashboard ? `${dashboard.agency} 전체` : '전체'}</option>
            {dashboard?.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          달
          <select className={ui.input} value={month} onChange={(e) => setFilter('month', e.target.value === thisMonth ? '' : e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <MonthlySection month={month} organizationId={organizationId} />
      <CommendationSection organizationId={organizationId} />
    </div>
  );
}

/** 내려받기 버튼: 받는 중에는 막고, 실패하면 이유를 보여 준다 */
function DownloadButton({ label, onDownload }: { label: string; onDownload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        type="button"
        className={`${ui.button} ${ui.primary}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onDownload();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '내려받는 중…' : label}
      </button>
      {error && (
        <span className={ui.error} role="alert">
          {' '}
          {error}
        </span>
      )}
    </span>
  );
}

const COLUMNS: { key: keyof ExportCounts; label: string; minutes?: boolean }[] = [
  { key: 'trees', label: '관리 나무' },
  { key: 'caredTrees', label: '돌보미 있는 나무' },
  { key: 'caregivers', label: '돌보미' },
  { key: 'activityRecords', label: '활동 기록' },
  { key: 'activityMinutes', label: '활동 시간', minutes: true },
  { key: 'volunteerMinutes', label: '인정 봉사시간', minutes: true },
  { key: 'incidentsReceived', label: '신고 접수' },
  { key: 'incidentsResolved', label: '조치 완료' },
];

function cells(c: ExportCounts) {
  return COLUMNS.map((col) => (
    <td key={col.key} className={ui.num}>
      {col.minutes ? formatMinutes(c[col.key]) : c[col.key].toLocaleString()}
    </td>
  ));
}

function MonthlySection({ month, organizationId }: { month: string; organizationId: number | null }) {
  const { data, error, loading } = useAsync(() => fetchMonthlyExport({ month, organizationId }), [month, organizationId]);

  return (
    <section className={styles.section} aria-label="월간 보고">
      <div className={styles.sectionHead}>
        <h2 className={ui.sectionTitle}>
          {monthLabel(month)} 월간 활동 보고{data?.organization ? ` · ${data.organization.name}` : ''}
        </h2>
        <DownloadButton label="엑셀로 내려받기" onDownload={() => downloadMonthlyExport({ month, organizationId })} />
      </div>

      {error && (
        <p className={ui.error} role="alert">
          집계를 불러오지 못했습니다. {error.message}
        </p>
      )}
      {loading && !data && <p className={ui.muted}>불러오는 중…</p>}

      {data && (
        <>
          <div className={styles.summary}>
            <span>
              월간 보고서 제출 {data.monthlyReports.submitted} · 승인 {data.monthlyReports.approved} · 보완 요청{' '}
              {data.monthlyReports.revisionRequested}
            </span>
            <span>봉사 인정 {data.totals.volunteerPeople}명</span>
            {data.rentals.map((r) => (
              <span key={r.item}>
                {r.item} 승인 {r.approvedQuantity} · 수령 {r.receivedQuantity}
              </span>
            ))}
          </div>

          {data.regions.length === 0 ? (
            <p className={ui.empty}>이 관리청에 나무가 없습니다.</p>
          ) : (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>구·동</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={ui.num}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.regions.map((r) => (
                  <tr key={`${r.district}|${r.dong ?? ''}`}>
                    <td>
                      {r.district} {r.dong ?? '(동 정보 없음)'}
                    </td>
                    {cells(r)}
                  </tr>
                ))}
                <tr className={styles.totalRow}>
                  <td>합계</td>
                  {cells(data.totals)}
                </tr>
              </tbody>
            </table>
          )}
          <p className={ui.hint}>돌보미 합계는 여러 동에서 활동한 사람을 한 번만 셉니다.</p>
        </>
      )}
    </section>
  );
}

function CommendationSection({ organizationId }: { organizationId: number | null }) {
  const thisYear = Number(currentMonth().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [minHours, setMinHours] = useState(0);
  const { data, error, loading } = useAsync(
    () => fetchCommendations({ year, minHours, organizationId }),
    [year, minHours, organizationId],
  );

  return (
    <section className={styles.section} aria-label="연말 표창 대상">
      <div className={styles.sectionHead}>
        <h2 className={ui.sectionTitle}>{year}년 표창 대상</h2>
        <DownloadButton label="엑셀로 내려받기" onDownload={() => downloadCommendations({ year, minHours, organizationId })} />
      </div>
      <div className={styles.filters}>
        <label>
          연도
          <select className={ui.input} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: YEAR_OPTIONS }, (_, i) => thisYear - i).map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </label>
        <label>
          승인 봉사시간(이상)
          <input
            className={`${ui.input} ${styles.hoursInput}`}
            type="number"
            min={0}
            step={1}
            value={minHours}
            onChange={(e) => setMinHours(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      </div>
      <p className={ui.hint}>실명이 들어가는 개인정보입니다. 표창 기준 시간은 구청 확인 전이라 직접 정합니다.</p>

      {error && (
        <p className={ui.error} role="alert">
          표창 대상을 불러오지 못했습니다. {error.message}
        </p>
      )}
      {loading && !data && <p className={ui.muted}>불러오는 중…</p>}
      {data &&
        (data.people.length === 0 ? (
          <p className={ui.empty}>조건에 맞는 돌보미가 없습니다.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th className={ui.num}>순위</th>
                <th>별명</th>
                <th>이름</th>
                <th className={ui.num}>승인 봉사시간</th>
                <th className={ui.num}>승인 보고서</th>
                <th className={ui.num}>돌본 나무</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.userId}>
                  <td className={ui.num}>{p.rank}</td>
                  <td>{p.nickname}</td>
                  <td>{p.realName ?? '-'}</td>
                  <td className={ui.num}>{formatMinutes(p.volunteerMinutes)}</td>
                  <td className={ui.num}>{p.approvedReports}편</td>
                  <td className={ui.num}>{p.trees}그루</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </section>
  );
}
