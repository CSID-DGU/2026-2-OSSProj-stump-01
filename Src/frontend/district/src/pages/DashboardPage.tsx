// 한눈에 보기 (#28). 구청 웹 첫 화면. 숫자를 누르면 각 처리 화면으로 간다.
// 위쪽 '처리할 일'은 달과 상관없이 지금 쌓여 있는 건수이고, 아래 '이달 현황'만 고른 달을 따른다(#71 API 기준).
import { Link, useSearchParams } from 'react-router-dom';
import { useDashboard } from '../api/dashboard';
import { addMonths, currentMonth, daysSince, formatMinutes, monthLabel, todayLabel } from '../lib/format';
import styles from './DashboardPage.module.css';

const MONTH_OPTIONS = 12; // 월 선택에 보여 줄 달 수(이번 달부터 거꾸로)
const OLD_INCIDENT_DAYS = 30; // 이 날 수를 넘긴 미처리 신고는 빨갛게 표시한다(시안 기준, 임시값)
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/; // 백엔드와 같은 YYYY-MM 검사

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const thisMonth = currentMonth();
  // 주소창에 잘못된 값이 들어와도 400 에러 대신 기본값(이번 달, 전체)으로 보여 준다
  const monthParam = params.get('month');
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : thisMonth;
  const orgParam = Number(params.get('organizationId'));
  const organizationId = Number.isInteger(orgParam) && orgParam > 0 ? orgParam : null;

  const { data, error, loading } = useDashboard({ month, organizationId });

  function setFilter(key: 'month' | 'organizationId', value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const months = Array.from({ length: MONTH_OPTIONS }, (_, i) => addMonths(thisMonth, -i));
  // 주소로 1년보다 이전 달을 열었을 때도 선택 상자에 그 달이 보이게 한다
  if (!months.includes(month)) months.push(month);
  // 처리 화면으로 갈 때 단체 필터를 그대로 넘긴다
  const orgQuery = organizationId ? `?organizationId=${organizationId}` : '';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBox}>
          <span className={styles.date}>{todayLabel()}</span>
          <h1 className={styles.title}>오늘 처리할 일</h1>
        </div>
        <div className={styles.filters}>
          <label className="sr-only" htmlFor="org-filter">
            단체
          </label>
          <select
            id="org-filter"
            className={styles.select}
            value={organizationId ?? ''}
            onChange={(e) => setFilter('organizationId', e.target.value)}
          >
            <option value="">{data ? `${data.agency} 전체` : '전체'}</option>
            {data?.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="month-filter">
            집계 달
          </label>
          <select
            id="month-filter"
            className={styles.select}
            value={month}
            onChange={(e) => setFilter('month', e.target.value === thisMonth ? '' : e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          집계를 불러오지 못했습니다. {error.message}
        </p>
      )}
      {loading && !data && <p className={styles.muted}>불러오는 중…</p>}

      {data && (
        <>
          <section className={styles.cards} aria-label="처리할 일">
            <Link to={`/monthly-reports${orgQuery}`} className={`${styles.card} ${styles.info}`}>
              <span className={styles.number}>{data.monthlyReports.pending}</span>
              <span className={styles.cardLabel}>검토 대기 보고서</span>
              <span className={styles.cardSub}>
                {data.monthlyReports.revisionRequested > 0
                  ? `보완 요청 후 재제출 기다리는 보고서 ${data.monthlyReports.revisionRequested}`
                  : '보완 요청한 보고서 없음'}
              </span>
            </Link>

            <Link to={`/applications${orgQuery}`} className={`${styles.card} ${styles.primary}`}>
              <span className={styles.number}>{data.applications.pending}</span>
              <span className={styles.cardLabel}>돌보미 신청 심사 대기</span>
              <span className={styles.cardSub}>승인하면 신청자에게 알림이 갑니다</span>
            </Link>

            <Link to={`/rentals${orgQuery}`} className={`${styles.card} ${styles.wait}`}>
              <span className={styles.number}>{data.rentals.requested}</span>
              <span className={styles.cardLabel}>물품 신청 승인 대기</span>
              <span className={styles.cardSub}>승인 후 수령 기다리는 물품 {data.rentals.awaitingPickup}</span>
            </Link>

            <IncidentCard data={data.incidentReports} to={`/incident-reports${orgQuery}`} />
          </section>

          <div className={styles.columns}>
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2>{monthLabel(data.month)} 보고서 미제출 돌보미</h2>
                <span className={styles.muted}>
                  활동 중 {data.caregivers.active}명 중 {data.caregivers.missingReport}명
                </span>
              </div>
              {data.caregivers.missingReport === 0 ? (
                <p className={styles.empty}>
                  {data.caregivers.active === 0 ? '이 달에 활동 중인 돌보미가 없습니다.' : '모든 돌보미가 보고서를 냈습니다.'}
                </p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>별명</th>
                      <th>이름</th>
                      <th className={styles.num}>돌보는 나무</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.caregivers.missingReportList.map((c) => (
                      <tr key={c.userId}>
                        <td>{c.nickname}</td>
                        <td>{c.realName ?? '-'}</td>
                        <td className={styles.num}>{c.treeCount}그루</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.caregivers.missingReport > data.caregivers.missingReportList.length && (
                <p className={styles.muted}>
                  {data.caregivers.missingReport - data.caregivers.missingReportList.length}명 더 있습니다.
                </p>
              )}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2>{monthLabel(data.month)} 봉사시간</h2>
                <Link to={`/monthly-reports?status=approved${organizationId ? `&organizationId=${organizationId}` : ''}`}>
                  승인한 보고서 보기
                </Link>
              </div>
              <div className={styles.hours}>
                <span className={styles.number}>{formatMinutes(data.volunteerHours.minutes)}</span>
                <span className={styles.muted}>보고서를 승인해 기록한 돌보미 {data.volunteerHours.people}명</span>
              </div>
              <p className={styles.note}>봉사시간은 구청이 승인한 보고서로만 기록됩니다. 시스템이 자동으로 정하지 않습니다.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function IncidentCard({ data, to }: { data: { pending: number; inspecting: number; oldestUnresolvedAt: string | null }; to: string }) {
  const total = data.pending + data.inspecting;
  const oldestDays = data.oldestUnresolvedAt ? daysSince(data.oldestUnresolvedAt) : null;
  const isOld = oldestDays !== null && oldestDays > OLD_INCIDENT_DAYS;

  return (
    <Link to={to} className={`${styles.card} ${styles.danger}`}>
      <span className={styles.number}>{total}</span>
      <span className={styles.cardLabel}>처리 안 된 이상 신고</span>
      <span className={styles.cardSub}>
        확인 필요 {data.pending} · 현장 확인 {data.inspecting}
        {oldestDays !== null && (
          <>
            {' · '}
            <span className={isOld ? styles.alert : undefined}>가장 오래된 것 {oldestDays}일</span>
          </>
        )}
      </span>
    </Link>
  );
}
