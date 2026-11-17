import { Link } from 'react-router'
import TopBar from '../components/TopBar'
import { formatMinutes } from '../content/recordOptions'
import { REPORT_STATUS_CLASS, REPORT_STATUS_LABEL } from '../content/reportForm'
import { currentMonthKey, formatMonth, formatShortDate, toDateKey } from '../lib/date'
import { useMonthlyReports } from '../store/recordStore'
import './ReportPages.css'

// 내 봉사시간 (#80)
// 봉사시간은 구청이 승인한 보고서로만 기록된다. 검토 대기·보완 요청인 보고서는 상태만 보여 준다.
export default function VolunteerHoursPage() {
  const reports = useMonthlyReports()
  const year = Number(currentMonthKey().slice(0, 4))

  // 올해 승인된 봉사시간 합계 (API: GET /volunteer-hours/me?year=)
  const approvedThisYear = reports
    .filter((r) => r.status === 'approved' && toDateKey(new Date(r.submittedAt)).startsWith(String(year)))
    .reduce((sum, r) => sum + (r.volunteerMinutes ?? 0), 0)

  // 최근에 낸 보고서부터
  const sorted = [...reports].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

  return (
    <div className="app-shell tc-screen">
      <TopBar title="내 봉사시간" kind="back" />
      <div className="page">
        <div className="page-title">
          <p className="caption hours-label">{year}년 인정된 봉사시간</p>
          <h1 className="display-xl">{approvedThisYear > 0 ? formatMinutes(approvedThisYear) : '아직 없어요'}</h1>
          <p className="body hours-help">구청이 승인한 월간 보고서만 봉사시간이 돼요.</p>
        </div>

        <section className="hours-section" aria-labelledby="my-reports">
          <h2 id="my-reports" className="tc-section-title">
            낸 보고서
          </h2>
          {sorted.length === 0 ? (
            <p className="body hours-help">아직 낸 보고서가 없어요.</p>
          ) : (
            <ul className="tc-rows hours-list">
              {sorted.map((report) => (
                <li key={report.id} className="tc-row hours-item">
                  <div className="hours-item__main">
                    <span className="label-lg">
                      {formatMonth(report.month)} 보고서 · {report.dates.length}일
                    </span>
                    <span className="caption hours-help">
                      {formatShortDate(toDateKey(new Date(report.submittedAt)))} 냄 · 활동 {formatMinutes(report.totalMinutes)}
                    </span>
                    {report.status === 'revision_requested' && report.reviewNote && (
                      <span className="body hours-note">구청 의견: {report.reviewNote}</span>
                    )}
                  </div>
                  <div className="hours-item__side">
                    <span className={`tc-status ${REPORT_STATUS_CLASS[report.status]}`}>{REPORT_STATUS_LABEL[report.status]}</span>
                    {report.status === 'approved' && report.volunteerMinutes !== null && (
                      <span className="caption">{formatMinutes(report.volunteerMinutes)} 인정</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="page-bottom">
          <Link className="tc-btn tc-btn--primary" to="/reports/new">
            월간 보고서 쓰기
          </Link>
        </div>
      </div>
    </div>
  )
}
