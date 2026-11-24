// 백엔드 호출. 개발 서버는 /api 로 시작하는 요청을 백엔드(localhost:4000)로 넘긴다(vite.config.ts).
// 경로와 응답 모양은 Src/backend/openapi.yaml(http://localhost:4000/docs)과 맞춘다.
// 다른 화면을 API에 연결할 때 여기에 더한다.
import { getToken } from './token'

// 입력 값 오류(400)일 때 서버가 알려 주는 칸별 문제. path[0]이 칸 이름이다 (예: ['phone'])
export type ApiIssue = { path: (string | number)[]; message: string }

export class ApiError extends Error {
  status: number
  code: string
  issues: ApiIssue[]

  constructor(status: number, code: string, message: string, issues: ApiIssue[] = []) {
    super(message)
    this.status = status
    this.code = code
    this.issues = issues
  }
}

// 로그인 토큰이 있으면 Authorization 헤더에 넣어 보낸다 (로그인이 필요 없는 API는 서버가 헤더를 무시한다)
// body가 FormData(사진 등 파일)면 multipart로 그대로 보내고, 아니면 JSON으로 보낸다.
async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const isForm = body instanceof FormData
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json' // FormData는 브라우저가 경계값과 함께 정한다

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', '서버에 연결할 수 없어요. 백엔드가 켜져 있는지 확인하세요.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? '요청이 실패했어요.', data?.error?.issues ?? [])
  }
  return data as T
}

const get = <T>(path: string) => request<T>('GET', path)
const post = <T>(path: string, body: unknown) => request<T>('POST', path, body)

// ---- 타입 (openapi.yaml 의 Tree) ----
export type Tree = {
  id: number
  code: string | null // 관리번호 "자치구코드-순번"
  name: string // 화면에 보여 줄 이름 "은행나무, 소파로 3번". 서울 전체에서 겹치지 않는다 (서버가 만든다)
  species: string
  location: { lng: number; lat: number }
  district: string
  dong: string | null
  roadName: string | null
  caregiverCount: number // 승인된 돌보미 수
  careGap?: 'no_caregiver' | 'inactive' | null // 관리 사각지대(#22): 돌보미 없음 / 이번 달 활동 끊김 / null = 이번 달 활동함
  hasOpenReport: boolean // 조치 완료 전인 이상 신고가 있는지
}

// ---- 타입 (openapi.yaml 의 TreeDetail, SpeciesCard, StoryEntry) ----
export type SpeciesCard = {
  id: string
  name: string
  scientificName: string
  family: string
  leafType: string
  seoulCount: number // 서울 가로수 그루 수
  rank: number // 서울 가로수 수종 순위
  summary: string
  features: string[]
  seasons: { spring: string; summer: string; autumn: string; winter: string }
  source: string // 화면에 함께 보여 줄 출처 문구
}

export type TreeDetail = Tree & {
  agency: string // 관리청
  address: string | null
  sameRoadCount: number // 같은 자치구·노선의 나무 수
  sameDongCount: number // 같은 자치구·동의 나무 수
  speciesCard: SpeciesCard | null // 상위 10종 밖이면 null
  neighbors: TreeNeighbor[] // 양옆 나무 (같은 노선, 50m 안). 가까운 나무 → 반대쪽 나무 순, 0~2개
}

// 양옆 나무 (openapi.yaml 의 TreeNeighbor). 거리에서 내 나무를 확인하는 표시
export type TreeNeighbor = {
  id: number
  species: string
  direction: '북' | '북동' | '동' | '남동' | '남' | '남서' | '서' | '북서' // 내 나무에서 본 방향
  distanceM: number // 내 나무까지 거리(m)
}

