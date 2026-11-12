// 알림 생성 함수.
// 알림 모듈은 시민-BE 담당이다(#7). 구청-BE는 이 함수를 호출만 한다(CLAUDE.md 경계 규칙).
// #7이 만들어지기 전까지 쓰는 최소 구현이다. #7에서 이 파일을 넘겨받아 고쳐도 호출하는 쪽 인터페이스는 유지한다.
import type { Db } from './db.js';

export type NotificationType =
  | 'application_result' // 돌보미 신청 승인·반려
  | 'monthly_report_result' // 월간 보고서 승인·보완 요청
  | 'rental_result' // 물품 승인·반려
  | 'report_resolved' // 이상 신고 조치 완료
  | 'story_reaction'; // 받은 호응

export type NewNotification = {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  treeId?: number | null;
  reportId?: number | null; // report_resolved일 때 필수
};

/**
 * 알림 한 건을 만든다. 상태 변경과 같은 트랜잭션에서 부르도록 db(트랜잭션 client)를 받는다.
 * 그래야 상태 변경이 취소되면 알림도 같이 취소된다.
 */
export async function createNotification(db: Db, n: NewNotification): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO notifications (user_id, type, tree_id, report_id, title, body)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [n.userId, n.type, n.treeId ?? null, n.reportId ?? null, n.title, n.body],
  );
  return rows[0]!.id;
}
