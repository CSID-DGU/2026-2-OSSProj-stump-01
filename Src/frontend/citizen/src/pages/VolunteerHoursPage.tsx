import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import TopBar from '../components/TopBar'
import { formatMinutes } from '../content/recordOptions'
import { REPORT_STATUS_CLASS, REPORT_STATUS_LABEL } from '../content/reportForm'
import { api, ApiError, type MyMonthlyReport } from '../lib/api'
import { currentMonthKey, formatMonth, formatShortDate, toDateKey } from '../lib/date'
import './ReportPages.css'

// 내 봉사시간 (#80, API #62·#69)
// 봉사시간은 구청이 승인한 보고서로만 기록된다. 검토 대기·보완 요청인 보고서는 상태와 구청 의견만 보여 준다.
export default function VolunteerHoursPage() {
  const [reports, setReports] = useState<MyMonthlyReport[] | null>(null)
  const [error, setError] = useState('')
  const year = currentMonthKey().slice(0, 4)

  useEffect(() => {
    let alive = true
    api
      .myReports()
      .then((r) => {
        if (alive) setReports(r.reports)
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiError ? e.message : '보고서를 불러오지 못했어요.')
      })
    return () => {
      alive = false
    }
  }, [])

  // 올해 승인되어 기록된 봉사시간 합계
  const approvedThisYear = (reports ?? [])
    .filter((r) => r.status === 'approved' && toDateKey(new Date(r.reviewedAt ?? r.submittedAt)).startsWith(year))
    .reduce((sum, r) => sum + (r.volunteerMinutes ?? 0), 0)

  return (
    <div className="app-shell tc-screen">
      <TopBar title="내 봉사시간" kind="back" />
      <div className="page">
        <div className="page-title">
          <p className="caption hours-label">{year}년 인정된 봉사시간</p>
          <h1 className="display-xl">{reports === null ? '…' : approvedThisYear > 0 ? formatMinutes(approvedThisYear) : '아직 없어요'}</h1>
          <p className="body hours-help">구청이 승인한 월간 보고서만 봉사시간이 돼요.</p>
        </div>

        {error && (
          <p className="tc-field__error" role="alert">
            {error}
          </p>
        )}

        {reports && (
          <section className="hours-section" aria-labelledby="my-reports">
            <h2 id="my-reports" className="tc-section-title">
              낸 보고서
            </h2>
            {reports.length === 0 ? (
              <p className="body hours-help">아직 낸 보고서가 없어요.</p>
            ) : (
              <ul className="tc-rows hours-list">
                {reports.map((report) => (
                  <li key={report.id} className="tc-row hours-item">
                    <div className="hours-item__main">
                      <span className="label-lg">
                        {report.dates[0] ? formatMonth(report.dates[0].slice(0, 7)) : ''} 보고서 · {report.dates.length}일
                      </span>
                      <span className="caption hours-help">
                        {formatShortDate(toDateKey(new Date(report.submittedAt)))} 냄 · 활동 {formatMinutes(report.totalMinutes)} · {report.agency}
                      </span>
                      {report.reviewNote && (
                        <span className={report.status === 'revision_requested' ? 'body hours-note' : 'caption hours-help'}>구청 의견: {report.reviewNote}</span>
                      )}
                    </div>
                    <div className="hours-item__side">
                      <span className={`tc-status ${REPORT_STATUS_CLASS[report.status]}`}>{REPORT_STATUS_LABEL[report.status]}</span>
                      {report.status === 'approved' && report.volunteerMinutes !== null && <span className="caption">{formatMinutes(report.volunteerMinutes)} 인정</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="page-bottom">
          <Link className="tc-btn tc-btn--primary" to="/reports/new">
            월간 보고서 쓰기
          </Link>
        </div>
      </div>
    </div>
  )
}
