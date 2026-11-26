import { describe, expect, it } from 'vitest';
import { summarizeOrganization, type MemberRow, type OrgActivityRow } from './organization-summary.js';

const members: MemberRow[] = [
  { userId: 1, nickname: '관리자', role: 'admin' },
  { userId: 2, nickname: '나무사랑', role: 'member' },
  { userId: 3, nickname: '쉬는중', role: 'member' },
];

const act = (userId: number, treeId: number, place: string, date: string, minutes: number): OrgActivityRow => ({
  userId,
  treeId,
  district: '중구',
  place,
  date,
  minutes,
});

describe('summarizeOrganization', () => {
  it('합계·도로 구간별·회원별로 묶는다', () => {
    const s = summarizeOrganization(members, [
      act(1, 10, '소파로', '2026-11-03', 30),
      act(2, 11, '소파로', '2026-11-03', 20),
      act(2, 11, '소파로', '2026-11-10', 40),
      act(2, 20, '을지로', '2026-11-12', 15),
    ]);

    expect(s.memberCount).toBe(3);
    expect(s.totals).toEqual({ minutes: 105, count: 4, treeCount: 3, activityDays: 3 });
    // 구간은 활동 시간이 많은 순
    expect(s.sections).toEqual([
      { district: '중구', place: '소파로', minutes: 90, count: 3, treeCount: 2, memberCount: 2 },
      { district: '중구', place: '을지로', minutes: 15, count: 1, treeCount: 1, memberCount: 1 },
    ]);
  });

  it('회원은 활동이 없어도 0으로 나오고, 별명·역할·합계만 담는다 (활동 시간 많은 순)', () => {
    const s = summarizeOrganization(members, [act(2, 11, '소파로', '2026-11-03', 20), act(1, 10, '소파로', '2026-11-04', 50)]);

    expect(s.members).toEqual([
      { nickname: '관리자', role: 'admin', minutes: 50, count: 1, treeCount: 1 },
      { nickname: '나무사랑', role: 'member', minutes: 20, count: 1, treeCount: 1 },
      { nickname: '쉬는중', role: 'member', minutes: 0, count: 0, treeCount: 0 },
    ]);
  });

  it('같은 이름의 길도 자치구가 다르면 다른 구간이다', () => {
    const s = summarizeOrganization(members, [
      { ...act(1, 10, '세종대로', '2026-11-03', 30), district: '중구' },
      { ...act(1, 30, '세종대로', '2026-11-04', 30), district: '종로구' },
    ]);

    expect(s.sections.map((x) => `${x.district} ${x.place}`).sort()).toEqual(['종로구 세종대로', '중구 세종대로']);
  });

  it('활동이 없으면 합계 0, 구간은 빈 목록', () => {
    const s = summarizeOrganization(members, []);

    expect(s.totals).toEqual({ minutes: 0, count: 0, treeCount: 0, activityDays: 0 });
    expect(s.sections).toEqual([]);
  });
});
