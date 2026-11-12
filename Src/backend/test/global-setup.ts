// 테스트 시작 전에 한 번: 테스트 DB를 지우고 다시 만든 뒤 db/migrations의 up 부분을 순서대로 적용한다.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));

function connectionString(db: string): string {
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST = 'localhost', POSTGRES_PORT = '5432' } = process.env;
  return `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${db}`;
}

/** dbmate 파일에서 "-- migrate:up"과 "-- migrate:down" 사이만 꺼낸다. */
function upSection(sql: string): string {
  const start = sql.indexOf('-- migrate:up');
  const end = sql.indexOf('-- migrate:down');
  return sql.slice(start, end === -1 ? undefined : end);
}

export default async function setup() {
  const testDb = process.env.POSTGRES_DB!;

  const admin = new pg.Client({ connectionString: connectionString('postgres') });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(`테스트 DB 서버에 접속하지 못했다. Src에서 \`docker compose up -d\`로 DB를 켠다.\n${err}`);
  }
  await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(testDb)} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(testDb)}`);
  await admin.end();

  const client = new pg.Client({ connectionString: connectionString(testDb) });
  await client.connect();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await client.query(upSection(readFileSync(join(MIGRATIONS_DIR, file), 'utf8')));
  }
  await client.end();
}
