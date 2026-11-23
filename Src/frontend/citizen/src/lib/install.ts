// 홈 화면에 추가(PWA 설치) 안내 (#84)
// - 안드로이드 크롬 등: 브라우저가 beforeinstallprompt 이벤트를 주면 잡아 두었다가, 버튼을 누를 때 설치 창을 띄운다.
// - 아이폰 사파리: 설치 창이 없어서 "공유 → 홈 화면에 추가" 순서를 글로 안내한다.
// - 이미 홈 화면 앱으로 열었으면(standalone) 안내하지 않는다.
import { useSyncExternalStore } from 'react'

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const DISMISS_KEY = 'treecare.installHintDismissed'

let deferred: InstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

// 앱을 열 때 한 번 부른다 (main.tsx). 이벤트는 페이지가 뜨자마자 오기 때문에 화면보다 먼저 잡아야 한다
export function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // 브라우저 기본 배너 대신 우리 안내에서 띄운다
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    notify()
  })
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null // 설치 창은 한 번만 쓸 수 있다
  if (outcome === 'accepted') installed = true
  notify()
  return outcome === 'accepted'
}

export function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissInstallHint() {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // 저장이 막혀 있으면 이번에만 닫힌다
  }
  notify()
}

export type InstallState = {
  canPrompt: boolean // 설치 창을 띄울 수 있음 (안드로이드 등)
  ios: boolean // 아이폰·아이패드: 글로 안내
  installed: boolean // 이미 홈 화면 앱
  dismissed: boolean // "다음에" 를 눌렀음
}

let snapshot: InstallState | null = null
function getSnapshot(): InstallState {
  const next: InstallState = { canPrompt: deferred !== null, ios: isIOS(), installed: installed || isStandalone(), dismissed: wasDismissed() }
  if (!snapshot || JSON.stringify(snapshot) !== JSON.stringify(next)) snapshot = next
  return snapshot
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    getSnapshot,
  )
}
