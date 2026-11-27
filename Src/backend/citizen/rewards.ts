// #15 참여 보상: 스탬프·배지, 내 활동 통계, 활동 순위·공식 순위·이달의 MVP. 화면·API와 분리한 집계 함수다(CLAUDE.md).
// 규칙(Src/용어.md "고마워요 반응·스탬프·배지", "활동 순위 / 공식 순위"):
// - 스탬프 = 활동 기록 수. 5·10회에 '우리 동네 나무돌보미' 배지(user_badges)를 준다.
// - 활동 순위: 이번 달(한국 시간) 인정 활동 횟수 → 같으면 돌본 나무 수. 인정 활동은
//   현장 확인된 기록(위치 확인 또는 사진, #13)만, 같은 나무는 하루 1회, 폭염 날 낮(11~17시)에 남긴 기록은 뺀다.
// - 공식 순위: 구청이 승인해 기록한 봉사시간(volunteer_hours) 누적. 이달의 MVP: 이번 달 기록된 봉사시간 1위.
// - 순위에는 별명(nickname)만 보인다. 본인이 끄면(users.ranking_hidden) 목록에서 빠지고, 상위 10위 밖 순위는 본인에게도 숫자로 알려 주지 않는다.
import type { Db } from '../common/db.js';
import { HEAT_AVOID_FROM, HEAT_AVOID_UNTIL } from '../district/weather-logic.js';
import { WEATHER_REGION } from '../district/weather-daily.js';

// ── 기준값 (배지 이름·횟수는 구청 확인 전 임시값, #59) ──
export const BADGES = [
  { code: 'caregiver_5', name: '우리 동네 나무돌보미', stamps: 5 },
  { code: 'caregiver_10', name: '우리 동네 나무돌보미 · 10회', stamps: 10 },
] as const;
export const THANKS_MESSAGE = '고마워요! 오늘의 돌봄이 나무 기록에 남았어요.'; // 기록 저장 직후 나무의 고마워요 반응
export const RANKING_SIZE = 10; // 순위는 상위 10명까지만 공개한다
const TIME_ZONE = 'Asia/Seoul';
const CREDITED_VERIFICATIONS = ['location', 'photo']; // 현장 확인된 기록 (#13). 'none'(확인 전 기록)은 순위에 넣지 않는다

export type BadgeView = { code: string; name: string; stamps: number };

/** 이번 달 'YYYY-MM' (한국 시간) */
export function seoulMonth(now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE }).slice(0, 7);
}

/** 스탬프 수에 따라 받아야 할 배지 */
export function badgesFor(stamps: number): BadgeView[] {
  return BADGES.filter((b) => stamps >= b.stamps).map((b) => ({ ...b }));
}

/**
 * 활동 기록을 남긴 뒤 부른다. 스탬프 수를 세고, 새로 닿은 배지를 user_badges 에 넣는다.
 * 기록과 같은 트랜잭션의 db 를 넘긴다. 이미 받은 배지는 다시 넣지 않는다(유니크 제약).
 */
export async function awardStamps(db: Db, userId: number): Promise<{ stamps: number; newBadges: BadgeView[] }> {
  const { rows } = await db.query<{ stamps: number }>(
    `SELECT count(*)::int AS stamps FROM records WHERE user_id = $1 AND type = 'activity'`,
    [userId],
  );
  const stamps = rows[0]!.stamps;
  const newBadges: BadgeView[] = [];
  for (const badge of badgesFor(stamps)) {
    const { rowCount } = await db.query(
      `INSERT INTO user_badges (user_id, badge_code) VALUES ($1, $2) ON CONFLICT (user_id, badge_code) DO NOTHING`,
      [userId, badge.code],
    );
    if (rowCount) newBadges.push(badge);
  }
  return { stamps, newBadges };
}

export type MyStats = { treeCount: number; activityCount: number; totalMinutes: number; stamps: number; rankingVisible: boolean };

/** 내 활동 통계 (돌본 나무 수·누적 활동·스탬프). 본인 것이라 인정 여부와 상관없이 모든 활동 기록을 센다 */
export async function myStats(db: Db, userId: number): Promise<MyStats> {
  const { rows } = await db.query<{ tree_count: number; activity_count: number; total_minutes: number; ranking_hidden: boolean }>(
    `SELECT count(DISTINCT r.tree_id)::int AS tree_count, count(r.id)::int AS activity_count,
            coalesce(sum(r.duration_min), 0)::int AS total_minutes, u.ranking_hidden
     FROM users u LEFT JOIN records r ON r.user_id = u.id AND r.type = 'activity'
     WHERE u.id = $1 GROUP BY u.id`,
    [userId],
  );
  const r = rows[0]!;
  return {
    treeCount: r.tree_count,
    activityCount: r.activity_count,
    totalMinutes: r.total_minutes,
    stamps: r.activity_count,
    rankingVisible: !r.ranking_hidden,
  };
}

export type MyBadgeView = BadgeView & { earned: boolean; earnedAt: string | null };

/** 모든 배지와 내가 받았는지 */
export async function myBadges(db: Db, userId: number): Promise<MyBadgeView[]> {
  const { rows } = await db.query<{ badge_code: string; earned_at: Date }>(
    'SELECT badge_code, earned_at FROM user_badges WHERE user_id = $1',
    [userId],
  );
  const earnedAt = new Map(rows.map((r) => [r.badge_code, r.earned_at]));
  return BADGES.map((b) => ({ ...b, earned: earnedAt.has(b.code), earnedAt: earnedAt.get(b.code)?.toISOString() ?? null }));
}

