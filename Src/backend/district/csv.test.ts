import { describe, expect, it } from 'vitest';
import { csvCell, minutesToHours, toCsv } from './csv.js';

describe('csvCell', () => {
  it('쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다', () => {
    expect(csvCell('은행나무')).toBe('은행나무');
    expect(csvCell('가,나')).toBe('"가,나"');
    expect(csvCell('그는 "안녕"')).toBe('"그는 ""안녕"""');
    expect(csvCell('첫 줄\n둘째 줄')).toBe('"첫 줄\n둘째 줄"');
  });

  it('=, +, -, @로 시작하는 글은 수식으로 실행되지 않게 앞에 \'를 붙인다', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+82')).toBe("'+82");
    expect(csvCell('-나무')).toBe("'-나무");
    expect(csvCell('@돌보미')).toBe("'@돌보미");
  });

  it('숫자는 그대로, 빈 값은 빈 칸', () => {
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(1.5)).toBe('1.5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('엑셀용 BOM을 붙이고 CRLF로 줄을 나눈다', () => {
    expect(toCsv([['가', 1], [], ['나']])).toBe('﻿가,1\r\n\r\n나\r\n');
  });
});

describe('minutesToHours', () => {
  it('소수 첫째 자리 시간', () => {
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(125)).toBe(2.1);
    expect(minutesToHours(0)).toBe(0);
  });
});
