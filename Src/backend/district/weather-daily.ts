// 기상청 ASOS 일자료 매일 수집 (서울 지점 108 → weather 테이블)
// 나이테(#12)의 비·더위, 사각지대 월별 집계(#22)의 폭염일이 이 테이블을 쓴다.
// 지금까지는 data/weather.py를 사람이 돌리거나 crontab에 걸어야 했다. 서버가 하나라(CLAUDE.md) 서버 안에서 돌린다.
// 규칙은 data/weather.py와 같다: 비가 안 온 날은 강수량 0, 일 최고기온 33℃ 이상이면 폭염, (date, region) 기준 덮어쓰기.
// 과거 몇 년치를 한 번에 채울 때는 지금처럼 data/weather.py --start --end --load를 쓴다.
import type { Db } from '../common/db.js';
import { getPool } from '../common/db.js';
import { itemsOf, weatherDeps } from './weather.js';
import { HEATWAVE_MAX_TEMP } from './weather-logic.js';

// ── 기준값 ──
const ASOS_URL = 'https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList';
const STATION_ID = '108'; // 서울 종관기상관측소. 서울에 ASOS 지점은 이곳 하나다
export const WEATHER_REGION = 'seoul'; // weather.region 값
export const DAILY_DAYS = 3; // 어제까지 최근 3일을 받는다. 기상청이 지난 값을 고치는 경우가 있어 하루만 받지 않는다
export const MAX_BACKFILL_DAYS = 31; // 서버가 꺼져 있어 최근 이만큼 안에 빈 날이 있으면 그 날부터 채운다
const PAGE_SIZE = 999;
export const DAILY_JOB_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6시간마다(기상청이 전날 자료를 올리는 시각이 일정하지 않아 하루 여러 번)
const TIME_ZONE = 'Asia/Seoul';

export type WeatherRow = {
  date: string; // YYYY-MM-DD
  region: string;
  precipitationMm: number;
  tempAvg: number | null;
  tempMax: number | null;
  isHeatwave: boolean;
};

type AsosItem = { tm: string; sumRn?: string; avgTa?: string; maxTa?: string };

/** 숫자로 바꾼다. 빈 값·숫자가 아니면 null */
function toNumber(v: string | undefined): number | null {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 기상청 응답 한 건 → weather 행 (data/weather.py to_weather와 같은 규칙) */
export function toWeatherRow(item: AsosItem): WeatherRow {
  const tempMax = toNumber(item.maxTa);
  return {
    date: item.tm,
    region: WEATHER_REGION,
    precipitationMm: toNumber(item.sumRn) ?? 0, // 비가 오지 않은 날은 sumRn이 빈 값으로 온다
    tempAvg: toNumber(item.avgTa),
    tempMax,
    isHeatwave: tempMax !== null && tempMax >= HEATWAVE_MAX_TEMP,
  };
}

/** 어제까지 최근 days일의 시작·끝(YYYY-MM-DD). 기상청은 전날 자료까지만 준다 */
export function dailyRange(now: Date, days: number = DAILY_DAYS): { start: string; end: string } {
  if (days < 1) throw new Error('days는 1 이상이다');
  const today = now.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });
  const shift = (ymd: string, n: number) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const end = shift(today, -1);
  return { start: shift(end, -(days - 1)), end };
}

const compact = (ymd: string) => ymd.replaceAll('-', '');

async function fetchAsos(key: string, start: string, end: string): Promise<AsosItem[]> {
  const items: AsosItem[] = [];
  for (let page = 1; ; page += 1) {
    const q = new URLSearchParams({
      serviceKey: key,
      pageNo: String(page),
      numOfRows: String(PAGE_SIZE),
      dataType: 'JSON',
      dataCd: 'ASOS',
      dateCd: 'DAY',
      stnIds: STATION_ID,
      startDt: compact(start),
      endDt: compact(end),
    });
    const body = (await weatherDeps.fetchJson(`${ASOS_URL}?${q}`)) as { response?: { body?: { totalCount?: number } } };
    const pageItems = itemsOf<AsosItem>(body);
    items.push(...pageItems);
    const total = Number(body.response?.body?.totalCount ?? items.length);
    if (pageItems.length === 0 || page * PAGE_SIZE >= total) return items;
  }
}

