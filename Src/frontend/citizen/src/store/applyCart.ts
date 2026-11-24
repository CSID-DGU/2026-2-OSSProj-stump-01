// 신청할 나무 담기 (#40). 지도에서 나무를 담고 신청서 화면에서 꺼내 쓴다.
// 로그인 화면을 거쳐 와도 남아 있도록 sessionStorage(탭을 닫으면 지워짐)에 둔다.
import { useSyncExternalStore } from 'react'
import { MAX_TREES } from '../content/applicationForm'

export type CartTree = {
  id: number
  species: string
  name: string // 나무 이름 "은행나무, 소파로 3번" (서버의 Tree.name)
  district: string
  code: string | null
}

const KEY = 'treecare.applyCart'

function load(): CartTree[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    // 이름(name)이 없는 옛 모양의 담은 나무는 버린다 (지도에서 다시 담으면 된다)
    return raw ? (JSON.parse(raw) as CartTree[]).filter((t) => typeof t.name === 'string') : []
  } catch {
    return []
  }
}

let cart: CartTree[] = load()
const listeners = new Set<() => void>()

function save(next: CartTree[]) {
  cart = next
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cart))
  } catch {
    // 저장이 막혀 있어도 이 탭에서는 동작한다
  }
  listeners.forEach((listener) => listener())
}

// 담기. 이미 있거나 MAX_TREES를 넘으면 false
export function addToCart(tree: CartTree): boolean {
  if (cart.some((t) => t.id === tree.id) || cart.length >= MAX_TREES) return false
  save([...cart, tree])
  return true
}

export function removeFromCart(id: number) {
  save(cart.filter((t) => t.id !== id))
}

export function clearCart() {
  save([])
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useApplyCart(): CartTree[] {
  return useSyncExternalStore(subscribe, () => cart)
}
