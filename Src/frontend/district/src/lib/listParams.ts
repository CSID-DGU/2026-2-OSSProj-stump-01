// 목록 화면의 상태 탭·쪽(offset)·선택한 항목·단체를 주소(?status=&offset=&id=&organizationId=)에 둔다.
// 새로고침하거나 주소를 공유해도 같은 화면이 열린다.
import { useEffect, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useListParams<T extends string>(statuses: readonly T[], defaultStatus: T) {
  const [params, setParams] = useSearchParams();

  const rawStatus = params.get('status');
  const status = statuses.includes(rawStatus as T) ? (rawStatus as T) : defaultStatus;
  const rawOffset = Number(params.get('offset'));
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const rawId = Number(params.get('id'));
  const selectedId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;
  const rawOrg = Number(params.get('organizationId'));
  const organizationId = Number.isInteger(rawOrg) && rawOrg > 0 ? rawOrg : null; // 잘못된 값이면 전체

  function update(next: { status?: T; offset?: number; id?: number | null; organizationId?: number | null }) {
    const p = new URLSearchParams(params);
    const set = (key: string, value: string | null) => (value ? p.set(key, value) : p.delete(key));
    if (next.status !== undefined) {
      set('status', next.status === defaultStatus ? null : next.status);
      p.delete('offset'); // 탭을 바꾸면 첫 쪽부터
      p.delete('id');
    }
    if (next.organizationId !== undefined) {
      set('organizationId', next.organizationId ? String(next.organizationId) : null);
      p.delete('offset'); // 단체를 바꾸면 첫 쪽부터
      p.delete('id');
    }
    if (next.offset !== undefined) set('offset', next.offset ? String(next.offset) : null);
    if (next.id !== undefined) set('id', next.id ? String(next.id) : null);
    setParams(p, { replace: true });
  }

  return {
    status,
    offset,
    selectedId,
    organizationId,
    setStatus: (s: T) => update({ status: s }),
    setOrganization: (id: number | null) => update({ organizationId: id }),
    setOffset: (o: number) => update({ offset: o }),
    select: (id: number | null) => update({ id }),
  };
}

/**
 * 뒤쪽 쪽에서 마지막 항목을 처리해 그 쪽이 비면, 남은 항목이 있는 마지막 쪽으로 옮긴다.
 * (예: 2쪽의 하나 남은 신청을 승인하면 1쪽으로)
 */
export function useOffsetFallback(
  page: { items: unknown[]; total: number } | null,
  offset: number,
  pageSize: number,
  setOffset: (offset: number) => void,
): void {
  useEffect(() => {
    if (!page || page.items.length > 0 || offset === 0) return;
    const lastOffset = page.total > 0 ? Math.floor((page.total - 1) / pageSize) * pageSize : 0;
    setOffset(Math.min(lastOffset, Math.max(0, offset - pageSize)));
    // page가 바뀔 때만 확인한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
}

/** 표의 한 줄을 마우스 클릭과 키보드(Tab으로 이동, Enter·Space로 선택) 모두로 고를 수 있게 한다 */
export function selectableRow(onSelect: () => void) {
  return {
    tabIndex: 0,
    onClick: onSelect,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect();
      }
    },
  };
}
