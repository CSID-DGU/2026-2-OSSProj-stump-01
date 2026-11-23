import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { listenForInstallPrompt } from './lib/install'

// 홈 화면에 추가 안내용 이벤트는 화면보다 먼저 잡는다 (#84)
listenForInstallPrompt()

// 서비스 워커(public/sw.js)는 배포 빌드에서만 켠다. 개발 중에 켜면 저장된 옛 화면이 보여 헷갈린다 (#84)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('서비스 워커 등록 실패:', e))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
