// DB 연결. ORM 없이 SQL을 직접 쓴다(스키마는 db/migrations의 SQL 파일이 기준).
import pg from 'pg';
import { databaseUrl } from './config.js';

// pg는 bigint·numeric을 문자열로 돌려준다. id는 2^53보다 작으므로 숫자로 바꾼다.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
// date는 Date 객체로 바꾸면 시간대 때문에 하루가 밀릴 수 있어 'YYYY-MM-DD' 문자열 그대로 둔다.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: databaseUrl() });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export type Db = pg.Pool | pg.PoolClient;

/**
 * fn 안의 쿼리를 한 트랜잭션으로 묶는다. fn이 에러를 던지면 전부 되돌린다.
 * 예: 보고서 승인 + 봉사시간 기록 + 알림 생성(CLAUDE.md 경계 규칙)
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
