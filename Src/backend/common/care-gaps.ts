// #22 관리 사각지대 판정 (Src/용어.md: 돌보미가 없거나 이번 달 활동이 끊긴 나무)
// 구청 집계(district/care-gaps.ts)와 시민 지도(나무 조회 응답)가 같은 정의를 쓰도록 SQL 조각을 여기에 모은다.
// 정의를 바꾸려면 이 파일만 고친다.
//
// - 돌보미가 있는 나무: 그 달에 활동 기간이 걸친 '승인된' 신청서가 있는 나무
// - 활동이 끊긴 나무: 돌보미는 있는데 그 달에 활동 기록(records.type = 'activity')이 하나도 없는 나무
//   (이번 달이면 오늘까지의 기록으로 본다)
// - 달은 한국 시간 달력 기준이다. 기록의 activity_date도 한국 날짜다.

export const CARE_GAP_TIME_ZONE = 'Asia/Seoul';

export type CareGap = 'no_caregiver' | 'inactive'; // 돌보미 없음 / 이번 달 활동 끊김

/** 지금 한국 시간 기준 이번 달 첫날(date) */
export const CURRENT_MONTH_START_SQL = `date_trunc('month', now() AT TIME ZONE '${CARE_GAP_TIME_ZONE}')::date`;

/** 신청서 a가 monthStart(date) 달에 활동 기간이 걸친 승인된 돌보미인지 */
export function activeCaregiverSql(a: string, monthStart: string): string {
  return `(${a}.status = 'approved'
    AND ${a}.period_start < (${monthStart} + interval '1 month')
    AND ${a}.period_end >= ${monthStart})`;
}

/** 기록 r이 monthStart(date) 달의 활동 기록인지 */
export function activityInMonthSql(r: string, monthStart: string): string {
  return `(${r}.type = 'activity'
    AND ${r}.activity_date >= ${monthStart}
    AND ${r}.activity_date < (${monthStart} + interval '1 month'))`;
}

/**
 * 나무 t의 사각지대 상태. 'no_caregiver' | 'inactive' | NULL(돌보미가 있고 이번 달 활동도 있음).
 * 나무 한 그루씩 판정하므로 지도처럼 나무 수가 제한된 조회에 쓴다. 관리청 전체 집계는 district/care-gaps.ts를 쓴다.
 * 예: SELECT t.id, ${careGapSql('t')} AS care_gap FROM trees t ...
 */
export function careGapSql(t: string, monthStart: string = CURRENT_MONTH_START_SQL): string {
  return `(CASE
    WHEN NOT EXISTS (SELECT 1 FROM caregiver_applications cg_a
                     WHERE cg_a.tree_id = ${t}.id AND ${activeCaregiverSql('cg_a', monthStart)})
      THEN 'no_caregiver'
    WHEN NOT EXISTS (SELECT 1 FROM records cg_r
                     WHERE cg_r.tree_id = ${t}.id AND ${activityInMonthSql('cg_r', monthStart)})
      THEN 'inactive'
  END)`;
}
