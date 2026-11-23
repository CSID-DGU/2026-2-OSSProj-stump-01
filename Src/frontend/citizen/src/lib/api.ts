// 백엔드 호출. 개발 서버는 /api 로 시작하는 요청을 백엔드(localhost:4000)로 넘긴다(vite.config.ts).
// 경로와 응답 모양은 Src/backend/openapi.yaml(http://localhost:4000/docs)과 맞춘다.
// 다른 화면을 API에 연결할 때 여기에 더한다.
import { getToken } from './token'

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// 로그인 토큰이 있으면 Authorization 헤더에 넣어 보낸다 (로그인이 필요 없는 API는 서버가 헤더를 무시한다)
async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'NETWORK', '서버에 연결할 수 없어요. 백엔드가 켜져 있는지 확인하세요.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? '요청이 실패했어요.')
  }
  return data as T
}

const get = <T>(path: string) => request<T>('GET', path)
const post = <T>(path: string, body: unknown) => request<T>('POST', path, body)

// ---- 타입 (openapi.yaml 의 Tree) ----
export type Tree = {
  id: number
  code: string | null // 관리번호 "자치구코드-순번"
  species: string
  location: { lng: number; lat: number }
  district: string
  dong: string | null
  roadName: string | null
  caregiverCount: number // 승인된 돌보미 수
  hasOpenReport: boolean // 조치 완료 전인 이상 신고가 있는지
}

// [서쪽 경도, 남쪽 위도, 동쪽 경도, 북쪽 위도]
export type Bbox = [number, number, number, number]

// ---- 타입 (openapi.yaml 의 User, AuthResponse) ----
export type User = {
  id: number
  email: string
  nickname: string // 활동 이름. 이야기·응답에 보인다
  role: 'citizen' | 'officer' // 시민 / 구청 담당자
  agency: string | null // 구청 담당자의 소속 관리청
  educationCompleted: boolean // 돌보미 교육 이수 여부
}

export type AuthResponse = {
  token: string // 7일 유효
  user: User
}

// ---- 타입 (openapi.yaml 의 Notification) ----
export type NotificationType =
  | 'application_result' // 돌보미 신청 승인·반려
  | 'monthly_report_result' // 월간 보고서 승인·보완 요청
  | 'rental_result' // 물품 승인·반려
  | 'report_resolved' // 이상 신고 조치 완료
  | 'story_reaction' // 받은 호응

export type Notification = {
  id: number
  type: NotificationType
  title: string
  body: string
  treeId: number | null
  reportId: number | null
  readAt: string | null // 읽은 시각 (안 읽었으면 null)
  createdAt: string
}

export const api = {
  // 지도 범위 안의 나무. 로그인 없이 부른다.
  trees: (bbox: Bbox, limit: number, district?: string) =>
    get<{ trees: Tree[]; truncated: boolean }>(
      `/trees?bbox=${bbox.join(',')}&limit=${limit}${district ? `&district=${encodeURIComponent(district)}` : ''}`,
    ),

  // 회원가입 (시민 계정만). 실명·연락처는 받지 않는다
  signup: (input: { email: string; password: string; nickname: string }) => post<AuthResponse>('/auth/signup', input),

  // 로그인 (시민·구청 담당자 공통)
  login: (input: { email: string; password: string }) => post<AuthResponse>('/auth/login', input),

  // 내 정보 (토큰 필요)
  me: () => get<User>('/auth/me'),

  // 내 알림, 최신순 (토큰 필요). unreadCount는 limit과 상관없는 전체 안 읽은 개수
  notifications: (limit = 50) => get<{ notifications: Notification[]; unreadCount: number }>(`/notifications?limit=${limit}`),

  // 알림 읽음 처리 (이미 읽었으면 처음 읽은 시각을 유지)
  readNotification: (id: number) => request<Notification>('PATCH', `/notifications/${id}/read`),
}
