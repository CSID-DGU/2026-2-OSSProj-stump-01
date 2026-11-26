// #12 디지털 나이테 월별 집계: 화면·API와 분리된 순수 함수
// 나이테는 1년 1겹, 월별 12조각이다(Src/용어.md). 이 함수는 출처별로 따로 센 월별 값을 12조각에 모으기만 하고,
// 두께·색 계산(비와 돌봄의 비율, 더위 단계)은 시민 웹(frontend/citizen/src/lib/rings.ts)이 한다.
// 두께 산정 방식은 보고서 양식이 확정된 뒤 정하기로 해서(#12), 서버는 원래 값(분·횟수·mm)을 그대로 준다.
import type { MonthlyIncidentMarker } from '../common/incident-markers.js';

export type RingMonth = {
  month: number; // 1~12
  rainMm: number | null; // 그 달 강수량 합계(mm). 기상 자료가 없는 달(아직 안 온 달 등)은 null
  tempMaxAvg: number | null; // 그 달 평균 최고기온(℃, 소수 첫째 자리). 자료가 없으면 null
  heatDays: number; // 폭염(일 최고기온 33℃ 이상)인 날 수
  careMinutes: number; // 구청이 승인한 보고서에 든 활동 시간 합계(분). 그 나무의 모든 돌보미 것
  careCount: number; // 위 활동 기록 수
  activityDays: number[]; // 활동 기록이 있는 날(승인 여부 상관없음). 오름차순, 같은 날은 한 번
  stories: { id: number; day: number }[]; // 공개 이야기 글(별). 누르면 /story-entries/{id}
  reported: number; // 그 달 접수된 신고 수
  resolved: number; // 그 달 조치 완료된 신고 수
  reactions: number; // 그 달 받은 호응(좋아요·한 줄 응답, #65) 수. 남긴 날(한국 날짜) 기준
};

/** 출처별 월별 값. 없는 달은 빠져 있어도 된다 */
export type RingSources = {
  weather: { month: number; rainMm: number; tempMaxAvg: number | null; heatDays: number }[];
  care: { month: number; minutes: number; count: number }[];
  activityDays: { month: number; day: number }[];
  stories: { id: number; month: number; day: number }[];
  incidents: MonthlyIncidentMarker[];
  reactions: { month: number; count: number }[];
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** 출처별 월별 값을 1월~12월 12조각으로 모은다 */
export function buildRingMonths(s: RingSources): RingMonth[] {
  return MONTHS.map((month) => {
    const weather = s.weather.find((w) => w.month === month);
    const care = s.care.find((c) => c.month === month);
    const incident = s.incidents.find((i) => i.month === month);
    return {
      month,
      rainMm: weather?.rainMm ?? null,
      tempMaxAvg: weather?.tempMaxAvg ?? null,
      heatDays: weather?.heatDays ?? 0,
      careMinutes: care?.minutes ?? 0,
      careCount: care?.count ?? 0,
      activityDays: [...new Set(s.activityDays.filter((d) => d.month === month).map((d) => d.day))].sort((a, b) => a - b),
      stories: s.stories.filter((st) => st.month === month).map((st) => ({ id: st.id, day: st.day })),
      reported: incident?.reported ?? 0,
      resolved: incident?.resolved ?? 0,
      reactions: s.reactions.find((r) => r.month === month)?.count ?? 0,
    };
  });
}
