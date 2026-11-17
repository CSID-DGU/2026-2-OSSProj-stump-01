import { useNavigate } from 'react-router'

type TopBarProps = {
  title: string
  // close: 새로 쓰는 화면(가입, 기록 작성) / back: 들어간 화면(나무 상세)
  kind?: 'close' | 'back'
  // 오른쪽 칸에 보일 글자 (예: "1 / 2")
  aside?: string
}

// 하단 탭이 없는 화면 맨 위의 바. 디자인 가이드의 TopBar.
export default function TopBar({ title, kind = 'back', aside }: TopBarProps) {
  const navigate = useNavigate()

  return (
    <header className="tc-topbar">
      <button
        className="tc-topbar__btn"
        type="button"
        aria-label={kind === 'close' ? '닫기' : '뒤로'}
        onClick={() => {
          // 앱 안에서 들어왔으면 이전 화면으로, 주소로 바로 열었으면 홈으로
          const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
          if (idx > 0) navigate(-1)
          else navigate('/', { replace: true })
        }}
      >
        {kind === 'close' ? '×' : '‹'}
      </button>
      <span className="tc-topbar__title">{title}</span>
      <span className="tc-topbar__aside">{aside}</span>
    </header>
  )
}
