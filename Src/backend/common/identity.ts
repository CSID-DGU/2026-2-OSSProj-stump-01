// 본인인증 (가입·휴대폰 번호 변경)
// 봉사시간이 실제 사람에게 연결돼야 해서 가입 때 본인인증을 한다. 주민등록번호는 받지 않는다.
//
// 실제 휴대폰 본인인증(PASS 등)은 인증 업체(NICE·KCB·다날 등)와 사업자 계약이 있어야 쓸 수 있다.
// 그래서 인증 업체를 바꿔 끼울 수 있게 IdentityProvider 하나로 감싸고, 지금은 개발용 가짜 인증(mock)을 쓴다.
//   흐름: 화면이 인증 창을 띄움 → 인증이 끝나면 인증 업체가 거래 번호(identityToken)를 줌
//        → 서버가 그 번호로 인증 결과(이름·생년월일·휴대폰·CI)를 조회(verify)
//   가짜 인증은 POST /auth/identity/mock 이 "인증 창" 역할을 하고, 결과를 서명한 토큰을 거래 번호로 준다.
// 실서비스에서는 IDENTITY_PROVIDER에 업체 이름을 넣고 그 업체의 verify를 구현한다.
import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { jwtSecret } from './config.js';
import { HttpError } from './errors.js';

// ── 기준값 ──
export const MIN_SIGNUP_AGE = 14; // 만 14세 미만은 법정대리인 동의가 필요해(개인정보보호법 제22조의2) 가입을 막는다
const MOCK_TOKEN_EXPIRES_IN = '10m'; // 인증 창을 닫고 가입을 끝낼 때까지
const MOCK_AUDIENCE = 'treecare-identity-mock';
const TIME_ZONE = 'Asia/Seoul';

/** 본인인증 결과 */
export type VerifiedIdentity = {
  name: string;
  birthDate: string; // YYYY-MM-DD
  phone: string; // 010-1234-5678
  ci: string; // 연계정보: 같은 사람이면 어느 업체·언제 인증해도 같은 값
};

export interface IdentityProvider {
  /** 인증 업체가 준 거래 번호로 인증 결과를 조회한다. 위조·만료면 400 */
  verify(identityToken: string): Promise<VerifiedIdentity>;
}

const invalidToken = () => new HttpError(400, 'IDENTITY_INVALID', '본인인증 정보가 올바르지 않거나 만료됐다. 본인인증을 다시 한다.');

/** 휴대폰 번호를 010-1234-5678 형식으로 */
export function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

// ── 개발용 가짜 인증 ──
/** 가짜 CI: 같은 이름·생년월일이면 같은 사람으로 본다(실제 CI처럼 휴대폰 번호가 바뀌어도 같다) */
export function mockCi(name: string, birthDate: string): string {
  return createHash('sha256').update(`mock-ci|${name}|${birthDate}`).digest('base64');
}

/** "인증 창"에서 입력한 이름·생년월일·휴대폰으로 거래 번호(서명한 토큰)를 만든다 */
export function issueMockIdentityToken(input: { name: string; birthDate: string; phone: string }): string {
  const identity: VerifiedIdentity = {
    name: input.name,
    birthDate: input.birthDate,
    phone: normalizePhone(input.phone),
    ci: mockCi(input.name, input.birthDate),
  };
  return jwt.sign({ identity }, jwtSecret(), { audience: MOCK_AUDIENCE, expiresIn: MOCK_TOKEN_EXPIRES_IN });
}

const mockProvider: IdentityProvider = {
  async verify(identityToken) {
    try {
      const payload = jwt.verify(identityToken, jwtSecret(), { audience: MOCK_AUDIENCE }) as { identity?: VerifiedIdentity };
      if (!payload.identity) throw invalidToken();
      return payload.identity;
    } catch {
      throw invalidToken();
    }
  },
};

/** 지금 쓰는 인증 방식. 기본은 개발용 가짜 인증(mock) */
export function identityMode(): string {
  return process.env.IDENTITY_PROVIDER ?? 'mock';
}

export function identityProvider(): IdentityProvider {
  const mode = identityMode();
  if (mode === 'mock') return mockProvider;
  throw new HttpError(503, 'IDENTITY_UNAVAILABLE', `본인인증 업체(${mode})가 아직 연결되지 않았다.`);
}

/** DB에는 CI 원문 대신 해시를 저장한다(같은 사람인지 비교만 하면 되므로) */
export function hashCi(ci: string): string {
  return createHash('sha256').update(ci).digest('hex');
}

/** today(YYYY-MM-DD, 한국 날짜) 기준 만 나이 */
export function ageOn(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export function seoulToday(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });
}
