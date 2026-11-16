// 처리 화면에서 승인·반려 등을 하면 왼쪽 메뉴의 대기 건수를 다시 세게 알린다.
// 화면끼리 직접 연결하지 않고 브라우저 이벤트 하나로 주고받는다.

const EVENT = 'treecare:counts-changed';

export function notifyCountsChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function onCountsChanged(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
