import { describe, expect, it } from 'vitest';
import { buildRingMonths, type RingSources } from './tree-rings.js';

const empty: RingSources = { weather: [], care: [], activityDays: [], stories: [], incidents: [], reactions: [] };

describe('buildRingMonths', () => {
  it('자료가 없어도 1월~12월 12조각을 만든다 (날씨 없음 = null, 나머지는 0·빈 목록)', () => {
    const months = buildRingMonths(empty);

    expect(months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(months[0]).toEqual({
      month: 1,
      rainMm: null,
      tempMaxAvg: null,
      heatDays: 0,
      careMinutes: 0,
      careCount: 0,
      activityDays: [],
      stories: [],
      reported: 0,
      resolved: 0,
      reactions: 0,
    });
  });

  it('여러 출처의 월별 값을 그 달 조각에 모은다', () => {
    const months = buildRingMonths({
      weather: [{ month: 3, rainMm: 15, tempMaxAvg: 13, heatDays: 0 }],
      care: [{ month: 3, minutes: 80, count: 3 }],
      activityDays: [
        { month: 3, day: 15 },
        { month: 3, day: 3 },
      ],
      stories: [{ id: 7, month: 4, day: 1 }],
      incidents: [{ month: 5, reported: 1, resolved: 0 }],
      reactions: [{ month: 7, count: 2 }],
    });

    expect(months[2]).toMatchObject({ month: 3, rainMm: 15, tempMaxAvg: 13, careMinutes: 80, careCount: 3, activityDays: [3, 15] });
    expect(months[3]!.stories).toEqual([{ id: 7, day: 1 }]);
    expect(months[4]).toMatchObject({ reported: 1, resolved: 0 });
    expect(months[6]!.reactions).toBe(2);
    expect(months[7]!.reactions).toBe(0);
  });
});
