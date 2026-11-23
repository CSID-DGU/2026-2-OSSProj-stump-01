// TreeCare 시민 웹 서비스 워커 (#84)
// - 화면 파일(/assets/*, 아이콘)은 저장해 두고 다시 쓴다. 파일 이름에 내용 해시가 붙어 있어 바뀌면 새 이름이 된다.
// - 페이지 이동은 먼저 서버에 묻고, 인터넷이 끊겼으면 저장해 둔 첫 화면(/)을 보여 준다.
// - API(/api/*)와 사진(/uploads/*)은 저장하지 않는다. 개인 기록이 기기에 남거나 오래된 값이 보이면 안 된다.
// 이 파일을 고치면 CACHE 이름의 숫자를 올린다. 그래야 예전 저장분이 지워진다.

const CACHE = 'treecare-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  // 하나씩 받아 덮어쓴다. cache.addAll은 같은 설치가 겹치면 "Entry already exists"로 통째로 실패해서 쓰지 않는다.
  // 파일 하나를 못 받아도 설치는 끝내고, 그 파일은 처음 쓸 때 저장한다.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((res) => (res.ok ? cache.put(url, res).catch(() => undefined) : undefined))
            .catch(() => undefined),
        ),
      ),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return // 다른 사이트(글꼴·지도)는 브라우저에 맡긴다
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return // API·사진은 저장하지 않는다

  // 페이지 이동: 서버 먼저, 안 되면 저장해 둔 첫 화면 (화면 이동은 React Router가 한다)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          // 저장이 겹쳐 실패해도(Entry already exists) 화면에는 영향이 없으니 조용히 넘어간다
          caches.open(CACHE).then((cache) => cache.put('/', copy)).catch(() => undefined)
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // 화면 파일: 저장분 먼저, 없으면 받아서 저장
  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined)
            }
            return res
          }),
      ),
    )
  }
})
