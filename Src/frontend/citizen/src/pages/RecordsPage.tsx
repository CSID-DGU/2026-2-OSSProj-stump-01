import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import PageTitle from '../components/PageTitle'
import { formatMinutes, reportLabel } from '../content/recordOptions'
import { api, ApiError, type ApiRecord, type MyMonthlyReport } from '../lib/api'
import { formatShortDate, toDateKey } from '../lib/date'
import './ReportPages.css'

const REPORT_STATUS = {
  pending: { label: '확인 필요', className: 'tc-status--alert' },
  inspecting: { label: '현장 확인', className: 'tc-status--wait' },
  resolved: { label: '조치 완료', className: 'tc-status--done' },
} as const

// 하단 탭 "기록": 월간 보고서 쓰기·내 봉사시간 입구와 이번 달 기록 목록 (API #5, #62)
export default function RecordsPage() {
  const [records, setRecords] = useState<ApiRecord[] | null>(null)
  const [reports, setReports] = useState<MyMonthlyReport[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([api.myRecords(), api.myReports()])
      .then(([r, m]) => {
        if (!alive) return
        setRecords(r.records)
        setReports(m.reports)
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiError ? e.message : '기록을 불러오지 못했어요.')
      })
    return () => {
      alive = false
    }
  }, [])

  const activities = (records ?? []).filter((r) => r.type === 'activity')
  const openDays = new Set(activities.filter((r) => r.monthlyReportId === null).map((r) => r.activityDate)).size
  const approvedMinutes = (reports ?? []).reduce((sum, r) => sum + (r.status === 'approved' ? (r.volunteerMinutes ?? 0) : 0), 0)
  const waiting = (reports ?? []).filter((r) => r.status === 'submitted').length

  return (
    <div className="page">
      <PageTitle title="내 기록" description={records ? `이번 달 돌봄 기록 ${activities.length}건이 있어요.` : '불러오는 중이에요.'} />

      {error && (
        <p className="tc-field__error" role="alert">
          {error}
        </p>
      )}

      <div className="tc-rows">
        <Link className="tc-row records-link" to="/reports/new">
          <span className="label-lg">월간 보고서 쓰기</span>
          <span className={openDays > 0 ? 'tc-row__value' : 'tc-row__value hours-help'}>{openDays > 0 ? `아직 안 낸 날 ${openDays}일` : '낼 기록 없음'}</span>
        </Link>
        <Link className="tc-row records-link" to="/volunteer-hours">
          <span className="label-lg">내 봉사시간</span>
          <span className="tc-row__value">
            {formatMinutes(approvedMinutes)} 인정{waiting > 0 ? ` · 검토 대기 ${waiting}건` : ''}
          </span>
        </Link>
      </div>

      {records && (
        <section className="hours-section" aria-labelledby="this-month">
          <h2 id="this-month" className="tc-section-title">
            이번 달 기록
          </h2>
          {records.length === 0 ? (
            <p className="body hours-help">아직 이번 달 기록이 없어요.</p>
          ) : (
            <ul className="tc-rows hours-list">
              {records.map((r) => {
                const place = r.tree.roadName ?? r.tree.dong ?? r.tree.district
                const day = r.activityDate ?? toDateKey(new Date(r.recordedAt))
                return (
                  <li key={r.id} className="tc-row hours-item">
                    <div className="hours-item__main">
                      <span className="caption hours-help">
                        {formatShortDate(day)} · {r.tree.species}, {place}
                      </span>
                      <span className="body">
                        {r.type === 'activity'
                          ? `${r.activityKinds.join(', ')} · ${formatMinutes(r.durationMin ?? 0)}${r.photos.length ? ` · 사진 ${r.photos.length}장` : ''}`
                          : `신고: ${reportLabel(r.report?.category ?? '')}`}
                      </span>
                    </div>
                    <div className="hours-item__side">
                      {r.type === 'activity' ? (
                        r.monthlyReportId ? <span className="caption hours-help">보고서에 넣음</span> : <span className="caption">아직 안 냄</span>
                      ) : (
                        r.report && <span className={`tc-status ${REPORT_STATUS[r.report.status].className}`}>{REPORT_STATUS[r.report.status].label}</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <div className="page-bottom">
        <Link className="tc-btn tc-btn--primary" to="/records/new">
          오늘 돌봄 기록하기
        </Link>
      </div>
    </div>
  )
}
