import { describe, expect, it } from 'vitest';
import { forecastItems } from '../test/kma-fixtures.js';
import { forecastBase, latLngToGrid, parseForecast, parseWarnings, recommendTimes, summarizeToday } from './weather-logic.js';

describe('latLngToGrid', () => {
  it('기상청 격자로 바꾼다 (서울시청 60,127 / 부산시청 98,76)', () => {
    expect(latLngToGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
    expect(latLngToGrid(35.1796, 129.0756)).toEqual({ nx: 98, ny: 76 });
  });
});

describe('forecastBase', () => {
  it('02:15(한국 시간) 이후에는 오늘 02시 발표, 그 전에는 어제 23시 발표', () => {
    expect(forecastBase(new Date('2026-11-12T00:00:00Z'))).toEqual({ baseDate: '20261112', baseTime: '0200' }); // 09:00
    expect(forecastBase(new Date('2026-11-11T17:20:00Z'))).toEqual({ baseDate: '20261112', baseTime: '0200' }); // 02:20
    expect(forecastBase(new Date('2026-11-11T17:05:00Z'))).toEqual({ baseDate: '20261111', baseTime: '2300' }); // 02:05
    expect(forecastBase(new Date('2026-11-11T15:30:00Z'))).toEqual({ baseDate: '20261111', baseTime: '2300' }); // 00:30
  });
});

describe('parseForecast', () => {
  it('오늘 시간별 날씨와 최고·최저기온을 꺼낸다', () => {
    const r = parseForecast(forecastItems('2026-11-12', { 14: { temp: 18 } }, { tmx: 19, tmn: 6 }), '2026-11-12');
    expect(r.hourly).toHaveLength(24);
    expect(r.hourly[14]).toEqual({ hour: 14, temp: 18, pop: 10, precipitationType: 0, sky: 1 });
    expect(r).toMatchObject({ tempMax: 19, tempMin: 6 });
  });

  it('최고·최저기온이 없으면 시간별 기온에서 구한다(다음 날 항목은 빼고)', () => {
    const r = parseForecast(forecastItems('2026-11-12', { 15: { temp: 25 }, 5: { temp: 3 } }), '2026-11-12');
    expect(r).toMatchObject({ tempMax: 25, tempMin: 3 });
  });
});

describe('parseWarnings', () => {
  it('서울이 들어간 특보 이름만 꺼낸다', () => {
    const t6 = 'o 폭염경보 : 서울, 인천, 경기도(수원, 성남)\r\no 건조주의보 : 강원도(강릉시평지)\r\no 강풍주의보 : 서울(서울동남권), 경기도';
    expect(parseWarnings(t6)).toEqual(['폭염경보', '강풍주의보']);
  });

  it('없으면 빈 목록 (실제 응답: "o 없 음")', () => {
    expect(parseWarnings(null)).toEqual([]);
    expect(parseWarnings('o 없 음')).toEqual([]);
  });

  it('서울이 아닌 지역 특보는 무시한다 (2026-11-10 실제 응답 문장)', () => {
    expect(parseWarnings('o 풍랑주의보 : 남해동부바깥먼바다, 제주도남쪽바깥먼바다')).toEqual([]);
  });
});

describe('recommendTimes', () => {
  const hourly = (hours: Parameters<typeof forecastItems>[1]) => parseForecast(forecastItems('2026-11-12', hours), '2026-11-12').hourly;

  it('평소에는 06~20시를 추천하고, 비 오거나 강수확률 60% 이상인 시각은 뺀다', () => {
    expect(recommendTimes(hourly({}), false)).toEqual([{ start: '06:00', end: '20:00' }]);
    expect(recommendTimes(hourly({ 12: { temp: 20, pty: 1 }, 13: { temp: 20, pop: 70 } }), false)).toEqual([
      { start: '06:00', end: '12:00' },
      { start: '14:00', end: '20:00' },
    ]);
  });

  it('폭염 날은 11~17시를 빼고, 31℃ 이상인 시각도 뺀다', () => {
    const hot = hourly({ 9: { temp: 31 }, 10: { temp: 32 }, 17: { temp: 32 }, 18: { temp: 30 } });
    expect(recommendTimes(hot, true)).toEqual([
      { start: '06:00', end: '09:00' },
      { start: '18:00', end: '20:00' },
    ]);
  });

  it('너무 추운 시각(-5℃ 이하)은 뺀다', () => {
    const cold = hourly(Object.fromEntries([6, 7, 8].map((h) => [h, { temp: -6 }])));
    expect(recommendTimes(cold, false)).toEqual([{ start: '09:00', end: '20:00' }]);
  });
});

describe('summarizeToday', () => {
  it('최고기온 33℃ 이상이면 폭염으로 표시하고 낮 활동을 피하라고 안내한다', () => {
    const r = summarizeToday(forecastItems('2026-08-03', {}, { tmx: 34 }), null, '2026-08-03');
    expect(r).toMatchObject({ isHeatwave: true, tempMax: 34, warnings: [] });
    expect(r.recommendedTimes).toEqual([
      { start: '06:00', end: '11:00' },
      { start: '17:00', end: '20:00' },
    ]);
    expect(r.message).toContain('폭염이에요');
  });

  it('최고기온이 33℃ 아래여도 폭염특보가 있으면 폭염이다', () => {
    const r = summarizeToday(forecastItems('2026-08-03', {}, { tmx: 32 }), 'o 폭염주의보 : 서울', '2026-08-03');
    expect(r).toMatchObject({ isHeatwave: true, warnings: ['폭염주의보'] });
  });

  it('하루 종일 비가 오면 쉬어도 된다고 안내한다', () => {
    const rainy = Object.fromEntries(Array.from({ length: 24 }, (_, h) => [h, { temp: 15, pty: 1, pop: 90 }]));
    const r = summarizeToday(forecastItems('2026-11-12', rainy), null, '2026-11-12');
    expect(r.recommendedTimes).toEqual([]);
    expect(r.message).toContain('쉬어도 괜찮아요');
  });
});
