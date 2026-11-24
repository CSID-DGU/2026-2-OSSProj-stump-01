import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import PageTitle from '../components/PageTitle'
import WeatherToday from '../components/WeatherToday'
import { formatMinutes } from '../content/recordOptions'
import { api, ApiError, type ApiRecord, type MyApplication } from '../lib/api'
import { currentMonthKey, todayKey } from '../lib/date'
import { daysBetween, myActiveTrees, summarizeMonth } from '../lib/homeSummary'
import { useAuth } from '../store/authStore'
import { refreshNotifications, useNotifications } from '../store/notificationStore'

// 이 날 수 넘게 기록이 없으면 나무 줄에 빨간 글씨로 알려 준다 (임시값, 팀 확정 전)
const QUIET_DAYS = 7

// 홈 화면 (#79): 오늘의 날씨·활동 추천 시간, 내가 돌보는 나무, 이번 달 활동 요약.
// 나이테(#44)는 이 화면에 더할 예정이다.
export default function HomePage() {
  const auth = useAuth()
  const nickname = auth.status === 'signed-in' ? auth.user.nickname : ''
  const { unreadCount } = useNotifications()
  const today = todayKey()
  const month = Number(currentMonthKey().slice(5))

  const [applications, setApplications] = useState<MyApplication[] | null>(null)
  const [records, setRecords] = useState<ApiRecord[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    refreshNotifications() // 새 알림이 있으면 맨 위에 알려 준다 (#41)
    let alive = true
    Promise.all([api.myApplications(), api.myRecords()])
      .then(([a, r]) => {
        if (!alive) return
        setApplications(a.applications)
        setRecords(r.records)
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiError ? e.message : '내 활동을 불러오지 못했어요.')
      })
    return () => {
      alive = false
    }
  }, [])

  const loaded = applications !== null && records !== null
  const trees = loaded ? myActiveTrees(applications, records, today) : []
  const summary = loaded ? summarizeMonth(records) : null
  const firstTree = trees[0]

  return (
    <div className="page home">
      <PageTitle
        title={summary && summary.activityDays > 0 ? `이번 달 ${summary.activityDays}일 돌봤어요` : `${nickname} 님, 안녕하세요`}
        description={trees.length > 0 ? `돌보는 나무 ${trees.length}그루` : '오늘 나무 곁에서 할 일을 확인해 보세요.'}
      />

      {unreadCount > 0 && (
        <div className="tc-rows">
          <Link className="tc-row home-notice" to="/notifications">
            <span>알림</span>
            <span className="tc-row__value">새 알림 {unreadCount}개</span>
          </Link>
        </div>
      )}

      {/* 오늘의 날씨: 내 첫 나무 위치 기준, 나무가 없으면 서울시청 기준 */}
      <WeatherToday
        key={firstTree?.id ?? 0}
        treeId={firstTree?.id}
        placeLabel={firstTree ? `${firstTree.name} 기준` : '서울 기준'}
      />

      {error && (
        <p className="tc-field__error" role="alert">
          {error}
        </p>
      )}

      {/* 이번 달 활동 요약 */}
      {summary && (
        <section className="home-section" aria-labelledby="home-month">
          <h2 id="home-month" className="tc-section-title">
            {month}월 활동
          </h2>
          <div className="tc-rows">
            <div className="tc-row">
              <span>기록한 날</span>
              <span className="tc-row__value">{summary.activityDays}일</span>
            </div>
            <div className="tc-row">
              <span>활동 시간</span>
              <span className="tc-row__value">{formatMinutes(summary.activityMinutes)}</span>
            </div>
            <Link className="tc-row home-notice" to="/reports/new">
              <span>보고서에 아직 안 넣은 날</span>
              <span className={summary.notInReportDays > 0 ? 'tc-row__value tc-row__value--earth' : 'tc-row__value'}>
                {summary.notInReportDays}일
              </span>
            </Link>
            {summary.openReports > 0 && (
              <div className="tc-row">
                <span>처리 중인 내 신고</span>
                <span className="tc-row__value tc-row__value--earth">{summary.openReports}건</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 내가 돌보는 나무 */}
      {loaded && (
        <section className="home-section" aria-labelledby="home-trees">
          <h2 id="home-trees" className="tc-section-title">
            내가 돌보는 나무
          </h2>
          {trees.length === 0 ? (
            <div className="home-empty">
              <p className="body home-muted">아직 돌보는 나무가 없어요. 지도에서 나무를 골라 돌보미를 신청해 보세요.</p>
              <Link className="tc-link" to="/map">
                지도에서 나무 고르기
              </Link>
            </div>
          ) : (
            <div className="tc-rows">
              {trees.map((t) => {
                const gap = t.lastActivityDate ? daysBetween(t.lastActivityDate, today) : null
                const quiet = gap === null || gap >= QUIET_DAYS
                let meta = '이번 달 기록 없음'
                if (gap === 0) meta = '오늘 기록'
                else if (gap !== null) meta = `${gap}일 전 기록`
                return (
                  <Link key={t.id} className="tc-tree tc-row" to={`/trees/${t.id}`}>
                    <span className="tc-tree__name">
                      {t.name}
                    </span>
                    <span className={quiet && gap !== 0 ? 'tc-tree__meta tc-tree__meta--danger' : 'tc-tree__meta'}>{meta}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      )}

      <div className="page-bottom">
        {trees.length > 0 ? (
          <>
            <Link className="tc-btn tc-btn--primary" to="/records/new">
              오늘 돌봄 기록하기
            </Link>
            <Link className="tc-link tc-link--muted home-report-link" to="/records/new?type=report">
              나무가 아파 보여요
            </Link>
          </>
        ) : (
          <Link className="tc-btn tc-btn--primary" to="/map">
            돌볼 나무 찾기
          </Link>
        )}
      </div>
    </div>
  )
}
