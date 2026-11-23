import { Link } from 'react-router'
import TopBar from '../components/TopBar'
import MonthRing from '../components/MonthRing'
import { daysInThisMonth, todayKey } from '../lib/date'
import { formatMinutes, reportLabel } from '../content/recordOptions'
import { photoUrl, type ApiRecord } from '../lib/api'

type RecordSavedProps = {
  record: ApiRecord // 서버가 돌려준 기록
  treeName: string
  agency: string // 신고가 가는 관리청
  daysBefore: number // 저장 전 이번 달 기록한 날 수
  daysAfter: number // 저장 후
}

const REPORT_STATUS_LABEL = { pending: '확인 필요', inspecting: '현장 확인', resolved: '조치 완료' } as const

// 저장 직후 화면. 돌봄 기록이면 고마워요 반응과 이번 달 조각 차오름, 신고면 접수 확인.
export default function RecordSaved({ record, treeName, agency, daysBefore, daysAfter }: RecordSavedProps) {
  const day = record.activityDate ?? todayKey()
  const month = Number(day.slice(5, 7))
  const total = daysInThisMonth()

  return (
    <div className="app-shell tc-screen">
      <TopBar title={record.type === 'activity' ? '기록 저장됨' : '신고 접수됨'} kind="close" />

      <div className="page">
        {record.type === 'activity' ? (
          <>
            <div className="record-saved__ring">
              <MonthRing month={month} fromFraction={daysBefore / total} toFraction={daysAfter / total} centerTop={`${daysAfter}일`} centerBottom={`${month}월 기록한 날`} />
            </div>
            <div className="page-title">
              <h1 className="display">고마워요</h1>
              <p className="body">
                {treeName}에 오늘의 돌봄이 남았어요. {daysAfter > daysBefore ? `이번 달 ${daysAfter}일째 기록이에요.` : '오늘 기록이 하나 더 쌓였어요.'}
              </p>
            </div>
            <div className="tc-rows">
              <div className="tc-row">
                <span>한 일</span>
                <span className="tc-row__value">{record.activityKinds.join(', ')}</span>
              </div>
              <div className="tc-row">
                <span>활동 시간</span>
                <span className="tc-row__value">{formatMinutes(record.durationMin ?? 0)}</span>
              </div>
              <div className="tc-row">
                <span>사진</span>
                <span className="tc-row__value">{record.photos.length > 0 ? `${record.photos.length}장` : '없음'}</span>
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
              <p className="body">{agency || '관리청'} 담당자에게만 전달돼요. 상태가 바뀌면 알림으로 알려 드려요.</p>
            </div>
            <div className="tc-rows">
              <div className="tc-row">
                <span>상태</span>
                <span className="tc-status tc-status--alert">{REPORT_STATUS_LABEL[record.report?.status ?? 'pending']}</span>
              </div>
              <div className="tc-row">
                <span>나무</span>
                <span className="tc-row__value">{treeName}</span>
              </div>
              <div className="tc-row">
                <span>유형</span>
                <span className="tc-row__value">{reportLabel(record.report?.category ?? '')}</span>
              </div>
              <div className="tc-row">
                <span>위치</span>
                <span className="tc-row__value">{record.location ? '내 위치' : '나무 위치'}</span>
              </div>
            </div>
          </>
        )}

        {record.photos.length > 0 && (
          <ul className="tc-photos record-saved__photos" aria-label="올린 사진">
            {record.photos.map((p, i) => (
              <li key={p} className="tc-photos__item">
                <img src={photoUrl(p)} alt={`올린 사진 ${i + 1}`} />
              </li>
            ))}
          </ul>
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
