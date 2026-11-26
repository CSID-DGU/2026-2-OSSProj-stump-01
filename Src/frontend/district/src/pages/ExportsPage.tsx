// 상부 보고 내려받기 (#78). 월간 상부 보고와 연말 표창 대상을 화면에서 미리 보고 엑셀(CSV)로 내려받는다.
// 미리보기와 파일은 같은 API(#73)에서 오므로 숫자가 같다. 집계 규칙은 백엔드가 정하고 화면은 보여 주기만 한다.
import { useState, type FormEvent } from 'react';
import { useDashboard } from '../api/dashboard';
import {
  downloadCommendations,
  downloadMonthlyExport,
  getCommendations,
  getMonthlyExport,
  type ExportRegionCounts,
} from '../api/exports';
import { useAsync } from '../api/useAsync';
import ui from '../components/ui.module.css';
import { addMonths, currentMonth, formatMinutes, monthLabel } from '../lib/format';
import styles from './ExportsPage.module.css';

const MONTH_OPTIONS = 12; // 월 선택에 보여 줄 달 수(이번 달부터 거꾸로)
const YEAR_OPTIONS = 3; // 연도 선택에 보여 줄 해 수(올해부터 거꾸로)

type Org = { id: number; name: string };

export function ExportsPage() {
  // 단체 목록은 한눈에 보기 집계의 organizations를 쓴다(필터에 보여 줄 단체 목록)
  const { data: dashboard } = useDashboard({});
  const organizations = dashboard?.organizations ?? [];
  const agency = dashboard?.agency;

  return (
    <div className={ui.page}>
      <header>
        <h1 className={ui.title}>상부 보고</h1>
        <p className={ui.lead}>
          집계를 화면에서 확인하고 엑셀로 내려받습니다. 내려받은 파일은 엑셀에서 바로 열립니다.
        </p>
      </header>
      <MonthlySection organizations={organizations} agency={agency} />
      <CommendationSection organizations={organizations} agency={agency} />
    </div>
  );
}

