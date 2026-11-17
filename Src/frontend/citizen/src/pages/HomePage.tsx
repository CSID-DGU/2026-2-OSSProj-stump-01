import { Link } from 'react-router'
import PageTitle from '../components/PageTitle'
import { myTrees, thisMonth } from '../mocks/sample'
import { countRecordDaysThisMonth, useRecords } from '../store/recordStore'
import { todayKey } from '../lib/date'

// 기록이 며칠 끊기면 빨간 글씨로 보여 줄지 정하는 기준 (임시값, 팀 확정 전)
const QUIET_DAYS = 7

// 홈 화면 (#79). 지금은 뼈대: 이번 달 요약과 내 나무 목록.
// 오늘의 날씨와 나이테는 #79, #44에서 더한다.
export default function HomePage() {
  const records = useRecords()
  const recordDays = countRecordDaysThisMonth(records)
  const today = todayKey()

  return (
    <div className="page">
      <PageTitle title={`이번 달 ${recordDays}일 기록했어요`} description="과거 기록과 이야기·응답 숫자는 예시 데이터예요." />

      <div className="tc-rows">
        <div className="tc-row">
          <span>덧붙인 이야기</span>
          <span className="tc-row__value">
            {thisMonth.stories}편, 응답 {thisMonth.responses}
          </span>
        </div>
        <div className="tc-row">
          <span>구청 확인</span>
          {thisMonth.districtChecked ? (
            <span className="tc-row__value">확인됨</span>
          ) : (
            <span className="tc-row__value tc-row__value--earth">아직 없음, 기록은 그대로 남습니다</span>
          )}
        </div>
      </div>

      <div className="tc-rows">
        {myTrees.map((tree) => {
          // 오늘 저장한 돌봄 기록이 있으면 "오늘 기록"으로 보여 준다
          const doneToday = records.some((r) => r.type === 'activity' && r.treeId === tree.id && r.date === today)
          const quiet = !doneToday && tree.lastRecordDaysAgo >= QUIET_DAYS
          let meta = `${tree.lastRecordDaysAgo}일 전 기록, 함께 ${tree.caretakers}명`
          if (doneToday) meta = `오늘 기록, 함께 ${tree.caretakers}명`
          else if (quiet) meta = `${tree.lastRecordDaysAgo}일째 기록 없음`
          return (
            <Link key={tree.id} className="tc-tree tc-row" to={`/trees/${tree.id}`}>
              <span className="tc-tree__name">
                {tree.species}, {tree.place}
              </span>
              <span className={quiet ? 'tc-tree__meta tc-tree__meta--danger' : 'tc-tree__meta'}>{meta}</span>
            </Link>
          )
        })}
      </div>

      <div className="page-bottom">
        <Link className="tc-btn tc-btn--primary" to="/records/new">
          오늘 돌봄 기록하기
        </Link>
        <Link className="tc-link tc-link--muted home-report-link" to="/records/new?type=report">
          나무가 아파 보여요
        </Link>
      </div>
    </div>
  )
}
