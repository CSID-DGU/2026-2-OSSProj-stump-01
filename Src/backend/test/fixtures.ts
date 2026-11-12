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
