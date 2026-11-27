// 로그인 상태. 화면 어디서나 useAuth()로 지금 로그인한 사람을 알 수 있다.
//  - checking: 저장된 토큰이 아직 유효한지 서버에 묻는 중 (앱을 처음 열 때 잠깐)
//  - guest: 로그인 안 함
//  - signed-in: 로그인함 (user가 채워짐)
import { useSyncExternalStore } from 'react'
import { api, ApiError, type SignupInput, type User } from '../lib/api'
import { getToken, setToken } from '../lib/token'
import { clearNotifications } from './notificationStore'

export type AuthState =
  | { status: 'checking'; user: null }
  | { status: 'guest'; user: null }
  | { status: 'signed-in'; user: User }

let state: AuthState = getToken() ? { status: 'checking', user: null } : { status: 'guest', user: null }
const listeners = new Set<() => void>()

function setState(next: AuthState) {
  state = next
  listeners.forEach((listener) => listener())
}

// 시민 웹은 시민 계정만 쓴다. 구청 담당자는 구청 웹에서 로그인한다.
export class OfficerAccountError extends Error {
  constructor() {
    super('구청 담당자 계정은 구청 웹에서 로그인해 주세요.')
  }
}

function signIn(token: string, user: User) {
  if (user.role !== 'citizen') throw new OfficerAccountError()
  setToken(token)
  setState({ status: 'signed-in', user })
}

export async function login(email: string, password: string) {
  const res = await api.login({ email, password })
  signIn(res.token, res.user)
}

export async function signup(input: SignupInput) {
  const res = await api.signup(input)
  signIn(res.token, res.user)
}

/** 내 정보를 고친 뒤 새 사용자 정보로 바꾼다 */
export function updateSignedInUser(user: User) {
  if (state.status === 'signed-in') setState({ status: 'signed-in', user })
}

export function logout() {
  setToken(null)
  clearNotifications()
  setState({ status: 'guest', user: null })
}

// 앱을 열 때 한 번: 저장된 토큰으로 내 정보를 불러온다. 만료됐으면 로그아웃한다.
let checking: Promise<void> | null = null
export function checkSavedLogin(): Promise<void> {
  if (state.status !== 'checking') return Promise.resolve()
  checking ??= api
    .me()
    .then((user) => {
      if (user.role === 'citizen') setState({ status: 'signed-in', user })
      else logout()
    })
    .catch((err) => {
      // 401(만료·잘못된 토큰)이면 토큰을 지우고 로그아웃한다.
      // 서버가 꺼져 있는 경우 등은 토큰을 남겨 두고 로그인 화면만 보여 준다 (서버가 켜지면 새로고침으로 돌아온다).
      if (err instanceof ApiError && err.status === 401) logout()
      else {
        console.warn('내 정보를 불러오지 못했어요:', err instanceof Error ? err.message : err)
        setState({ status: 'guest', user: null })
      }
    })
    .finally(() => {
      checking = null
    })
  return checking
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, () => state)
}
