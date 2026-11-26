// #66 단체 리포트 집계: 화면·API와 분리된 순수 함수
// 단체 관리자가 그 달 회원 활동을 도로 구간(노선)별·회원별로 묶어 본다.
// - 구간: 나무가 있는 길(노선명 → 동 → 자치구 중 있는 것). 같은 이름의 길도 자치구가 다르면 다른 구간이다
// - 회원은 별명·역할·합계만 담는다(실명·연락처·사진·메모는 담지 않는다). 활동이 없는 회원도 0으로 나온다
// - 활동은 날짜별 활동 기록(records.type = 'activity')이다. 승인 여부와 상관없이 회원이 남긴 기록을 센다

export type MemberRow = { userId: number; nickname: string; role: 'admin' | 'member' };
export type OrgActivityRow = { userId: number; treeId: number; district: string; place: string; date: string; minutes: number };

export type SectionSummary = { district: string; place: string; minutes: number; count: number; treeCount: number; memberCount: number };
export type MemberSummary = { nickname: string; role: 'admin' | 'member'; minutes: number; count: number; treeCount: number };
export type OrganizationSummary = {
  memberCount: number;
  totals: { minutes: number; count: number; treeCount: number; activityDays: number };
  sections: SectionSummary[]; // 활동 시간이 많은 순
  members: MemberSummary[]; // 활동 시간이 많은 순 (같으면 관리자 먼저, 그다음 별명 순)
};

const sum = (rows: OrgActivityRow[]) => rows.reduce((total, r) => total + r.minutes, 0);
const distinct = <T>(values: T[]) => new Set(values).size;

export function summarizeOrganization(members: MemberRow[], activities: OrgActivityRow[]): OrganizationSummary {
  // 구간별: 자치구 + 길 이름으로 묶는다
  const bySection = new Map<string, OrgActivityRow[]>();
  for (const a of activities) {
    const key = `${a.district}\u0000${a.place}`;
    bySection.set(key, [...(bySection.get(key) ?? []), a]);
  }
  const sections: SectionSummary[] = [...bySection.values()]
    .map((rows) => ({
      district: rows[0]!.district,
      place: rows[0]!.place,
      minutes: sum(rows),
      count: rows.length,
      treeCount: distinct(rows.map((r) => r.treeId)),
      memberCount: distinct(rows.map((r) => r.userId)),
    }))
    .sort((a, b) => b.minutes - a.minutes || a.place.localeCompare(b.place, 'ko'));

  const memberSummaries: MemberSummary[] = members
    .map((m) => {
      const rows = activities.filter((a) => a.userId === m.userId);
      return { nickname: m.nickname, role: m.role, minutes: sum(rows), count: rows.length, treeCount: distinct(rows.map((r) => r.treeId)) };
    })
    .sort(
      (a, b) =>
        b.minutes - a.minutes || (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1) || a.nickname.localeCompare(b.nickname, 'ko'),
    );

  return {
    memberCount: members.length,
    totals: {
      minutes: sum(activities),
      count: activities.length,
      treeCount: distinct(activities.map((a) => a.treeId)),
      activityDays: distinct(activities.map((a) => a.date)),
    },
    sections,
    members: memberSummaries,
  };
}