/** weather 테이블에 넣는다. 같은 날짜·지역은 새 값으로 덮어쓴다. 추가·갱신한 날 수를 돌려준다 */
export async function upsertWeather(db: Db, rows: WeatherRow[]): Promise<{ inserted: number; updated: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };
  const { rows: flags } = await db.query<{ inserted: boolean }>(
    `INSERT INTO weather (date, region, precipitation_mm, temp_avg, temp_max, is_heatwave)
     SELECT * FROM unnest($1::date[], $2::text[], $3::numeric[], $4::numeric[], $5::numeric[], $6::boolean[])
     ON CONFLICT (date, region) DO UPDATE SET
       precipitation_mm = EXCLUDED.precipitation_mm, temp_avg = EXCLUDED.temp_avg,
       temp_max = EXCLUDED.temp_max, is_heatwave = EXCLUDED.is_heatwave
     RETURNING (xmax = 0) AS inserted`,
    [
      rows.map((r) => r.date),
      rows.map((r) => r.region),
      rows.map((r) => r.precipitationMm),
      rows.map((r) => r.tempAvg),
      rows.map((r) => r.tempMax),
      rows.map((r) => r.isHeatwave),
    ],
  );
  const inserted = flags.filter((f) => f.inserted).length;
  return { inserted, updated: flags.length - inserted };
}

/**
 * 받을 기간: 기본은 어제까지 최근 days일. 최근 MAX_BACKFILL_DAYS일 안에 빈 날(firstMissing)이 있으면
 * 그 날부터 받는다(서버가 꺼져 있던 동안). 그보다 오래된 빈 날은 data/weather.py로 채운다.
 */
export function collectRange(now: Date, firstMissing: string | null, days: number = DAILY_DAYS): { start: string; end: string } {
  const recent = dailyRange(now, days);
  if (firstMissing === null || firstMissing >= recent.start) return recent;
  return { start: firstMissing, end: recent.end };
}

/** 어제까지 최근 days일(최근 31일 안에 빈 날이 있으면 그 날부터)을 받아 넣는다 */
export async function collectRecentWeather(
  db: Db,
  opts: { key: string; now?: Date; days?: number },
): Promise<{ start: string; end: string; inserted: number; updated: number; heatwaveDays: number }> {
  const now = opts.now ?? weatherDeps.now();
  const window = dailyRange(now, MAX_BACKFILL_DAYS);
  // 최근 31일 중 weather에 없는 가장 이른 날
  const { rows: gap } = await db.query<{ first: string | null }>(
    `SELECT to_char(min(d), 'YYYY-MM-DD') AS first
     FROM generate_series($1::date, $2::date, interval '1 day') AS d
     WHERE NOT EXISTS (SELECT 1 FROM weather w WHERE w.region = $3 AND w.date = d::date)`,
    [window.start, window.end, WEATHER_REGION],
  );
  const { start, end } = collectRange(now, gap[0]?.first ?? null, opts.days);
  const rows = (await fetchAsos(opts.key, start, end)).map(toWeatherRow);
  const result = await upsertWeather(db, rows);
  return { start, end, ...result, heatwaveDays: rows.filter((r) => r.isHeatwave).length };
}

/**
 * API 서버가 켜질 때 한 번, 그 뒤 intervalMs마다 최근 기상 일자료를 받는다. 멈추는 함수를 돌려준다.
 * KMA_SERVICE_KEY가 없으면 한 번 알리고 건너뛴다. 실패해도 서버는 계속 돈다. 로그에 인증키가 찍히지 않게 가린다.
 */
export function startWeatherDailyJob(intervalMs: number = DAILY_JOB_INTERVAL_MS, log: (msg: string) => void = console.log): () => void {
  const key = process.env.KMA_SERVICE_KEY;
  if (!key) {
    log('[기상 수집] KMA_SERVICE_KEY가 없어 기상 일자료 매일 수집을 건너뛴다.');
    return () => {};
  }
  const run = async () => {
    try {
      const r = await collectRecentWeather(getPool(), { key });
      log(`[기상 수집] ${r.start} ~ ${r.end}: 추가 ${r.inserted}일, 갱신 ${r.updated}일`);
    } catch (err) {
      log(`[기상 수집] 실패: ${String((err as Error).message).replaceAll(key, '***')}`);
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