// ── 순위 ──
// 점수를 시민 모두에 대해 계산하고, 순위(rank)는 순위를 켠 사람끼리만 매긴다. 같은 점수는 같은 순위다.
type RankedRow<T> = T & { user_id: number; nickname: string; ranking_hidden: boolean; rank: number | null };

export type RankEntry<T> = T & { rank: number; nickname: string; isMe: boolean };
export type Ranking<T> = {
  top: RankEntry<T>[]; // 순위 상위 RANKING_SIZE 위까지 (같은 순위가 있으면 10명을 넘을 수 있다)
  me: T & { visible: boolean; rank: number | null }; // rank: 10위 안일 때만. 순위를 껐거나 10위 밖이면 null
};

/** DB 행(R)을 화면용 점수(T)로 바꿔 상위 목록과 내 순위를 만든다 */
function toRanking<R extends object, T extends object>(
  rows: RankedRow<R>[],
  userId: number,
  scoreOf: (r: R) => T,
  zero: T,
): Ranking<T> {
  const top = rows
    .filter((r) => r.rank !== null && r.rank <= RANKING_SIZE)
    .map((r) => ({ ...scoreOf(r), rank: r.rank!, nickname: r.nickname, isMe: r.user_id === userId }));
  const mine = rows.find((r) => r.user_id === userId);
  const rank = mine?.rank != null && mine.rank <= RANKING_SIZE ? mine.rank : null;
  return { top, me: { ...(mine ? scoreOf(mine) : zero), visible: !(mine?.ranking_hidden ?? false), rank } };
}

/** 순위 SELECT 의 뒷부분: scores(user_id, 점수...) 를 받아 순위를 켠 시민끼리 순위를 매긴다 */
const rankSql = (order: string) => `
  SELECT s.*, u.nickname, u.ranking_hidden,
         CASE WHEN u.ranking_hidden THEN NULL
              ELSE rank() OVER (PARTITION BY u.ranking_hidden ORDER BY ${order})::int END AS rank
  FROM scores s JOIN users u ON u.id = s.user_id
  WHERE u.role = 'citizen'
  ORDER BY rank NULLS LAST, s.user_id`;

export type ActivityScore = { activityCount: number; treeCount: number };

/** 활동 순위 (month 'YYYY-MM', 한국 시간 활동일 기준) */
export async function activityRanking(db: Db, month: string, userId: number): Promise<Ranking<ActivityScore>> {
  const { rows } = await db.query<RankedRow<{ activity_count: number; tree_count: number }>>(
    `WITH credited AS (
       -- 같은 나무 하루 1회: (사람, 나무, 날)을 한 번만 센다. 폭염 날 낮 기록은 먼저 뺀다
       SELECT DISTINCT r.user_id, r.tree_id, r.activity_date
       FROM records r
       LEFT JOIN weather w ON w.date = r.activity_date AND w.region = $2
       WHERE r.type = 'activity'
         AND r.verification = ANY($3::text[])
         AND to_char(r.activity_date, 'YYYY-MM') = $1
         AND NOT (coalesce(w.is_heatwave, false)
                  AND extract(hour FROM r.recorded_at AT TIME ZONE '${TIME_ZONE}') >= $4
                  AND extract(hour FROM r.recorded_at AT TIME ZONE '${TIME_ZONE}') < $5)
     ), scores AS (
       SELECT user_id, count(*)::int AS activity_count, count(DISTINCT tree_id)::int AS tree_count
       FROM credited GROUP BY user_id
     )
     ${rankSql('s.activity_count DESC, s.tree_count DESC')}`,
    [month, WEATHER_REGION, CREDITED_VERIFICATIONS, HEAT_AVOID_FROM, HEAT_AVOID_UNTIL],
  );
  return toRanking(rows, userId, (r) => ({ activityCount: r.activity_count, treeCount: r.tree_count }), { activityCount: 0, treeCount: 0 });
}

export type MinutesScore = { minutes: number };

/** 공식 순위: 승인된 봉사시간 누적 */
export async function officialRanking(db: Db, userId: number): Promise<Ranking<MinutesScore>> {
  const { rows } = await db.query<RankedRow<{ minutes: number }>>(
    `WITH scores AS (SELECT user_id, sum(minutes)::int AS minutes FROM volunteer_hours GROUP BY user_id)
     ${rankSql('s.minutes DESC')}`,
  );
  return toRanking(rows, userId, (r) => ({ minutes: r.minutes }), { minutes: 0 });
}

/** 이달의 MVP: 이번 달(한국 시간) 기록된 봉사시간이 가장 많은 사람. 같으면 여럿, 없으면 빈 배열 */
export async function monthlyMvp(db: Db, month: string, userId: number): Promise<(MinutesScore & { nickname: string; isMe: boolean })[]> {
  const { rows } = await db.query<RankedRow<{ minutes: number }>>(
    `WITH scores AS (
       SELECT user_id, sum(minutes)::int AS minutes FROM volunteer_hours
       WHERE to_char(recorded_at AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM') = $1 GROUP BY user_id
     )
     ${rankSql('s.minutes DESC')}`,
    [month],
  );
  return rows.filter((r) => r.rank === 1).map((r) => ({ minutes: r.minutes, nickname: r.nickname, isMe: r.user_id === userId }));
}
