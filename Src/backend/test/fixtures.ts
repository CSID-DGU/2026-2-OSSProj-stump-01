// 테스트용 데이터 만들기. 각 테스트 파일은 beforeEach에서 resetData()로 비우고 필요한 행만 넣는다.
import { signToken } from '../common/auth.js';
import { getPool } from '../common/db.js';

let seq = 0;

/** trees를 포함해 모든 테이블을 비운다(schema_migrations, PostGIS 테이블 제외). */
export async function resetData(): Promise<void> {
  await getPool().query(`
    DO $$
    DECLARE t text;
    BEGIN
      SELECT string_agg(format('%I', tablename), ', ') INTO t
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'spatial_ref_sys');
      EXECUTE 'TRUNCATE ' || t || ' RESTART IDENTITY CASCADE';
    END $$;
  `);
}

export async function createUser(opts: { role?: 'citizen' | 'officer'; agency?: string | null; nickname?: string } = {}) {
  seq += 1;
  const role = opts.role ?? 'citizen';
  const agency = opts.agency ?? (role === 'officer' ? '중구' : null);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO users (email, password_hash, nickname, real_name, role, agency)
     VALUES ($1, 'x', $2, $3, $4, $5) RETURNING id`,
    [`user${seq}@test.local`, opts.nickname ?? `사용자${seq}`, `실명${seq}`, role, agency],
  );
  const id = rows[0]!.id;
  return { id, token: signToken(id) };
}

export async function createTree(opts: { agency?: string; species?: string } = {}) {
  seq += 1;
  const agency = opts.agency ?? '중구';
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO trees (source_key, species, location, agency, district, dong, road_name, address)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint(126.97 + $3::float8 / 1e6, 37.56), 4326)::geography, $4, $4, '명동', '명동길', '서울특별시 중구 명동 1')
     RETURNING id`,
    [`${agency}|test|${seq}`, opts.species ?? '은행나무', seq, agency],
  );
  return rows[0]!.id;
}

export async function createApplication(opts: {
  userId: number;
  treeId: number;
  status?: 'pending' | 'approved' | 'rejected' | 'ended';
  reviewedBy?: number;
  createdAt?: string;
}) {
  const status = opts.status ?? 'pending';
  const reviewed = status === 'approved' || status === 'rejected';
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO caregiver_applications
       (user_id, tree_id, status, period_start, period_end, motivation, reject_reason, reviewed_by, reviewed_at, created_at)
     VALUES ($1, $2, $3, '2026-12-01', '2027-11-30', '집 앞 나무를 돌보고 싶어요', $4, $5, $6, COALESCE($7::timestamptz, now()))
     RETURNING id`,
    [
      opts.userId,
      opts.treeId,
      status,
      status === 'rejected' ? '테스트 반려' : null,
      reviewed ? (opts.reviewedBy ?? null) : null,
      reviewed ? new Date() : null,
      opts.createdAt ?? null,
    ],
  );
  return rows[0]!.id;
}

/**
 * 제출된 월간 보고서를 만든다. dates마다 활동 기록 하나를 만들어 보고서에 묶는다.
 * total_minutes는 기록 시간의 합계다(시민-BE가 제출할 때 하는 일을 흉내 낸다).
 */
export async function createMonthlyReport(opts: {
  userId: number;
  treeId: number;
  agency?: string;
  dates: string[];
  minutesEach?: number;
  submittedAt?: string;
}) {
  const minutesEach = opts.minutesEach ?? 30;
  const pool = getPool();
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO monthly_reports (user_id, agency, total_minutes, submitted_at)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now())) RETURNING id`,
    [opts.userId, opts.agency ?? '중구', minutesEach * opts.dates.length, opts.submittedAt ?? null],
  );
  const reportId = rows[0]!.id;
  for (const date of opts.dates) {
    await pool.query(
      `INSERT INTO records (tree_id, user_id, type, activity_date, activity_kind, duration_min, memo, monthly_report_id)
       VALUES ($1, $2, 'activity', $3, '주변 청소', $4, '쓰레기 주움', $5)`,
      [opts.treeId, opts.userId, date, minutesEach, reportId],
    );
  }
  return reportId;
}
