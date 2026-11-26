import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../common/db.js';
import { resetData } from '../test/fixtures.js';
import { weatherDeps } from './weather.js';
import { collectRange, collectRecentWeather, dailyRange, startWeatherDailyJob, toWeatherRow, upsertWeather } from './weather-daily.js';

const original = { ...weatherDeps };
const KEY = 'test-secret-key';

/** 기상청 ASOS 응답 형식(공공데이터포털 공통 형식) */
function asosResponse(items: object[]) {
  return { response: { header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' }, body: { totalCount: items.length, items: { item: items } } } };
}

const urls: string[] = [];
beforeEach(async () => {
  await resetData();
  urls.length = 0;
});
afterEach(() => Object.assign(weatherDeps, original));
afterAll(closePool);

describe('toWeatherRow', () => {
  it('data/weather.py와 같은 규칙: 빈 강수량은 0, 33℃ 이상이면 폭염', () => {
    expect(toWeatherRow({ tm: '2026-08-01', sumRn: '', avgTa: '29.1', maxTa: '33.0' })).toEqual({
      date: '2026-08-01', region: 'seoul', precipitationMm: 0, tempAvg: 29.1, tempMax: 33, isHeatwave: true,
    });
    expect(toWeatherRow({ tm: '2026-08-02', sumRn: '12.5', avgTa: '25', maxTa: '32.9' })).toMatchObject({ precipitationMm: 12.5, isHeatwave: false });
    expect(toWeatherRow({ tm: '2026-08-03' })).toMatchObject({ precipitationMm: 0, tempAvg: null, tempMax: null, isHeatwave: false });
  });
});

describe('dailyRange', () => {
  it('한국 시간 어제까지 최근 3일', () => {
    expect(dailyRange(new Date('2026-11-26T00:30:00Z'))).toEqual({ start: '2026-11-23', end: '2026-11-25' }); // 한국 09:30
    expect(dailyRange(new Date('2026-11-30T15:30:00Z'))).toEqual({ start: '2026-11-28', end: '2026-11-30' }); // 한국 12/1 00:30
    expect(dailyRange(new Date('2026-03-02T03:00:00Z'), 2)).toEqual({ start: '2026-02-28', end: '2026-03-01' }); // 달 넘김
  });
});

describe('collectRange', () => {
  const now = new Date('2026-11-26T00:30:00Z'); // 한국 11/26, 어제 11/25
  it('빈 날이 없거나 최근 3일 안이면 최근 3일', () => {
    expect(collectRange(now, null)).toEqual({ start: '2026-11-23', end: '2026-11-25' });
    expect(collectRange(now, '2026-11-24')).toEqual({ start: '2026-11-23', end: '2026-11-25' });
  });
  it('그보다 앞에 빈 날이 있으면 그 날부터', () => {
    expect(collectRange(now, '2026-11-12')).toEqual({ start: '2026-11-12', end: '2026-11-25' });
  });
});

describe('collectRecentWeather', () => {
  it('어제까지 최근 3일을 받아 넣고, 다시 받으면 새 값으로 덮어쓴다', async () => {
    let maxTa = '31.0';
    weatherDeps.fetchJson = async (url: string) => {
      urls.push(url);
      return asosResponse([
        { tm: '2026-08-01', sumRn: '', avgTa: '28', maxTa: '34.2' },
        { tm: '2026-08-02', sumRn: '3.5', avgTa: '27', maxTa: '30' },
        { tm: '2026-08-03', sumRn: '', avgTa: '27', maxTa },
      ]);
    };
    const now = new Date('2026-08-04T03:00:00Z');

    // 최근 31일 중 앞 28일은 이미 있다고 두면 최근 3일만 받는다
    await getPool().query(
      "INSERT INTO weather (date, region) SELECT d::date, 'seoul' FROM generate_series('2026-07-04'::date, '2026-07-31'::date, interval '1 day') d",
    );
    const first = await collectRecentWeather(getPool(), { key: KEY, now });
    expect(first).toEqual({ start: '2026-08-01', end: '2026-08-03', inserted: 3, updated: 0, heatwaveDays: 1 });
    const q = new URL(urls[0]!).searchParams;
    expect(Object.fromEntries(['stnIds', 'startDt', 'endDt', 'dateCd'].map((k) => [k, q.get(k)]))).toEqual({
      stnIds: '108', startDt: '20260801', endDt: '20260803', dateCd: 'DAY',
    });

    maxTa = '33.5'; // 기상청이 지난 값을 고친 경우
    const second = await collectRecentWeather(getPool(), { key: KEY, now });
    expect(second).toMatchObject({ inserted: 0, updated: 3, heatwaveDays: 2 });
    const { rows } = await getPool().query(
      "SELECT to_char(date, 'YYYY-MM-DD') AS date, precipitation_mm::float AS rain, temp_max::float AS tmax, is_heatwave FROM weather WHERE date >= '2026-08-01' ORDER BY date",
    );
    expect(rows).toEqual([
      { date: '2026-08-01', rain: 0, tmax: 34.2, is_heatwave: true },
      { date: '2026-08-02', rain: 3.5, tmax: 30, is_heatwave: false },
      { date: '2026-08-03', rain: 0, tmax: 33.5, is_heatwave: true },
    ]);
  });

  it('최근 31일 안의 빈 날부터 요청한다(처음이면 31일 전부터)', async () => {
    weatherDeps.fetchJson = async (url: string) => {
      urls.push(url);
      return asosResponse([]);
    };
    const now = new Date('2026-08-04T03:00:00Z'); // 어제 8/3, 31일 창 7/4 ~ 8/3
    // 7/4 ~ 7/20만 있고 7/21부터 빔
    await getPool().query(
      "INSERT INTO weather (date, region) SELECT d::date, 'seoul' FROM generate_series('2026-07-04'::date, '2026-07-20'::date, interval '1 day') d",
    );
    expect(await collectRecentWeather(getPool(), { key: KEY, now })).toMatchObject({ start: '2026-07-21', end: '2026-08-03' });
    // 중간에 구멍(7/10)만 있어도 그 날부터
    await getPool().query(
      "INSERT INTO weather (date, region) SELECT d::date, 'seoul' FROM generate_series('2026-07-21'::date, '2026-08-03'::date, interval '1 day') d",
    );
    await getPool().query("DELETE FROM weather WHERE date = '2026-07-10'");
    expect(await collectRecentWeather(getPool(), { key: KEY, now })).toMatchObject({ start: '2026-07-10' });
    expect(new URL(urls[1]!).searchParams.get('startDt')).toBe('20260710');
  });

  it('기상청이 오류 코드를 주면 에러', async () => {
    weatherDeps.fetchJson = async () => ({ response: { header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } } });
    await expect(collectRecentWeather(getPool(), { key: KEY, now: new Date('2026-08-04T03:00:00Z') })).rejects.toThrow('30');
  });

  it('받은 자료가 없으면 아무것도 넣지 않는다', async () => {
    expect(await upsertWeather(getPool(), [])).toEqual({ inserted: 0, updated: 0 });
  });
});

describe('startWeatherDailyJob', () => {
  it('키가 없으면 건너뛰고 알린다', () => {
    const saved = process.env.KMA_SERVICE_KEY;
    delete process.env.KMA_SERVICE_KEY;
    const logs: string[] = [];
    try {
      startWeatherDailyJob(1000, (m) => logs.push(m))();
    } finally {
      if (saved !== undefined) process.env.KMA_SERVICE_KEY = saved;
    }
    expect(logs).toEqual(['[기상 수집] KMA_SERVICE_KEY가 없어 기상 일자료 매일 수집을 건너뛴다.']);
  });

  it('실패해도 로그에 인증키를 찍지 않는다', async () => {
    const saved = process.env.KMA_SERVICE_KEY;
    process.env.KMA_SERVICE_KEY = KEY;
    weatherDeps.fetchJson = async (url: string) => {
      throw new Error(`요청 실패: ${url}`); // 주소에 키가 들어 있는 에러
    };
    const logs: string[] = [];
    const stop = startWeatherDailyJob(60_000, (m) => logs.push(m));
    try {
      await expect.poll(() => logs.length).toBe(1);
    } finally {
      stop();
      if (saved === undefined) delete process.env.KMA_SERVICE_KEY;
      else process.env.KMA_SERVICE_KEY = saved;
    }
    expect(logs[0]).toContain('[기상 수집] 실패');
    expect(logs[0]).toContain('***');
    expect(logs[0]).not.toContain(KEY);
  });
});
