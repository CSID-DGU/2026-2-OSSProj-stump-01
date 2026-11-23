// 내 알림 (API #7). 알림 화면·홈·"나" 탭이 같은 목록과 안 읽은 개수를 함께 쓴다.
import { useSyncExternalStore } from 'react'
import { api, ApiError, type Notification } from '../lib/api'

export type NotificationState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: Notification[]
  unreadCount: number
  error: string
}

let state: NotificationState = { status: 'idle', items: [], unreadCount: 0, error: '' }
const listeners = new Set<() => void>()

function setState(patch: Partial<NotificationState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

// 서버에서 다시 불러온다. 화면에 들어올 때마다 부른다.
export async function refreshNotifications() {
  setState({ status: state.status === 'ready' ? 'ready' : 'loading', error: '' }) // 이미 목록이 있으면 그대로 보여 주며 새로 받는다
  try {
    const res = await api.notifications()
    setState({ status: 'ready', items: res.notifications, unreadCount: res.unreadCount })
  } catch (err) {
    setState({ status: 'error', error: err instanceof ApiError ? err.message : '알림을 불러오지 못했어요.' })
  }
}

// 읽음 처리. 화면은 바로 읽음으로 바꾸고(기다리지 않게), 서버 요청이 실패하면 되돌린다.
export async function markNotificationRead(id: number) {
  const target = state.items.find((n) => n.id === id)
  if (!target || target.readAt) return
  const before = state
  setState({
    items: state.items.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    unreadCount: Math.max(0, state.unreadCount - 1),
  })
  try {
    await api.readNotification(id)
  } catch {
    setState({ items: before.items, unreadCount: before.unreadCount })
  }
}

// 로그아웃하면 비운다 (다른 사람이 로그인했을 때 이전 알림이 보이지 않게)
export function clearNotifications() {
  setState({ status: 'idle', items: [], unreadCount: 0, error: '' })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useNotifications(): NotificationState {
  return useSyncExternalStore(subscribe, () => state)
}
