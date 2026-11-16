// 목록 화면의 상태 탭·쪽(offset)·선택한 항목을 주소(?status=&offset=&id=)에 둔다.
// 새로고침하거나 주소를 공유해도 같은 화면이 열린다.
import { useSearchParams } from 'react-router-dom';

export function useListParams<T extends string>(statuses: readonly T[], defaultStatus: T) {
  const [params, setParams] = useSearchParams();

  const rawStatus = params.get('status');
  const status = statuses.includes(rawStatus as T) ? (rawStatus as T) : defaultStatus;
  const rawOffset = Number(params.get('offset'));
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const rawId = Number(params.get('id'));
  const selectedId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;

  function update(next: { status?: T; offset?: number; id?: number | null }) {
    const p = new URLSearchParams(params);
    const set = (key: string, value: string | null) => (value ? p.set(key, value) : p.delete(key));
    if (next.status !== undefined) {
      set('status', next.status === defaultStatus ? null : next.status);
      p.delete('offset'); // 탭을 바꾸면 첫 쪽부터
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
    setStatus: (s: T) => update({ status: s }),
    setOffset: (o: number) => update({ offset: o }),
    select: (id: number | null) => update({ id }),
  };
}
