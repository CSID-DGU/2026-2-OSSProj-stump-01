// #3 회원·인증 (시민·구청 담당자 공통)
// 회원가입·로그인은 여기서 토큰을 발급하고, 보호할 경로는 common/auth.ts 의 authenticate 를 쓴다.
// 비밀번호는 Node 내장 scrypt 로 해시한다(추가 라이브러리 없음). 저장 형식: scrypt$<salt>$<hash>
// 시민 가입은 본인인증(common/identity.ts)을 거친다. 인증된 이름·생년월일·휴대폰은 본인인증을 다시 해야만 바뀌고,
// 주소·별명은 본인이 고친다. 같은 사람(CI)은 계정을 하나만 만든다. 만 14세 미만은 가입할 수 없다.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, signToken } from '../common/auth.js';
import { getPool } from '../common/db.js';
import { conflict, HttpError, notFound } from '../common/errors.js';
import {
  ageOn,
  hashCi,
  identityMode,
  identityProvider,
  issueMockIdentityToken,
  MIN_SIGNUP_AGE,
  seoulToday,
  type VerifiedIdentity,
} from '../common/identity.js';

const scrypt = promisify(scryptCb);

// ── 기준값 ──
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;
const NICKNAME_MAX_LENGTH = 20;
const SCRYPT_KEY_LENGTH = 64;
const NAME_MAX_LENGTH = 50;
const ADDRESS_MAX_LENGTH = 200;

// ── 요청 형식 ──
const nickname = z.string().trim().min(1).max(NICKNAME_MAX_LENGTH); // 활동 이름. 이야기·응답에 보인다
const postalCode = z.string().regex(/^\d{5}$/, '우편번호는 5자리 숫자다.');
const address = z.string().trim().min(1).max(ADDRESS_MAX_LENGTH);
const identityToken = z.string().min(1); // 본인인증이 끝나면 인증 업체(지금은 가짜 인증)가 주는 거래 번호

const signupBody = z.object({
  email: z.email().trim().max(254),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  nickname,
  identityToken,
  postalCode,
  address,
});

const updateMeBody = z
  .object({ nickname: nickname.optional(), postalCode: postalCode.optional(), address: address.optional() })
  .refine((b) => (b.postalCode === undefined) === (b.address === undefined), '우편번호와 주소는 같이 고친다.')
  .refine((b) => Object.values(b).some((v) => v !== undefined), '고칠 값이 없다.');

const reverifyBody = z.object({ identityToken });

// 가짜 인증 창에서 입력하는 값(실제 인증 업체 화면에서 입력하는 것과 같다)
const mockIdentityBody = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  birthDate: z.iso.date(),
  phone: z.string().trim().regex(/^01\d-?\d{3,4}-?\d{4}$/, '휴대폰 번호 형식이어야 한다.'),
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
  identityVerified: boolean; // 본인인증을 했는지. 돌보미 신청은 본인인증한 시민만 한다
  profile: {
    realName: string | null; // 본인인증 결과(본인인증을 다시 해야 바뀜)
    birthDate: string | null;
    phone: string | null;
    postalCode: string | null; // 본인이 고친다
    address: string | null;
  };
};

type UserRow = {
  id: number;
  email: string;
  nickname: string;
  role: 'citizen' | 'officer';
  agency: string | null;
  education_completed_at: Date | null;
  real_name: string | null;
  birth_date: string | null;
  phone: string | null;
  postal_code: string | null;
  address: string | null;
  identity_ci_hash: string | null;
  identity_verified_at: Date | null;
};

const USER_COLUMNS = `id, email, nickname, role, agency, education_completed_at, real_name,
  to_char(birth_date, 'YYYY-MM-DD') AS birth_date, phone, postal_code, address, identity_ci_hash, identity_verified_at`;

// 비밀번호 해시는 절대 응답에 넣지 않는다
function toView(r: UserRow): UserView {
  return {
    id: r.id,
    email: r.email,
    nickname: r.nickname,
    role: r.role,
    agency: r.agency,
    educationCompleted: r.education_completed_at !== null,
    identityVerified: r.identity_verified_at !== null,
    profile: {
      realName: r.real_name,
      birthDate: r.birth_date,
      phone: r.phone,
      postalCode: r.postal_code,
      address: r.address,
    },
  };
}

async function findUser(id: number): Promise<UserRow> {
  const { rows } = await getPool().query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('사용자를 찾을 수 없다.');
  return rows[0];
}

