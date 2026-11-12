import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Src/.env의 DB 접속 정보를 읽고, DB 이름만 테스트용으로 바꾼다.
// 테스트는 개발 DB(가로수 적재본)를 건드리지 않고 매번 새로 만든 treecare_test DB에서 돈다.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const devDb = process.env.POSTGRES_DB;
process.env.POSTGRES_DB = process.env.TEST_POSTGRES_DB ?? 'treecare_test';
if (process.env.POSTGRES_DB === devDb) {
  throw new Error('테스트 DB 이름이 개발 DB와 같다. 테스트가 DB를 지우고 다시 만들므로 다른 이름을 쓴다.');
}
process.env.JWT_SECRET ??= 'test-secret';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'data'],
    fileParallelism: false, // 테스트 파일들이 DB 하나를 같이 쓰므로 하나씩 돌린다
  },
});
