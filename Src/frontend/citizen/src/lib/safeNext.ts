// 로그인 뒤 돌아갈 주소. 우리 앱 안의 주소("/"로 시작, "//"는 다른 사이트라 제외)만 허용한다.
export function safeNext(next: string | null): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next
  return '/'
}
