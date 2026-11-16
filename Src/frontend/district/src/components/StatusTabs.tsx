// 상태별 목록 탭 (예: 대기 / 승인 / 반려)
import styles from './StatusTabs.module.css';

export type Tab<T extends string> = { value: T; label: string };

export function StatusTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Tab<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string; // 화면 읽기 프로그램용 탭 묶음 이름
}) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={tab.value === value ? `${styles.tab} ${styles.active}` : styles.tab}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
