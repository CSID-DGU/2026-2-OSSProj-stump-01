// 인증 미들웨어. 토큰 발급(회원가입·로그인)은 시민-BE(회원·인증)가 signToken을 써서 만든다.
// 토큰에는 사용자 id만 담고, 역할·관리청은 요청마다 DB에서 읽는다. 담당자의 관리청이 바뀌어도 바로 반영된다.
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { jwtSecret } from './config.js';
import { getPool } from './db.js';
import { HttpError } from './errors.js';

const TOKEN_EXPIRES_IN = '7d';

export type AuthUser = {
  id: number;
  role: 'citizen' | 'officer';
  agency: string | null; // 구청 담당자의 소속 관리청
};

/** 구청 전용 경로에서 쓰는 사용자. agency가 항상 있다(users_officer_has_agency 제약). */
export type Officer = AuthUser & { role: 'officer'; agency: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: number): string {
  return jwt.sign({}, jwtSecret(), { subject: String(userId), expiresIn: TOKEN_EXPIRES_IN });
}

const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', '로그인이 필요하다.');

/** Authorization: Bearer <토큰>을 확인해 req.user를 채운다. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  let userId: number;
  try {
    const payload = jwt.verify(token, jwtSecret());
    userId = Number(typeof payload === 'object' ? payload.sub : NaN);
  } catch {
    throw unauthorized();
  }
  if (!Number.isInteger(userId)) throw unauthorized();

  const { rows } = await getPool().query<AuthUser>('SELECT id, role, agency FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw unauthorized();
  req.user = rows[0];
  next();
};

/** 구청 담당자만 통과시킨다. authenticate 뒤에 둔다. */
export const requireOfficer: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'officer' || !req.user.agency) {
    throw new HttpError(403, 'FORBIDDEN', '구청 담당자만 쓸 수 있다.');
  }
  next();
};

/** requireOfficer를 통과한 요청에서 담당자 정보를 꺼낸다. */
export function officerOf(req: Express.Request): Officer {
  const user = req.user;
  if (user?.role !== 'officer' || !user.agency) {
    throw new HttpError(403, 'FORBIDDEN', '구청 담당자만 쓸 수 있다.');
  }
  return user as Officer;
}