/** 본인인증 결과를 확인한다: 만 14세 이상인지 */
function checkAge(identity: VerifiedIdentity) {
  if (ageOn(identity.birthDate, seoulToday()) < MIN_SIGNUP_AGE) {
    throw new HttpError(403, 'UNDER_AGE', `만 ${MIN_SIGNUP_AGE}세 이상만 가입할 수 있다.`);
  }
}

/** 같은 사람(CI)이 이미 가입했는지. exceptUserId는 본인 계정(다시 인증할 때) */
async function checkIdentityUnused(ciHash: string, exceptUserId: number | null) {
  const { rows } = await getPool().query('SELECT 1 FROM users WHERE identity_ci_hash = $1 AND id IS DISTINCT FROM $2', [ciHash, exceptUserId]);
  if (rows.length > 0) throw new HttpError(409, 'IDENTITY_IN_USE', '이미 이 본인인증으로 가입한 계정이 있다. 한 사람은 계정 하나만 쓴다.');
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

// 개발용 가짜 본인인증 "인증 창": 입력한 이름·생년월일·휴대폰으로 거래 번호를 준다.
// 실제 인증 업체를 연결하면(IDENTITY_PROVIDER) 이 경로는 없어진다(404).
authRouter.post('/identity/mock', async (req, res) => {
  if (identityMode() !== 'mock') throw notFound('없는 경로다.');
  const input = mockIdentityBody.parse(req.body);
  res.json({ identityToken: issueMockIdentityToken(input) });
});

// 회원가입: 본인인증을 거친 시민으로 만든다. 구청 담당자 계정은 관리청과 함께 운영자가 DB 에서 만든다.
authRouter.post('/signup', async (req, res) => {
  const b = signupBody.parse(req.body);
  const identity = await identityProvider().verify(b.identityToken);
  checkAge(identity);
  const ciHash = hashCi(identity.ci);
  const pool = getPool();

  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [b.email]);
  if (exists.rows.length > 0) throw conflict('이미 가입된 이메일이다.');
  await checkIdentityUnused(ciHash, null);

  const passwordHash = await hashPassword(b.password);
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, password_hash, nickname, real_name, birth_date, phone, postal_code, address,
                        identity_ci_hash, identity_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     RETURNING ${USER_COLUMNS}`,
    [b.email, passwordHash, b.nickname, identity.name, identity.birthDate, identity.phone, b.postalCode, b.address, ciHash],
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
  res.json(toView(await findUser(req.user!.id)));
});

// 내 정보 고치기: 별명, 주소(우편번호와 같이). 이름·생년월일·휴대폰은 본인인증을 다시 해야 바뀐다(아래)
authRouter.patch('/me', authenticate, async (req, res) => {
  const b = updateMeBody.parse(req.body);
  await getPool().query(
    `UPDATE users SET nickname = coalesce($2, nickname), postal_code = coalesce($3, postal_code), address = coalesce($4, address)
     WHERE id = $1`,
    [req.user!.id, b.nickname ?? null, b.postalCode ?? null, b.address ?? null],
  );
  res.json(toView(await findUser(req.user!.id)));
});

// 본인인증 다시 하기: 휴대폰 번호가 바뀌었을 때. 가입 때와 같은 사람(CI)이어야 한다.
// 이 기능 전에 만든 계정(본인인증 전)은 여기서 처음 본인인증을 한다.
authRouter.post('/me/identity', authenticate, async (req, res) => {
  if (req.user!.role !== 'citizen') throw new HttpError(403, 'FORBIDDEN', '시민 계정만 본인인증을 한다.');
  const { identityToken: token } = reverifyBody.parse(req.body);
  const identity = await identityProvider().verify(token);
  const ciHash = hashCi(identity.ci);
  const me = await findUser(req.user!.id);
  if (me.identity_ci_hash === null) {
    checkAge(identity);
    await checkIdentityUnused(ciHash, me.id);
  } else if (me.identity_ci_hash !== ciHash) {
    throw new HttpError(403, 'IDENTITY_MISMATCH', '가입할 때 본인인증한 사람과 다르다. 계정은 본인만 쓴다.');
  }
  await getPool().query(
    `UPDATE users SET real_name = $2, birth_date = $3, phone = $4, identity_ci_hash = $5, identity_verified_at = now()
     WHERE id = $1`,
    [me.id, identity.name, identity.birthDate, identity.phone, ciHash],
  );
  res.json(toView(await findUser(me.id)));
});
