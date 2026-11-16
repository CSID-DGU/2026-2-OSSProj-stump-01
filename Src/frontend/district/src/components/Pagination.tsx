// 목록 아래 '이전 / 다음'. API의 limit·offset을 그대로 쓴다.
import ui from './ui.module.css';

export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span className={ui.muted}>
        {total}건 중 {from}–{to}
      </span>
      <div className={ui.actions}>
        <button
          type="button"
          className={`${ui.button} ${ui.small}`}
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          이전
        </button>
        <button
          type="button"
          className={`${ui.button} ${ui.small}`}
          disabled={to >= total}
          onClick={() => onChange(offset + limit)}
        >
          다음
        </button>
      </div>
    </div>
  );
}
