import { Link } from 'react-router'
import TopBar from '../components/TopBar'
import MonthRing from '../components/MonthRing'
import { findTree } from '../mocks/sample'
import { daysInThisMonth } from '../lib/date'
import { formatMinutes, reportLabel } from '../content/recordOptions'
import type { TreeRecord } from '../store/recordStore'

type RecordSavedProps = {
  record: TreeRecord
  daysBefore: number // 저장 전 이번 달 기록한 날 수
  daysAfter: number // 저장 후
}

// 저장 직후 화면. 돌봄 기록이면 고마워요 반응과 이번 달 조각 차오름, 신고면 접수 확인.
export default function RecordSaved({ record, daysBefore, daysAfter }: RecordSavedProps) {
  const tree = findTree(record.treeId)
  const treeName = tree ? `${tree.species}, ${tree.place}` : ''
  const month = Number(record.date.slice(5, 7))
  const total = daysInThisMonth()

  return (
    <div className="app-shell tc-screen">
      <TopBar title={record.type === 'activity' ? '기록 저장됨' : '신고 접수됨'} kind="close" />

      <div className="page">
        {record.type === 'activity' ? (
          <>
            <div className="record-saved__ring">
              <MonthRing
                month={month}
                fromFraction={daysBefore / total}
                toFraction={daysAfter / total}
                centerTop={`${daysAfter}일`}
                centerBottom={`${month}월 기록한 날`}
              />
            </div>
            <div className="page-title">
              <h1 className="display">고마워요</h1>
              <p className="body">
                {treeName}에 오늘의 돌봄이 남았어요.{' '}
                {daysAfter > daysBefore ? `이번 달 ${daysAfter}일째 기록이에요.` : '오늘 기록이 하나 더 쌓였어요.'}
              </p>
            </div>
            <div className="tc-rows">
              <div className="tc-row">
                <span>한 일</span>
                <span className="tc-row__value">{record.activities.join(', ')}</span>
              </div>
              <div className="tc-row">
                <span>활동 시간</span>
                <span className="tc-row__value">{formatMinutes(record.minutes)}</span>
              </div>
              <div className="tc-row">
                <span>사진</span>
                <span className="tc-row__value">{record.photoCount > 0 ? `${record.photoCount}장` : '없음'}</span>
              </div>
              <div className="tc-row">
                <span>봉사시간</span>
                <span className="tc-row__value tc-row__value--earth">월간 보고서를 내고 구청이 승인하면 기록돼요</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="page-title">
              <h1 className="display">신고를 보냈어요</h1>
              <p className="body">
                {tree?.district ?? '관리청'} 담당자에게만 전달돼요. 상태가 바뀌면 알림으로 알려 드려요.
              </p>
            </div>
            <div className="tc-rows">
              <div className="tc-row">
                <span>상태</span>
                <span className="tc-status tc-status--alert">{record.status}</span>
              </div>
              <div className="tc-row">
                <span>나무</span>
                <span className="tc-row__value">{treeName}</span>
              </div>
              <div className="tc-row">
                <span>유형</span>
                <span className="tc-row__value">{reportLabel(record.reportType)}</span>
              </div>
              <div className="tc-row">
                <span>위치</span>
                <span className="tc-row__value">{record.location ? `내 위치 (오차 약 ${record.location.accuracy}m)` : '나무 위치'}</span>
              </div>
            </div>
          </>
        )}

        <div className="page-bottom">
          <Link className="tc-btn tc-btn--primary" to="/">
            홈으로
          </Link>
          {/* reloadDocument: 화면을 새로 열어 입력칸을 비운다 */}
          <Link className="tc-link record-saved__again" to="/records/new" reloadDocument>
            {record.type === 'activity' ? '다른 나무도 기록하기' : '돌봄 기록하기'}
          </Link>
        </div>
      </div>
    </div>
  )
}
