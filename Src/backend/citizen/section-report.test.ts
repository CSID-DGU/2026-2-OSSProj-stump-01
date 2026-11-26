import { describe, expect, it } from 'vitest';
import { buildSectionReport, type SectionTreeRow } from './section-report.js';

const tree = (over: Partial<SectionTreeRow>): SectionTreeRow => ({
  sectionId: 1,
  treeId: 1,
  name: '은행나무, 소파로 1번',
  placeNo: 1,
  caregiverCount: 0,
  activityCount: 0,
  minutes: 0,
  activityDates: [],
  reported: 0,
  resolved: 0,
  ...over,
});

const sections = [{ id: 1, district: '중구', place: '소파로' }];

describe('buildSectionReport', () => {
  it('나무마다 상태(돌봄 중·활동 끊김·돌보미 없음)를 정하고 구간 합계를 낸다', () => {
    const report = buildSectionReport(
      sections,
      [
        // 들어온 순서와 상관없이 길 안 번호 순으로 놓는다 (수종 글자 순이 아니다)
        tree({ treeId: 3, placeNo: 3, name: '느티나무, 소파로 3번', reported: 1 }),
        tree({ treeId: 1, placeNo: 1, name: '은행나무, 소파로 1번', caregiverCount: 2, activityCount: 3, minutes: 80, activityDates: ['2026-11-03', '2026-11-10'] }),
        tree({ treeId: 2, placeNo: 2, name: '은행나무, 소파로 2번', caregiverCount: 1 }),
      ],
      [{ sectionId: 1, caregiverCount: 3 }],
    );

    expect(report.sections).toHaveLength(1);
    expect(report.sections[0]).toMatchObject({
      district: '중구',
      place: '소파로',
      treeCount: 3,
      caredTreeCount: 2,
      inactiveTreeCount: 1,
      noCaregiverTreeCount: 1,
      caregiverCount: 3,
      activityCount: 3,
      minutes: 80,
      activityDays: 2,
      reported: 1,
      resolved: 0,
    });
    expect(report.sections[0]!.trees.map((t) => [t.name, t.status])).toEqual([
      ['은행나무, 소파로 1번', 'cared'],
      ['은행나무, 소파로 2번', 'inactive'],
      ['느티나무, 소파로 3번', 'no_caregiver'],
    ]);
    expect(report.sections[0]!.trees[0]).toMatchObject({ activityDays: 2, lastActivityDate: '2026-11-10' });
    expect(report.sections[0]!.trees[2]!.lastActivityDate).toBeNull();
  });

  it('여러 구간의 합계를 더하고, 활동한 날은 구간을 넘어 같은 날을 한 번만 센다', () => {
    const report = buildSectionReport(
      [...sections, { id: 2, district: '중구', place: '을지로' }],
      [
        tree({ sectionId: 1, treeId: 1, caregiverCount: 1, activityCount: 1, minutes: 30, activityDates: ['2026-11-03'] }),
        tree({ sectionId: 2, treeId: 5, caregiverCount: 1, activityCount: 2, minutes: 40, activityDates: ['2026-11-03', '2026-11-04'] }),
      ],
      [
        { sectionId: 1, caregiverCount: 1 },
        { sectionId: 2, caregiverCount: 1 },
      ],
    );

    expect(report.totals).toMatchObject({ sectionCount: 2, treeCount: 2, activityCount: 3, minutes: 70, activityDays: 2 });
  });

  it('나무가 없는 구간(원본에서 사라짐)도 0으로 남긴다', () => {
    const report = buildSectionReport(sections, [], []);

    expect(report.sections[0]).toMatchObject({ treeCount: 0, caregiverCount: 0, trees: [] });
  });
});
