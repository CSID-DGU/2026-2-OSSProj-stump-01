// 로그인 토큰 보관. 브라우저(localStorage)에 두어 새로고침해도 로그인이 유지된다.
// 토큰은 7일 뒤 만료되고, 만료되면 서버가 401을 돌려준다(authStore가 로그아웃 처리).
// 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 탭을 닫으면 로그인이 풀린다.

const TOKEN_KEY = 'treecare.token'
let memoryToken: string | null = null // localStorage를 못 쓸 때 대신 들고 있는 값

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function setToken(token: string | null) {
  memoryToken = token
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // 저장이 막혀 있으면 메모리 값만 쓴다
  }
}