/** 내려받기 버튼 상태(받는 중, 실패 메시지)를 다루는 훅 */
function useDownload(run: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(err instanceof Error ? err.message : '내려받지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, start };
}

function OrgSelect(props: { id: string; value: number | null; onChange: (v: number | null) => void; organizations: Org[]; agency?: string }) {
  return (
    <label className={styles.control} htmlFor={props.id}>
      <span>단체</span>
      <select
        id={props.id}
        className={styles.select}
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{props.agency ? `${props.agency} 전체` : '전체'}</option>
        {props.organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const REGION_COLUMNS: { key: keyof ExportRegionCounts; label: string; minutes?: boolean }[] = [
  { key: 'trees', label: '관리 나무' },
  { key: 'caredTrees', label: '돌본 나무' },
  { key: 'caregivers', label: '돌보미' },
  { key: 'activityRecords', label: '활동 기록' },
  { key: 'activityMinutes', label: '활동 시간', minutes: true },
  { key: 'volunteerMinutes', label: '인정 봉사시간', minutes: true },
  { key: 'volunteerPeople', label: '봉사 인정 인원' },
  { key: 'incidentsReceived', label: '신고 접수' },
  { key: 'incidentsResolved', label: '조치 완료' },
];

function countCell(row: ExportRegionCounts, col: (typeof REGION_COLUMNS)[number]) {
  const value = row[col.key];
  return col.minutes ? formatMinutes(value) : value.toLocaleString('ko-KR');
}

function MonthlySection({ organizations, agency }: { organizations: Org[]; agency?: string }) {
  const thisMonth = currentMonth();
  const [month, setMonth] = useState(thisMonth);
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const { data, error, loading } = useAsync(() => getMonthlyExport({ month, organizationId }), [month, organizationId]);
  const download = useDownload(() => downloadMonthlyExport({ month, organizationId }));

  const months = Array.from({ length: MONTH_OPTIONS }, (_, i) => addMonths(thisMonth, -i));

  return (
    <section className={styles.section} aria-labelledby="monthly-title">
      <div className={styles.sectionHead}>
        <div>
          <h2 id="monthly-title" className={ui.sectionTitle}>
            월간 상부 보고
          </h2>
          <p className={ui.muted}>
            구·동은 나무가 서 있는 위치 기준입니다. 단체를 고르면 그 단체 회원의 활동만 셉니다(관리 나무 수는 그대로).
          </p>
        </div>
        <div className={styles.controls}>
          <OrgSelect id="monthly-org" value={organizationId} onChange={setOrganizationId} organizations={organizations} agency={agency} />
          <label className={styles.control} htmlFor="monthly-month">
            <span>달</span>
            <select id="monthly-month" className={styles.select} value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={`${ui.button} ${ui.primary}`} onClick={download.start} disabled={download.busy}>
            {download.busy ? '내려받는 중…' : '엑셀로 내려받기'}
          </button>
        </div>
      </div>

      {download.error && (
        <p className={ui.error} role="alert">
          파일을 내려받지 못했습니다. {download.error}
        </p>
      )}
      {error && (
        <p className={ui.error} role="alert">
          집계를 불러오지 못했습니다. {error.message}
        </p>
      )}
      {loading && !data && <p className={ui.muted}>불러오는 중…</p>}

      {data && (
        <>
          <div className={styles.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>구</th>
                  <th>동</th>
                  {REGION_COLUMNS.map((c) => (
                    <th key={c.key} className={ui.num}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.regions.length === 0 && (
                  <tr>
                    <td colSpan={REGION_COLUMNS.length + 2} className={ui.muted}>
                      이 관리청에 등록된 나무가 없습니다.
                    </td>
                  </tr>
                )}
                {data.regions.map((r) => (
                  <tr key={`${r.district}-${r.dong ?? ''}`}>
                    <td>{r.district}</td>
                    <td>{r.dong ?? '-'}</td>
                    {REGION_COLUMNS.map((c) => (
                      <td key={c.key} className={ui.num}>
                        {countCell(r, c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={styles.totalRow}>
                  <td colSpan={2}>합계</td>
                  {REGION_COLUMNS.map((c) => (
                    <td key={c.key} className={ui.num}>
                      {countCell(data.totals, c)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className={ui.hint}>합계의 사람 수(돌보미, 봉사 인정 인원)는 여러 동에서 활동한 사람을 한 번만 셉니다.</p>

          <div className={styles.summary}>
            <div>
              <h3 className={styles.subTitle}>{monthLabel(data.month)} 월간 보고서</h3>
              <dl className={ui.facts}>
                <dt>제출</dt>
                <dd>{data.monthlyReports.submitted}건</dd>
                <dt>승인</dt>
                <dd>{data.monthlyReports.approved}건</dd>
                <dt>보완 요청</dt>
                <dd>{data.monthlyReports.revisionRequested}건</dd>
              </dl>
            </div>
            <div>
              <h3 className={styles.subTitle}>{monthLabel(data.month)} 물품 지급</h3>
              {data.rentals.length === 0 ? (
                <p className={ui.muted}>이 달에 승인하거나 수령한 물품이 없습니다.</p>
              ) : (
                <table className={ui.table}>
                  <thead>
                    <tr>
                      <th>물품</th>
                      <th className={ui.num}>승인 수량</th>
                      <th className={ui.num}>수령 수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rentals.map((r) => (
                      <tr key={r.item}>
                        <td>{r.item}</td>
                        <td className={ui.num}>{r.approvedQuantity}</td>
                        <td className={ui.num}>{r.receivedQuantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function CommendationSection({ organizations, agency }: { organizations: Org[]; agency?: string }) {
  const thisYear = Number(currentMonth().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  // 기준 시간은 입력 중에 매번 다시 부르지 않도록 '적용'을 눌러야 바뀐다
  const [minHoursInput, setMinHoursInput] = useState('0');
  const [minHours, setMinHours] = useState(0);
  const { data, error, loading } = useAsync(
    () => getCommendations({ year, minHours, organizationId }),
    [year, minHours, organizationId],
  );
  const download = useDownload(() => downloadCommendations({ year, minHours, organizationId }));

  const years = Array.from({ length: YEAR_OPTIONS }, (_, i) => thisYear - i);
  const inputValid = minHoursInput.trim() !== '' && Number.isFinite(Number(minHoursInput)) && Number(minHoursInput) >= 0;

  function applyMinHours(e: FormEvent) {
    e.preventDefault();
    if (inputValid) setMinHours(Number(minHoursInput));
  }

  return (
    <section className={styles.section} aria-labelledby="commendation-title">
      <div className={styles.sectionHead}>
        <div>
          <h2 id="commendation-title" className={ui.sectionTitle}>
            연말 표창 대상
          </h2>
          <p className={ui.muted}>
            그 해 이 관리청에서 승인된 봉사시간이 많은 순입니다(최대 500명). 실명이 들어가는 개인정보이니 필요한 곳에만 전달해 주세요.
          </p>
        </div>
        <div className={styles.controls}>
          <OrgSelect id="commendation-org" value={organizationId} onChange={setOrganizationId} organizations={organizations} agency={agency} />
          <label className={styles.control} htmlFor="commendation-year">
            <span>연도</span>
            <select id="commendation-year" className={styles.select} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </label>
          <form className={styles.control} onSubmit={applyMinHours}>
            <label htmlFor="commendation-min">기준 시간 이상</label>
            <span className={styles.inline}>
              <input
                id="commendation-min"
                className={`${ui.input} ${styles.hours}`}
                type="number"
                min={0}
                step={0.5}
                value={minHoursInput}
                onChange={(e) => setMinHoursInput(e.target.value)}
              />
              <button type="submit" className={`${ui.button} ${ui.small}`} disabled={!inputValid}>
                적용
              </button>
            </span>
          </form>
          <button type="button" className={`${ui.button} ${ui.primary}`} onClick={download.start} disabled={download.busy}>
            {download.busy ? '내려받는 중…' : '엑셀로 내려받기'}
          </button>
        </div>
      </div>
      <p className={ui.hint}>표창 기준 시간은 구청 확인 전이라 직접 정합니다. 내려받는 파일에도 지금 적용한 기준({minHours}시간 이상)이 들어갑니다.</p>

      {download.error && (
        <p className={ui.error} role="alert">
          파일을 내려받지 못했습니다. {download.error}
        </p>
      )}
      {error && (
        <p className={ui.error} role="alert">
          표창 대상을 불러오지 못했습니다. {error.message}
        </p>
      )}
      {loading && !data && <p className={ui.muted}>불러오는 중…</p>}

      {data &&
        (data.people.length === 0 ? (
          <p className={ui.empty}>기준에 맞는 돌보미가 없습니다.</p>
        ) : (
          <div className={styles.tableWrap}>
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
                    <td className={ui.num}>{p.approvedReports}건</td>
                    <td className={ui.num}>{p.trees}그루</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}
