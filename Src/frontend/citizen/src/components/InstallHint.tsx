import { useState } from 'react'
import { dismissInstallHint, promptInstall, useInstall } from '../lib/install'
import './InstallHint.css'

type InstallHintProps = {
  // after-record: 기록 저장 뒤 한 번 ("다음에"를 누르면 다시 안 보임)
  // me: "나" 탭에서 언제든
  place: 'after-record' | 'me'
}

// 홈 화면에 추가 안내 (#84). 휴대폰에서만 보인다(field-only). 이미 홈 화면 앱으로 열었으면 보이지 않는다.
export default function InstallHint({ place }: InstallHintProps) {
  const { canPrompt, ios, installed, dismissed } = useInstall()
  const [done, setDone] = useState(false)

  if (installed || done) return null
  if (place === 'after-record' && dismissed) return null
  if (!canPrompt && !ios && place === 'after-record') return null // 설치 창도 없고 아이폰도 아니면 기록 뒤에는 조용히 둔다

  return (
    <section className="install field-only" aria-labelledby={`install-${place}`}>
      <h2 id={`install-${place}`} className="tc-section-title">
        홈 화면에 TreeCare 추가하기
      </h2>
      <p className="body install__text">앱을 설치하지 않아도 홈 화면 아이콘으로 바로 열 수 있어요. 나무 앞에서 기록하기가 더 쉬워져요.</p>

      {canPrompt ? (
        <div className="tc-choices__list">
          <button
            type="button"
            className="tc-choice"
            onClick={async () => {
              if (await promptInstall()) setDone(true)
            }}
          >
            홈 화면에 추가
          </button>
          {place === 'after-record' && (
            <button type="button" className="tc-link tc-link--muted install__later" onClick={dismissInstallHint}>
              다음에
            </button>
          )}
        </div>
      ) : ios ? (
        <>
          <ol className="body install__steps">
            <li>
              화면 아래의 공유 버튼 <span className="install__icon" aria-label="공유 아이콘">□↑</span>을 눌러요.
            </li>
            <li>"홈 화면에 추가"를 고르고 "추가"를 눌러요.</li>
          </ol>
          {place === 'after-record' && (
            <button type="button" className="tc-link tc-link--muted install__later" onClick={dismissInstallHint}>
              다음에
            </button>
          )}
        </>
      ) : (
        <p className="caption install__text">브라우저 메뉴(⋮)에서 "홈 화면에 추가" 또는 "앱 설치"를 눌러 주세요.</p>
      )}
    </section>
  )
}
