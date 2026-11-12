import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool } from '../common/db.js';
import { createTree, resetData } from '../test/fixtures.js';
import { forecastItems, kmaNoData, kmaOk } from '../test/kma-fixtures.js';
import { clearWeatherCache, weatherDeps } from './weather.js';

const api = createApp();
const original = { ...weatherDeps };
let calls: string[];

beforeAll(() => {
  process.env.KMA_SERVICE_KEY ??= 'test-key';
});
beforeEach(async () => {
  await resetData();
  clearWeatherCache();
  calls = [];
  weatherDeps.now = () => new Date('2026-08-03T00:30:00Z'); // 한국 시간 09:30
  weatherDeps.fetchJson = async (url: string) => {
    calls.push(url);
    if (url.includes('getVilageFcst')) return kmaOk(forecastItems('2026-08-03', {}, { tmx: 34, tmn: 26 }));
    return kmaOk([{ t6: 'o 폭염경보 : 서울, 인천' }]);
  };
});
afterEach(() => Object.assign(weatherDeps, original));
afterAll(closePool);

describe('GET /weather/today', () => {
  it('로그인 없이 오늘 최고기온·특보·활동 추천 시간을 준다', async () => {
    const res = await request(api).get('/weather/today');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: '2026-08-03',
      tempMax: 34,
      tempMin: 26,
      isHeatwave: true,
      warnings: ['폭염경보'],
      recommendedTimes: [
        { start: '06:00', end: '11:00' },
        { start: '17:00', end: '20:00' },
      ],
      location: { treeId: null, nx: 60, ny: 127 },
      forecastBase: '20260803 0200',
    });
    expect(res.body.hourly).toHaveLength(24);
    const fcst = new URL(calls.find((u) => u.includes('getVilageFcst'))!);
    expect(fcst.searchParams.get('nx')).toBe('60');
    expect(fcst.searchParams.get('base_time')).toBe('0200');
  });

  it('treeId를 주면 그 나무 위치의 격자로 묻는다', async () => {
    const tree = await createTree(); // 서울 중구 근처
    const res = await request(api).get(`/weather/today?treeId=${tree}`);
    expect(res.body.location).toEqual({ treeId: tree, nx: 60, ny: 127 });
  });

  it('없는 나무는 404', async () => {
    expect((await request(api).get('/weather/today?treeId=999999')).status).toBe(404);
  });

  it('같은 격자는 캐시해서 기상청에 다시 묻지 않는다', async () => {
    await request(api).get('/weather/today');
    await request(api).get('/weather/today');
    expect(calls.filter((u) => u.includes('getVilageFcst'))).toHaveLength(1);
  });

  it('발효 중인 특보가 없으면(NO_DATA) 빈 목록', async () => {
    weatherDeps.fetchJson = async (url: string) =>
      url.includes('getVilageFcst') ? kmaOk(forecastItems('2026-08-03', {}, { tmx: 28 })) : kmaNoData;
    const res = await request(api).get('/weather/today');
    expect(res.body).toMatchObject({ warnings: [], isHeatwave: false, message: '오늘 활동하기 좋은 시간이에요.' });
  });

  it('기상청 호출이 실패하면 503', async () => {
    weatherDeps.fetchJson = async () => {
      throw new Error('기상청 응답 403');
    };
    const res = await request(api).get('/weather/today');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('WEATHER_UNAVAILABLE');
  });
});
