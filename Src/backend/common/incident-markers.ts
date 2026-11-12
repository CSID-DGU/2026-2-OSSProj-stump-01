// #21 나이테 신고·조치 표식 데이터
// 나이테는 1년 1겹, 월별 12조각이다(Src/용어.md). 신고·조치 표식은 따로 저장하지 않고
// reports.created_at(신고)과 reports.resolved_at(조치 완료)을 한국 시간 월별로 센다.
// 나이테 집계(시민-BE, GET /trees/{id}/rings)에서 이 함수를 불러 쓴다.
import type { Db } from './db.js';

const TIME_ZONE = 'Asia/Seoul';

export type MonthlyIncidentMarker = {
  month: number; // 1~12
  reported: number; // 그 달에 접수된 신고 수
  resolved: number; // 그 달에 조치 완료된 신고 수
};

/** 한 나무의 한 해 신고·조치 수를 1월부터 12월까지 12개로 돌려준다(없는 달은 0). */
export async function monthlyIncidentMarkers(db: Db, treeId: number, year: number): Promise<MonthlyIncidentMarker[]> {
  const { rows } = await db.query<MonthlyIncidentMarker>(
    `WITH events AS (
       SELECT p.created_at AS reported_at, p.resolved_at
       FROM reports p JOIN records rc ON rc.id = p.record_id
       WHERE rc.tree_id = $1
     )
     SELECT m AS month,
            (SELECT count(*) FROM events
              WHERE extract(year FROM reported_at AT TIME ZONE '${TIME_ZONE}') = $2
                AND extract(month FROM reported_at AT TIME ZONE '${TIME_ZONE}') = m)::int AS reported,
            (SELECT count(*) FROM events
              WHERE resolved_at IS NOT NULL
                AND extract(year FROM resolved_at AT TIME ZONE '${TIME_ZONE}') = $2
                AND extract(month FROM resolved_at AT TIME ZONE '${TIME_ZONE}') = m)::int AS resolved
     FROM generate_series(1, 12) AS m
     ORDER BY m`,
    [treeId, year],
  );
  return rows;
}
