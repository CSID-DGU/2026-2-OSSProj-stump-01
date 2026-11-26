// #143 단체 관심 구간 리포트 집계: 화면·API와 분리된 순수 함수
// 단체가 고른 구간(도로·거리)의 "모든 돌보미" 활동을 나무 단위·구간 단위 익명 합계로 묶는다.
// 팀 절대 규칙(다른 참여자의 신원은 익명 합계로만)에 따라 사람(이름·별명·id)은 담지 않고 수만 담는다.
// 나무 상태는 관리 사각지대 정의(common/care-gaps.ts)와 같다:
//   돌보미 없음 = 그 달에 활동 기간이 걸친 승인된 돌보미가 없음 / 활동 끊김 = 돌보미는 있는데 그 달 활동 기록이 없음

export type SectionRow = { id: number; district: string; place: string };

/** 나무 한 그루의 그 달 값 (SQL 이 센다) */
export type SectionTreeRow = {
  sectionId: number;
  treeId: number;
  name: string; // "은행나무, 소파로 3번"
  placeNo: number | null; // 길 안 번호 (trees.place_no). 나무 목록을 이 순서(서쪽부터)로 놓는다
  caregiverCount: number; // 그 달 승인된 돌보미 수
  activityCount: number; // 그 달 활동 기록 수 (돌보미 누구든)
  minutes: number;
  activityDates: string[]; // 그 달 활동한 날 (YYYY-MM-DD, 중복 없음)
  reported: number; // 그 달 접수된 신고 수
  resolved: number; // 그 달 조치 완료된 신고 수
};

/** 구간마다 그 달 돌보미 수 (한 사람이 여러 그루를 돌봐도 한 명) */
export type SectionCaregiverRow = { sectionId: number; caregiverCount: number };

export type TreeStatus = 'cared' | 'inactive' | 'no_caregiver'; // 돌봄 중 / 활동 끊김 / 돌보미 없음

export type SectionTreeView = {
  treeId: number;
  name: string;
  status: TreeStatus;
  caregiverCount: number;
  activityCount: number;
  minutes: number;
  activityDays: number;
  lastActivityDate: string | null; // 그 달 마지막 활동일
  reported: number;
  resolved: number;
};

export type SectionView = {
  id: number;
  district: string;
  place: string;
  treeCount: number;
  caredTreeCount: number; // 돌보미가 있는 나무
  inactiveTreeCount: number; // 그중 그 달 활동이 끊긴 나무
  noCaregiverTreeCount: number; // 돌보미가 없는 나무
  caregiverCount: number;
  activityCount: number;
  minutes: number;
  activityDays: number;
  reported: number;
  resolved: number;
  trees: SectionTreeView[]; // 길 안 번호 순 (서쪽부터)
};

export type SectionReport = {
  totals: { sectionCount: number; treeCount: number; activityCount: number; minutes: number; activityDays: number };
  sections: SectionView[];
};

function statusOf(t: SectionTreeRow): TreeStatus {
  if (t.caregiverCount === 0) return 'no_caregiver';
  return t.activityCount === 0 ? 'inactive' : 'cared';
}

const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((total, r) => total + pick(r), 0);

export function buildSectionReport(sections: SectionRow[], trees: SectionTreeRow[], caregivers: SectionCaregiverRow[]): SectionReport {
  const views: SectionView[] = sections.map((s) => {
    const rows = trees.filter((t) => t.sectionId === s.id);
    const treeViews: SectionTreeView[] = [...rows]
      .sort((a, b) => (a.placeNo ?? Infinity) - (b.placeNo ?? Infinity) || a.treeId - b.treeId)
      .map((t) => ({
        treeId: t.treeId,
        name: t.name,
        status: statusOf(t),
        caregiverCount: t.caregiverCount,
        activityCount: t.activityCount,
        minutes: t.minutes,
        activityDays: t.activityDates.length,
        lastActivityDate: t.activityDates.length > 0 ? [...t.activityDates].sort().at(-1)! : null,
        reported: t.reported,
        resolved: t.resolved,
      }));
    return {
      id: s.id,
      district: s.district,
      place: s.place,
      treeCount: rows.length,
      caredTreeCount: treeViews.filter((t) => t.status !== 'no_caregiver').length,
      inactiveTreeCount: treeViews.filter((t) => t.status === 'inactive').length,
      noCaregiverTreeCount: treeViews.filter((t) => t.status === 'no_caregiver').length,
      caregiverCount: caregivers.find((c) => c.sectionId === s.id)?.caregiverCount ?? 0,
      activityCount: sum(rows, (t) => t.activityCount),
      minutes: sum(rows, (t) => t.minutes),
      activityDays: new Set(rows.flatMap((t) => t.activityDates)).size,
      reported: sum(rows, (t) => t.reported),
      resolved: sum(rows, (t) => t.resolved),
      trees: treeViews,
    };
  });

  return {
    totals: {
      sectionCount: views.length,
      treeCount: sum(views, (v) => v.treeCount),
      activityCount: sum(views, (v) => v.activityCount),
      minutes: sum(views, (v) => v.minutes),
      activityDays: new Set(trees.flatMap((t) => t.activityDates)).size,
    },
    sections: views,
  };
}
