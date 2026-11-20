// 월간 보고서 취합(순수 함수) 단위 테스트. DB 없이 돈다.
import { describe, expect, it } from 'vitest';
import { buildDraft, type DraftSource } from './monthly-report-draft.js';

const rec = (over: Partial<DraftSource>): DraftSource => ({
  recordId: 1,
  date: '2026-11-03',
  treeId: 10,
  treeName: '은행나무, 명동길',
  agency: '중구',
  activityKinds: ['쓰레기 줍기'],
  minutes: 30,
  photoCount: 0,
  memo: null,
  ...over,
});

describe('buildDraft', () => {
  it('날짜순, 같은 날이면 나무 이름순으로 줄을 세우고 시간을 더한다', () => {
    const draft = buildDraft([
      rec({ recordId: 3, date: '2026-11-05', treeName: '느티나무, 소공로', minutes: 20 }),
      rec({ recordId: 1, date: '2026-11-03', treeName: '은행나무, 명동길', minutes: 30 }),
      rec({ recordId: 2, date: '2026-11-03', treeName: '느티나무, 소공로', treeId: 11, minutes: 40 }),
    ]);

    expect(draft.rows.map((r) => r.recordId)).toEqual([2, 1, 3]);
    expect(draft.totalMinutes).toBe(90);
    expect(draft.dates).toEqual(['2026-11-03', '2026-11-05']);
    expect(draft.treeCount).toBe(2);
    expect(draft.agencies).toEqual(['중구']);
  });

  it('관리청이 섞이면 모두 알려 준다(보고서 하나는 관리청 하나에만 낸다)', () => {
    const draft = buildDraft([rec({ agency: '중구' }), rec({ recordId: 2, agency: '종로구' })]);
    expect(draft.agencies).toEqual(['종로구', '중구']);
  });

  it('줄마다 양식 항목 순서대로 칸을 채운다', () => {
    const draft = buildDraft([rec({ activityKinds: ['쓰레기 줍기', '보호틀 정리'], photoCount: 2, memo: '낙엽' })]);

    expect(draft.fields.map((f) => f.key)).toEqual(['date', 'treeName', 'activities', 'minutes', 'photoCount', 'note']);
    expect(draft.rows[0]!.values).toEqual({
      date: '2026-11-03',
      treeName: '은행나무, 명동길',
      activities: '쓰레기 줍기, 보호틀 정리',
      minutes: 30,
      photoCount: 2,
      note: '낙엽',
    });
  });

  it('기록이 없으면 빈 초안', () => {
    expect(buildDraft([])).toMatchObject({ rows: [], totalMinutes: 0, dates: [], treeCount: 0, agencies: [] });
  });
});
