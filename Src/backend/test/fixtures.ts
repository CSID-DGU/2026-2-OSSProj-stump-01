// 테스트용 데이터 만들기. 각 테스트 파일은 beforeEach에서 resetData()로 비우고 필요한 행만 넣는다.
import { signToken } from '../common/auth.js';
import { getPool } from '../common/db.js';

let seq = 0;

/** trees를 포함해 모든 테이블을 비운다(schema_migrations, PostGIS 테이블, 기준 데이터 district_codes 제외). */
export async function resetData(): Promise<void> {
  await getPool().query(`
    DO $$
    DECLARE t text;
    BEGIN
      SELECT string_agg(format('%I', tablename), ', ') INTO t
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'spatial_ref_sys', 'district_codes');
      EXECUTE 'TRUNCATE ' || t || ' RESTART IDENTITY CASCADE';
    END $$;
  `);
}

/**
 * 사용자를 만든다. 시민은 기본으로 본인인증·주소까지 마친 상태다(verified: false면 본인인증 전 계정).
 * 구청 담당자는 본인인증 칸이 비어 있다.
 */
export async function createUser(
  opts: { role?: 'citizen' | 'officer'; agency?: string | null; nickname?: string; verified?: boolean } = {},
) {
  seq += 1;
  const role = opts.role ?? 'citizen';
  const agency = opts.agency ?? (role === 'officer' ? '중구' : null);
  const verified = role === 'citizen' && (opts.verified ?? true);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO users (email, password_hash, nickname, real_name, role, agency,
                        birth_date, phone, postal_code, address, identity_ci_hash, identity_verified_at)
     VALUES ($1, 'x', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      `user${seq}@test.local`,
      opts.nickname ?? `사용자${seq}`,
      `실명${seq}`,
      role,
      agency,
      verified ? '1990-01-01' : null,
      verified ? `010-0000-${String(seq).padStart(4, '0')}` : null,
      verified ? '04538' : null,
      verified ? '서울특별시 중구 명동길 1' : null,
      verified ? `test-ci-${seq}` : null,
      verified ? new Date() : null,
    ],
  );
  const id = rows[0]!.id;
  return { id, token: signToken(id) };
}

export async function createTree(
  opts: { agency?: string; species?: string; code?: string; lng?: number; lat?: number; roadName?: string } = {},
) {
  seq += 1;
  const agency = opts.agency ?? '중구';
  // 위치를 안 주면 경도 126.97 + seq/1e6, 위도 37.56 에 놓는다
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO trees (source_key, species, location, agency, district, dong, road_name, address, code)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($5::float8, $6::float8), 4326)::geography, $3, $3, '명동', $7, '서울특별시 중구 명동 1', $4)
     RETURNING id`,
    [
      `${agency}|test|${seq}`,
      opts.species ?? '은행나무',
      agency,
      opts.code ?? null,
      opts.lng ?? 126.97 + seq / 1e6,
      opts.lat ?? 37.56,
      opts.roadName ?? '명동길',
    ],
  );
  return rows[0]!.id;
}

export async function createApplication(opts: {
  userId: number;
  treeId: number;
  status?: 'pending' | 'approved' | 'rejected' | 'ended';
  reviewedBy?: number;
  createdAt?: string;
  periodStart?: string; // 기본 2026-12-01
  periodEnd?: string; // 기본 2027-11-30
  /** false면 구청 양식(#6) 칸을 비운다(양식을 넣기 전에 낸 신청서) */
  withForm?: boolean;
}) {
  const status = opts.status ?? 'pending';
  const reviewed = status === 'approved' || status === 'rejected';
  const withForm = opts.withForm ?? true;
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO caregiver_applications
       (user_id, tree_id, status, period_start, period_end, motivation, reject_reason, reviewed_by, reviewed_at, created_at,
        applicant_name, contact_person, headcount, postal_code, address, phone, participation_type, activity_plan, organization_intro, agreed_at)
     VALUES ($1, $2, $3, $16, $17, '집 앞 나무를 돌보고 싶어요', $4, $5, $6, COALESCE($7::timestamptz, now()),
             $8, NULL, $9, $10, $11, $12, $13, $14, NULL, $15)
     RETURNING id`,
    [
      opts.userId,
      opts.treeId,
      status,
      status === 'rejected' ? '테스트 반려' : null,
      reviewed ? (opts.reviewedBy ?? null) : null,
      reviewed ? new Date() : null,
      opts.createdAt ?? null,
      withForm ? '김은행' : null,
      withForm ? 1 : null,
      withForm ? '04536' : null,
      withForm ? '서울특별시 중구 명동 2' : null,
      withForm ? '010-1234-5678' : null,
      withForm ? 'individual' : null,
      withForm ? '주 1회 물 주기와 주변 정리' : null,
      withForm ? new Date('2026-11-20T00:00:00Z') : null,
      opts.periodStart ?? '2026-12-01',
      opts.periodEnd ?? '2027-11-30',
    ],
  );
  return rows[0]!.id;
}

