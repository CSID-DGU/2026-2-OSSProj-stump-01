import TopBar from '../components/TopBar'
import PageTitle from '../components/PageTitle'

// 활동 기록 작성 (#39). 하단 탭 없이 상단 바(닫기)만 있는 화면의 예시.
// 다음 단계에서 사진·활동 항목·짧은 글·활동 시간 입력을 만든다.
export default function RecordNewPage() {
  return (
    <div className="app-shell tc-screen">
      <TopBar title="돌봄 기록" kind="close" />
      <div className="page">
        <PageTitle title="오늘 한 일을 남겨요" description="사진, 한 일, 짧은 글, 활동 시간을 적는 화면이 여기에 들어가요. (#39)" />
        <div className="page-bottom">
          <button className="tc-btn tc-btn--primary" type="button" disabled>
            기록 저장
          </button>
        </div>
      </div>
    </div>
  )
}
