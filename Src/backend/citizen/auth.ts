// #3 회원·인증 (시민·구청 담당자 공통)
// 회원가입·로그인은 여기서 토큰을 발급하고, 보호할 경로는 common/auth.ts 의 authenticate 를 쓴다.
// 비밀번호는 Node 내장 scrypt 로 해시한다(추가 라이브러리 없음). 저장 형식: scrypt$<salt>$<hash>
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, signToken } from '../common/auth.js';
import { getPool } from '../common/db.js';
import { conflict, HttpError, notFound } from '../common/errors.js';

const scrypt = promisify(scryptCb);

// ── 기준값 ──
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;
const NICKNAME_MAX_LENGTH = 20;
const SCRYPT_KEY_LENGTH = 64;

// ── 요청 형식 ──
const signupBody = z.object({
  email: z.email().trim().max(254),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  nickname: z.string().trim().min(1).max(NICKNAME_MAX_LENGTH), // 활동 이름. 이야기·응답에 보인다
});

const loginBody = z.object({
  email: z.email().trim(),
  password: z.string().min(1),
});

// ── 응답 형식 ──
export type UserView = {
  id: number;
  email: string;
  nickname: string;
  role: 'citizen' | 'officer';
  agency: string | null; // 구청 담당자의 소속 관리청
  educationCompleted: boolean; // 돌보미 교육 이수 여부(#10)
};

type UserRow = {
  id: number;
  email: string;
  nickname: string;
  role: 'citizen' | 'officer';
  agency: string | null;
  education_completed_at: Date | null;
};

const USER_COLUMNS = 'id, email, nickname, role, agency, education_completed_at';

// 비밀번호 해시는 절대 응답에 넣지 않는다
function toView(r: UserRow): UserView {
  return {
    id: r.id,
    email: r.email,
    nickname: r.nickname,
    role: r.role,
    agency: r.agency,
    educationCompleted: r.education_completed_at !== null,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hashHex) return false;
  const hash = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// ── 라우터 (/auth) ──
export const authRouter = Router();

// 회원가입: 시민으로 만든다. 구청 담당자 계정은 관리청과 함께 운영자가 DB 에서 만든다.
authRouter.post('/signup', async (req, res) => {
  const { email, password, nickname } = signupBody.parse(req.body);
  const pool = getPool();

  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rows.length > 0) throw conflict('이미 가입된 이메일이다.');

  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, password_hash, nickname) VALUES ($1, $2, $3)
     RETURNING ${USER_COLUMNS}`,
    [email, passwordHash, nickname],
  );
  const user = toView(rows[0]!);
  res.status(201).json({ token: signToken(user.id), user });
});

// 로그인: 이메일이 없는 경우와 비밀번호가 틀린 경우를 구분해 알려 주지 않는다
authRouter.post('/login', async (req, res) => {
  const { email, password } = loginBody.parse(req.body);
  const { rows } = await getPool().query<UserRow & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
    [email],
  );
  const row = rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new HttpError(401, 'UNAUTHORIZED', '이메일 또는 비밀번호가 맞지 않다.');
  }
  res.json({ token: signToken(row.id), user: toView(row) });
});

// 내 정보
authRouter.get('/me', authenticate, async (req, res) => {
  const { rows } = await getPool().query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.user!.id]);
  if (!rows[0]) throw notFound('사용자를 찾을 수 없다.');
  res.json(toView(rows[0]));
});
