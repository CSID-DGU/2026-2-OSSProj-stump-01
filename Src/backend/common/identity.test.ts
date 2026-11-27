import { describe, expect, it } from 'vitest';
import { ageOn, mockCi, normalizePhone } from './identity.js';

describe('ageOn (만 나이)', () => {
  it('생일 전날까지는 한 살 적다', () => {
    expect(ageOn('2012-11-27', '2026-11-26')).toBe(13);
    expect(ageOn('2012-11-26', '2026-11-26')).toBe(14);
    expect(ageOn('2012-02-29', '2026-02-28')).toBe(13); // 윤일생은 3월 1일에 나이를 먹는다
    expect(ageOn('2012-02-29', '2026-03-01')).toBe(14);
  });
});

describe('normalizePhone', () => {
  it('하이픈 없이 써도 010-1234-5678 형식으로', () => {
    expect(normalizePhone('01012345678')).toBe('010-1234-5678');
    expect(normalizePhone('011-123-4567')).toBe('011-123-4567');
  });
});

describe('mockCi', () => {
  it('같은 이름·생년월일이면 같은 사람(휴대폰과 상관없음)', () => {
    expect(mockCi('김돌봄', '1990-01-01')).toBe(mockCi('김돌봄', '1990-01-01'));
    expect(mockCi('김돌봄', '1990-01-01')).not.toBe(mockCi('김돌봄', '1990-01-02'));
  });
});
