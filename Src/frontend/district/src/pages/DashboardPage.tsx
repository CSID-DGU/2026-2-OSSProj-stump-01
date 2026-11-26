// 한눈에 보기 (#28). 구청 웹 첫 화면. 숫자를 누르면 각 처리 화면으로 간다.
// 위쪽 '처리할 일'은 달과 상관없이 지금 쌓여 있는 건수이고, 아래 '이달 현황'만 고른 달을 따른다(#71 API 기준).
import { Link, useSearchParams } from 'react-router-dom';
import { getCareGaps } from '../api/careGaps';
import { useDashboard, type Dashboard } from '../api/dashboard';
import { useAsync } from '../api/useAsync';
import { addMonths, currentMonth, daysSince, formatMinutes, formatShortDate, monthLabel, todayLabel } from '../lib/format';
import { OLD_INCIDENT_DAYS } from '../lib/thresholds';
import styles from './DashboardPage.module.css';

const MONTH_OPTIONS = 12; // 월 선택에 보여 줄 달 수(이번 달부터 거꾸로)
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/; // 백엔드와 같은 YYYY-MM 검사
const INACTIVE_LIST_LIMIT = 5; // 활동이 끊긴 나무 목록은 오래 끊긴 순으로 이만큼만 보여 준다

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
            <Link to={"/monthly-reports"} className={`${styles.card} ${styles.info}`}>
              <span className={styles.number}>{data.monthlyReports.pending}</span>
              <span className={styles.cardLabel}>검토 대기 보고서</span>
              <span className={styles.cardSub}>
                {data.monthlyReports.revisionRequested > 0
                  ? `보완 요청 후 재제출 기다리는 보고서 ${data.monthlyReports.revisionRequested}`
                  : '보완 요청한 보고서 없음'}
              </span>
            </Link>

            <Link to={"/applications"} className={`${styles.card} ${styles.primary}`}>
              <span className={styles.number}>{data.applications.pending}</span>
              <span className={styles.cardLabel}>돌보미 신청 심사 대기</span>
              <span className={styles.cardSub}>승인하면 신청자에게 알림이 갑니다</span>
            </Link>

            <Link to={"/rentals"} className={`${styles.card} ${styles.wait}`}>
              <span className={styles.number}>{data.rentals.requested}</span>
              <span className={styles.cardLabel}>물품 신청 승인 대기</span>
              <span className={styles.cardSub}>승인 후 수령 기다리는 물품 {data.rentals.awaitingPickup}</span>
            </Link>

            <IncidentCard data={data.incidentReports} to={"/incident-reports"} />
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

            <div className={styles.stack}>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>{monthLabel(data.month)} 봉사시간</h2>
                  <Link to={"/monthly-reports?status=approved"}>
                    승인한 보고서 보기
                  </Link>
                </div>
                <div className={styles.hours}>
                  <span className={styles.number}>{formatMinutes(data.volunteerHours.minutes)}</span>
                  <span className={styles.muted}>보고서를 승인해 기록한 돌보미 {data.volunteerHours.people}명</span>
                </div>
                <p className={styles.note}>봉사시간은 구청이 승인한 보고서로만 기록됩니다. 시스템이 자동으로 정하지 않습니다.</p>
              </section>

              <CareGapSection month={data.month} counts={data.careGaps} orgSelected={organizationId !== null} />
            </div>
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

/**
 * 관리 사각지대 (#22): 돌보미가 없는 나무와, 돌보미는 있는데 이 달 활동이 끊긴 나무.
 * 숫자는 한눈에 보기 집계에서, 끊긴 나무 목록은 /admin/care-gaps에서 가져온다. 나무 기준이라 단체 필터와 상관없다.
 */
function CareGapSection({ month, counts, orgSelected }: { month: string; counts: Dashboard['careGaps']; orgSelected: boolean }) {
  const detail = useAsync(() => getCareGaps(month), [month]);
  const trees = detail.data?.inactiveTrees.slice(0, INACTIVE_LIST_LIMIT) ?? [];

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>{monthLabel(month)} 관리 사각지대</h2>
        {detail.data && <span className={styles.muted}>관리 나무 {detail.data.totals.trees.toLocaleString('ko-KR')}그루 중</span>}
      </div>
      <div className={styles.gapStats}>
        <div className={styles.gapStat}>
          <span className={styles.number}>{counts.noCaregiver.toLocaleString('ko-KR')}</span>
          <span className={styles.muted}>돌보미가 없는 나무</span>
        </div>
        <div className={`${styles.gapStat} ${styles.gapInactive}`}>
          <span className={styles.number}>{counts.inactive.toLocaleString('ko-KR')}</span>
          <span className={styles.muted}>돌보미는 있는데 이달 활동이 끊긴 나무</span>
        </div>
      </div>

      {detail.error && <p className={styles.note}>끊긴 나무 목록을 불러오지 못했습니다. {detail.error.message}</p>}
      {trees.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>오래 끊긴 나무</th>
              <th>위치</th>
              <th className={styles.num}>마지막 활동</th>
            </tr>
          </thead>
          <tbody>
            {trees.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.species}
                  <span className={styles.muted}> {t.code ?? `#${t.id}`}</span>
                </td>
                <td>{[t.dong ?? t.district, t.roadName].filter(Boolean).join(' ')}</td>
                <td className={styles.num}>{t.lastActivityDate ? formatShortDate(t.lastActivityDate) : '기록 없음'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={styles.note}>
        돌보미가 있다는 것은 그 달에 활동 기간이 걸친 승인된 신청서가 있다는 뜻입니다.
        {orgSelected && ' 나무 기준이라 단체를 골라도 관리청 전체 숫자입니다.'}
      </p>
    </section>
  );
}
