import { Link } from 'react-router'
import PageTitle from '../components/PageTitle'
import { formatMinutes, reportLabel } from '../content/recordOptions'
import { currentMonthKey, formatShortDate } from '../lib/date'
import { activitiesInMonth, selectableDates } from '../lib/monthlyReport'
import { findTree } from '../mocks/sample'
import { useMonthlyReports, useRecords } from '../store/recordStore'
import './ReportPages.css'

// 하단 탭 "기록". 월간 보고서 쓰기·내 봉사시간으로 가는 입구와 이번 달 기록 목록.
export default function RecordsPage() {
  const records = useRecords()
  const reports = useMonthlyReports()
  const month = currentMonthKey()

  const openDays = selectableDates(records, month).size
  const approvedMinutes = reports.reduce((sum, r) => sum + (r.status === 'approved' ? (r.volunteerMinutes ?? 0) : 0), 0)
  const waiting = reports.filter((r) => r.status === 'submitted').length

  // 이번 달 기록(돌봄 + 신고), 최근 날짜부터
  const thisMonthRecords = records
    .filter((r) => r.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const activityCount = activitiesInMonth(records, month).length

  return (
    <div className="page">
      <PageTitle title="내 기록" description={`이번 달 돌봄 기록 ${activityCount}건이 있어요.`} />

      <div className="tc-rows">
        <Link className="tc-row records-link" to="/reports/new">
          <span className="label-lg">월간 보고서 쓰기</span>
          <span className={openDays > 0 ? 'tc-row__value' : 'tc-row__value hours-help'}>
            {openDays > 0 ? `아직 안 낸 날 ${openDays}일` : '낼 기록 없음'}
          </span>
        </Link>
        <Link className="tc-row records-link" to="/volunteer-hours">
          <span className="label-lg">내 봉사시간</span>
          <span className="tc-row__value">
            {formatMinutes(approvedMinutes)} 인정{waiting > 0 ? ` · 검토 대기 ${waiting}건` : ''}
          </span>
        </Link>
      </div>

      <section className="hours-section" aria-labelledby="this-month">
        <h2 id="this-month" className="tc-section-title">
          이번 달 기록
        </h2>
        {thisMonthRecords.length === 0 ? (
          <p className="body hours-help">아직 이번 달 기록이 없어요.</p>
        ) : (
          <ul className="tc-rows hours-list">
            {thisMonthRecords.map((r) => {
              const tree = findTree(r.treeId)
              return (
                <li key={r.id} className="tc-row hours-item">
                  <div className="hours-item__main">
                    <span className="caption hours-help">
                      {formatShortDate(r.date)} · {tree ? `${tree.species}, ${tree.place}` : ''}
                    </span>
                    <span className="body">
                      {r.type === 'activity' ? `${r.activities.join(', ')} · ${formatMinutes(r.minutes)}` : `신고: ${reportLabel(r.reportType)}`}
                    </span>
                  </div>
                  <div className="hours-item__side">
                    {r.type === 'activity' ? (
                      r.monthlyReportId ? (
                        <span className="caption hours-help">보고서에 넣음</span>
                      ) : (
                        <span className="caption">아직 안 냄</span>
                      )
                    ) : (
                      <span className={`tc-status ${r.status === '조치 완료' ? 'tc-status--done' : r.status === '현장 확인' ? 'tc-status--wait' : 'tc-status--alert'}`}>
                        {r.status}
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="page-bottom">
        <Link className="tc-btn tc-btn--primary" to="/records/new">
          오늘 돌봄 기록하기
        </Link>
      </div>
    </div>
  )
}