export type StoryEntry = {
  id: number
  body: string
  isPublic: boolean
  author: { displayName: string } // 글쓴 돌보미가 고른 이름만
  likeCount: number
  replyCount: number
  createdAt: string
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

// ---- 타입 (openapi.yaml 의 MyApplication) ----
export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'ended' // 대기 / 승인 / 반려 / 종료

export type MyApplication = {
  id: number
  status: ApplicationStatus
  periodStart: string
  periodEnd: string
  applicantName: string | null
  contactPerson: string | null
  headcount: number | null
  postalCode: string | null
  address: string | null
  phone: string | null
  participationType: string | null
  motivation: string | null
  activityPlan: string | null
  organizationIntro: string | null
  agreedAt: string | null
  rejectReason: string | null // 반려 사유
  createdAt: string
  reviewedAt: string | null
  tree: { id: number; code: string | null; name: string; species: string; district: string; dong: string | null; roadName: string | null }
}

export type NewApplication = {
  treeIds: number[]
  periodStart: string // YYYY-MM-DD, 오늘이거나 그 뒤
  applicantName: string
  contactPerson: string | null // 개인·가족이 아니면 필수
  headcount: number
  postalCode: string // 5자리 숫자
  address: string
  phone: string
  participationType: string
  motivation: string
  activityPlan: string
  organizationIntro: string | null
  agreed: true
}

// ---- 타입 (openapi.yaml 의 물품) ----
export type AvailableItem = {
  id: number
  agency: string // 물품을 주는 관리청
  name: string
  stock: number // 아직 배정하지 않은 재고
}

export type RentalStatus = 'requested' | 'approved' | 'rejected' | 'received' // 신청 / 승인 / 반려 / 수령

export type MyRental = {
  id: number
  status: RentalStatus
  quantity: number
  item: { id: number; name: string; agency: string }
  rejectReason: string | null
  createdAt: string
  handledAt: string | null // 구청이 승인·반려한 시각
  receivedAt: string | null
}

// ---- 타입 (openapi.yaml 의 /weather/today) ----
export type TodayWeather = {
  date: string
  tempMax: number | null // 일 최고기온(℃)
  tempMin: number | null
  isHeatwave: boolean // 최고기온 33℃ 이상이거나 폭염특보
  warnings: string[] // 예: ["폭염경보"]
  recommendedTimes: { start: string; end: string }[] // 활동 추천 시간대
  message: string // 홈 화면 안내 문구 (서버가 만든다)
  hourly: { hour: number; temp: number | null; pop: number | null; precipitationType: number; sky: number | null }[]
  location: { treeId: number | null; nx: number; ny: number }
  forecastBase: string
}

// ---- 타입 (openapi.yaml 의 Record) ----
export type ApiRecord = {
  id: number
  type: 'activity' | 'report'
  recordedAt: string
  activityDate: string | null // 활동일 (활동 기록만)
  activityKinds: string[]
  durationMin: number | null
  memo: string | null
  photos: string[]
  location: { lat: number; lng: number } | null
  monthlyReportId: number | null
  report: { category: string; urgency: 'low' | 'high'; status: 'pending' | 'inspecting' | 'resolved' } | null
  tree: { id: number; code: string | null; name: string; species: string; district: string; dong: string | null; roadName: string | null }
}

// ---- 타입: 나이테 (#44 화면이 쓰는 모양. GET /trees/{id}/rings?year= 는 #12에서 이 모양으로 만들기로 제안) ----
export type RingMonth = {
  month: number // 1~12
  rainMm: number | null // 그 달 강수량 합계 (기상청 ASOS 일자료)
  tempMaxAvg: number | null // 그 달 평균 최고기온 (색)
  heatDays: number // 최고기온 33℃ 이상인 날 수
  careMinutes: number // 그 나무에 승인된 보고서의 활동 시간 합계 (모든 돌보미)
  careCount: number // 활동 기록 수
  activityDays: number[] // 활동 기록이 있는 날 (점)
  stories: { id: number; day: number }[] // 공개 이야기 (별, 누르면 /stories/{id})
  reported: number // 그 달 접수된 신고 수 (common/incident-markers.ts)
  resolved: number // 그 달 조치 완료된 신고 수
  reactions: number // 그 달 받은 호응(좋아요·한 줄 응답) 수
}

export type TreeRings = {
  treeId: number
  year: number
  months: RingMonth[] // 1월~12월, 12개
}

// 이야기 한 편 (GET /story-entries/{id})
export type StoryEntryDetail = StoryEntry & {
  tree: { id: number; code: string | null; name: string; species: string; district: string; roadName: string | null }
}

// 서버가 준 사진 경로("/uploads/…")를 화면에서 쓸 주소로. 개발 서버는 /api 를 백엔드로 넘긴다
export function photoUrl(path: string): string {
  return `/api${path}`
}

// ---- 타입 (openapi.yaml 의 월간 보고서) ----
export type ReportFieldKey = 'date' | 'treeName' | 'activities' | 'minutes' | 'photoCount' | 'note'

export type MonthlyReportDraft = {
  fields: { key: ReportFieldKey; label: string }[] // 구청 양식 칸 순서와 이름 (서버가 정한다)
  rows: { recordId: number; values: Partial<Record<ReportFieldKey, string | number | null>> }[]
  dates: string[]
  totalMinutes: number
  treeCount: number
  agencies: string[] // 둘 이상이면 제출할 수 없다
}

export type MonthlyReportStatus = 'submitted' | 'approved' | 'revision_requested' // 검토 대기 / 승인 / 보완 요청

export type MyMonthlyReport = {
  id: number
  status: MonthlyReportStatus
  agency: string
  totalMinutes: number
  dates: string[]
  recordCount: number
  reviewNote: string | null // 구청 의견
  submittedAt: string
  reviewedAt: string | null
  volunteerMinutes: number | null // 승인되어 기록된 봉사시간 (승인 전 null)
}

// 기록 만들기 입력. 화면이 FormData로 바꿔 보낸다
export type NewRecord =
  | { type: 'activity'; treeId: number; activityKinds: string[]; durationMin: number; memo: string; photos: File[] }
  | { type: 'report'; treeId: number; category: string; memo: string; photos: File[]; lat?: number; lng?: number }

function recordForm(input: NewRecord): FormData {
  const f = new FormData()
  f.append('type', input.type)
  f.append('treeId', String(input.treeId))
  if (input.type === 'activity') {
    input.activityKinds.forEach((k) => f.append('activityKinds', k)) // 같은 이름으로 여러 번 (쉼표 불가)
    f.append('durationMin', String(input.durationMin))
  } else {
    f.append('category', input.category)
    if (input.lat !== undefined && input.lng !== undefined) {
      f.append('lat', String(input.lat))
      f.append('lng', String(input.lng))
    }
  }
  if (input.memo) f.append('memo', input.memo)
  input.photos.forEach((p) => f.append('photos', p))
  return f
}

export const api = {
  // 지도 범위 안의 나무. 로그인 없이 부른다.
  trees: (bbox: Bbox, limit: number, district?: string) =>
    get<{ trees: Tree[]; truncated: boolean }>(
      `/trees?bbox=${bbox.join(',')}&limit=${limit}${district ? `&district=${encodeURIComponent(district)}` : ''}`,
    ),

  // 나무 상세 (QR 이야기 페이지, 로그인 없음)
  tree: (id: number) => get<TreeDetail>(`/trees/${id}`),

  // 나무별 공동 이야기: 공개 글만, 오래된 순 (로그인 없음)
  story: (id: number) => get<{ treeId: number; entries: StoryEntry[] }>(`/trees/${id}/story`),

  // 나무의 한 해 나이테 (#12, 아직 없으면 404 → 화면이 예시로 그린다)
  rings: (treeId: number, year: number) => get<TreeRings>(`/trees/${treeId}/rings?year=${year}`),

  // 이야기 한 편 (나이테의 별을 누르면 오는 곳, 로그인 없음). 비공개 글은 404
  storyEntry: (id: number) => get<StoryEntryDetail>(`/story-entries/${id}`),

  // 이야기 덧붙이기 (#64). 그 나무의 승인된 돌보미(오늘이 활동 기간 안)만 쓸 수 있다(403)
  addStoryEntry: (treeId: number, input: { body: string; authorDisplay: 'nickname' | 'real_name'; isPublic: boolean }) =>
    post<StoryEntry>(`/trees/${treeId}/story/entries`, input),

  // 신청할 수 있는 물품: 내가 승인된 돌보미인 나무의 관리청 물품만. 돌보미가 아니면 빈 목록
  rentalItems: () => get<{ items: AvailableItem[] }>('/rental-items'),

  // 물품 신청 (한 번에 5개까지). 재고 부족이나 같은 물품에 처리 중인 신청이 있으면 409
  requestRental: (itemId: number, quantity: number) => post<MyRental>('/rentals', { itemId, quantity }),

  // 내 물품 신청 현황 (최신순)
  myRentals: () => get<{ rentals: MyRental[] }>('/rentals/me'),

  // 오늘의 날씨와 활동 추천 시간 (로그인 없음). treeId를 주면 그 나무 위치 기준. 키 미설정·기상청 장애면 503
  weatherToday: (treeId?: number) => get<TodayWeather>(`/weather/today${treeId ? `?treeId=${treeId}` : ''}`),

  // 내 기록 한 달 (기본 이번 달, 최신순). 활동 기록과 이상 신고
  myRecords: (month?: string) => get<{ month: string; records: ApiRecord[] }>(`/records/me${month ? `?month=${month}` : ''}`),

  // 날짜별 활동 기록·이상 신고 만들기 (#5). 사진은 3장까지. 활동 기록은 그 나무의 돌보미만(403), 날짜는 서버가 오늘로 정한다
  createRecord: (input: NewRecord) => post<ApiRecord>('/records', recordForm(input)),

  // 월간 보고서 달력: 보고서에 안 넣은 기록이 있는 날(openDates)과 모두 낸 날(submittedDates)
  reportDates: (month: string) => get<{ month: string; openDates: string[]; submittedDates: string[] }>(`/monthly-reports/dates?month=${month}`),

  // 월간 보고서 미리보기 (저장하지 않음). 같은 달 날짜들
  reportDraft: (dates: string[]) => get<MonthlyReportDraft>(`/monthly-reports/draft?dates=${dates.join(',')}`),

  // 월간 보고서 제출 → 검토 대기. 고른 날은 다시 고를 수 없다
  submitReport: (dates: string[]) => post<MyMonthlyReport>('/monthly-reports', { dates }),

  // 내 월간 보고서 (최신순)
  myReports: () => get<{ reports: MyMonthlyReport[] }>('/monthly-reports/me'),

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

  // 돌보미 신청서 제출. 나무마다 신청서가 하나씩 생긴다. 한 그루라도 막히면 아무것도 저장하지 않는다
  apply: (input: NewApplication) => post<{ applications: MyApplication[] }>('/applications', input),

  // 내 신청서 (최신순). 반려됐으면 반려 사유가 함께 온다
  myApplications: () => get<{ applications: MyApplication[] }>('/applications/me'),
}
