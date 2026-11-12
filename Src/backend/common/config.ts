// 환경변수(Src/.env)를 한곳에서 읽는다. 필요한 변수 이름은 Src/.env.example에 있다.
// 실행 스크립트(npm run dev/start)가 node --env-file=../.env로 .env를 읽어 둔다.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name}가 비어 있다. Src/.env에 넣는다(Src/.env.example 참고).`);
  }
  return value;
}

export function databaseUrl(): string {
  const user = required('POSTGRES_USER');
  const password = required('POSTGRES_PASSWORD');
  const db = required('POSTGRES_DB');
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const port = process.env.POSTGRES_PORT ?? '5432';
  return `postgresql://${user}:${password}@${host}:${port}/${db}`;
}

export function jwtSecret(): string {
  return required('JWT_SECRET');
}

export function port(): number {
  return Number(process.env.PORT ?? 4000);
}
