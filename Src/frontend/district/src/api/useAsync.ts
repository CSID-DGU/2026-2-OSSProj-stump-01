// API를 불러와 { data, error, loading }으로 돌려주는 훅. deps가 바뀌거나 reload()를 부르면 다시 불러온다.
import { useCallback, useEffect, useState, type DependencyList } from 'react';

export type AsyncState<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
};

export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false; // 화면을 떠났거나 조건이 바뀐 뒤 늦게 온 응답은 버린다
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // load는 매번 새로 만들어지므로 deps로 다시 부를 때를 정한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  return { data, error, loading, reload };
}
