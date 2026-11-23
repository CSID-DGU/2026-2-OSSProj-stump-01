// 내려받기용 CSV 만들기 (#73)
// 엑셀에서 바로 열리도록 UTF-8 BOM을 붙이고 줄바꿈은 CRLF로 쓴다.
// 새 라이브러리(xlsx 등)를 들이지 않으려고 CSV를 골랐다(CLAUDE.md 기술 스택).

export type Cell = string | number | null | undefined;

const BOM = '﻿'; // 엑셀이 UTF-8로 읽게 하는 표시. 없으면 한글이 깨진다
const FORMULA_START = /^[=+\-@\t\r]/; // 엑셀이 수식으로 실행하는 첫 글자

/**
 * 칸 하나를 CSV 문자열로 바꾼다.
 * - 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다.
 * - 별명처럼 사용자가 쓴 글이 =, +, -, @로 시작하면 앞에 '를 붙여 수식으로 실행되지 않게 한다(CSV 수식 주입 방지).
 *   숫자 칸(number)은 그대로 둔다.
 */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  let s = value;
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 여러 줄을 CSV 파일 내용으로 만든다. 빈 배열은 빈 줄이다(구역 나누기). */
export function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** 분 → 시간(소수 첫째 자리). 표에서 더하기 쉽게 숫자로 둔다 */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}