/** 활동 기록 하나를 만든다(records.type = 'activity') */
export async function createActivity(opts: {
  userId: number;
  treeId: number;
  date: string;
  minutes?: number;
  verification?: 'none' | 'location' | 'photo'; // 기본 'none' (DB 기본값)
  recordedAt?: string; // 기록한 시각. 기본 지금
}) {
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO records (tree_id, user_id, type, activity_date, duration_min, verification, recorded_at)
     VALUES ($1, $2, 'activity', $3, $4, COALESCE($5, 'none'), COALESCE($6::timestamptz, now())) RETURNING id`,
    [opts.treeId, opts.userId, opts.date, opts.minutes ?? 30, opts.verification ?? null, opts.recordedAt ?? null],
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

export async function createRentalItem(opts: { agency?: string; name?: string; stock?: number } = {}) {
  seq += 1;
  const { rows } = await getPool().query<{ id: number }>(
    'INSERT INTO rental_items (agency, name, stock) VALUES ($1, $2, $3) RETURNING id',
    [opts.agency ?? '중구', opts.name ?? `물품${seq}`, opts.stock ?? 10],
  );
  return rows[0]!.id;
}

/** 승인 대기(requested) 물품 신청을 만든다(시민-BE가 하는 일을 흉내 낸다). */
export async function createRental(opts: { itemId: number; userId: number; quantity?: number; createdAt?: string }) {
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO rentals (item_id, user_id, quantity, created_at)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now())) RETURNING id`,
    [opts.itemId, opts.userId, opts.quantity ?? 1, opts.createdAt ?? null],
  );
  return rows[0]!.id;
}

/** 나무의 이야기에 글 하나를 넣는다(시민-BE 이야기 쓰기를 흉내 낸다). 이야기 묶음이 없으면 같이 만든다. */
export async function createStoryEntry(opts: { treeId: number; userId: number; isPublic?: boolean; createdAt?: string; body?: string }) {
  const pool = getPool();
  await pool.query('INSERT INTO stories (tree_id) VALUES ($1) ON CONFLICT (tree_id) DO NOTHING', [opts.treeId]);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO story_entries (story_id, user_id, body, is_public, created_at)
     SELECT id, $2, $3, $4, COALESCE($5::timestamptz, now()) FROM stories WHERE tree_id = $1
     RETURNING id`,
    [opts.treeId, opts.userId, opts.body ?? '나무 이야기', opts.isPublic ?? true, opts.createdAt ?? null],
  );
  return rows[0]!.id;
}

/** 이상 신고(records type=report + reports)를 만든다(시민-BE가 하는 일을 흉내 낸다). */
export async function createIncident(opts: {
  userId: number;
  treeId: number;
  agency?: string;
  category?: string;
  urgency?: 'low' | 'high';
  createdAt?: string;
}) {
  const pool = getPool();
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO records (tree_id, user_id, type, photo_url, location, recorded_at)
     VALUES ($1, $2, 'report', 'https://example.com/report.jpg',
             ST_SetSRID(ST_MakePoint(126.9701, 37.5601), 4326)::geography, $3)
     RETURNING id`,
    [opts.treeId, opts.userId, createdAt],
  );
  const { rows: rep } = await pool.query<{ id: number }>(
    `INSERT INTO reports (record_id, category, urgency, agency, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [rows[0]!.id, opts.category ?? 'pest', opts.urgency ?? 'low', opts.agency ?? '중구', createdAt],
  );
  return rep[0]!.id;
}
