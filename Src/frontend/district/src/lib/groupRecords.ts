// 보고서의 활동 기록을 날짜별로 묶는다. 화면과 분리한 함수라 따로 확인할 수 있다.

export type DayGroup<T> = { date: string; records: T[]; minutes: number };

/** 기록을 activityDate별로 묶고 날짜순으로 정렬한다. 같은 날 안에서는 받은 순서를 지킨다. */
export function groupByDate<T extends { activityDate: string; durationMin: number }>(records: T[]): DayGroup<T>[] {
  const map = new Map<string, DayGroup<T>>();
  for (const r of records) {
    let group = map.get(r.activityDate);
    if (!group) {
      group = { date: r.activityDate, records: [], minutes: 0 };
      map.set(r.activityDate, group);
    }
    group.records.push(r);
    group.minutes += r.durationMin;
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
