// 활동 기간이 끝난 신청서 종료 처리 (구청)
// 승인된 신청서는 활동 기간이 끝난 다음 날(한국 시간) 'ended'로 바꾼다.
// - 같은 사람·같은 나무의 대기·승인 신청은 하나만 둘 수 있어(부분 유니크 인덱스), 종료해야 다시 신청할 수 있다(ERD).
// - 나무의 돌보미 수, 조치 완료 알림 대상에서 기간이 끝난 돌보미가 빠진다.
// 지난 달 집계는 'ended'도 그 달의 돌보미로 센다(common/care-gaps.ts activeCaregiverSql).
import type { Db } from '../common/db.js';
import { getPool } from '../common/db.js';

// ── 기준값 ──
const TIME_ZONE = 'Asia/Seoul'; // "오늘"은 한국 시간 달력 기준
export const END_JOB_INTERVAL_MS = 60 * 60 * 1000; // 한 시간마다 확인한다(자정이 지나면 늦어도 한 시간 안에 종료)

/** 지금 한국 시간 기준 'YYYY-MM-DD' */
export function seoulToday(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });
}

/**
 * 활동 기간(period_end)이 today보다 앞인 승인 신청서를 'ended'로 바꾸고, 바꾼 신청서 id를 돌려준다.
 * 여러 번 불러도 결과가 같다(이미 ended면 건드리지 않음).
 */
export async function endExpiredApplications(db: Db, today: string = seoulToday()): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `UPDATE caregiver_applications SET status = 'ended'
     WHERE status = 'approved' AND period_end < $1::date
     RETURNING id`,
    [today],
  );
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

/**
 * API 서버가 켜질 때 한 번, 그 뒤 intervalMs마다 종료 처리를 한다. 멈추는 함수를 돌려준다.
 * 서버가 하나라(CLAUDE.md) 따로 스케줄러를 두지 않고 서버 안에서 돈다. 실패해도 서버는 계속 돈다.
 */
export function startApplicationEndJob(intervalMs: number = END_JOB_INTERVAL_MS, log: (msg: string) => void = console.log): () => void {
  const run = async () => {
    try {
      const ended = await endExpiredApplications(getPool());
      if (ended.length > 0) log(`[신청서 종료] 활동 기간이 끝난 신청서 ${ended.length}건을 종료했다.`);
    } catch (err) {
      log(`[신청서 종료] 실패: ${(err as Error).message}`);
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref(); // 이 타이머 때문에 프로세스가 끝나지 않는 일이 없게
  return () => clearInterval(timer);
}
