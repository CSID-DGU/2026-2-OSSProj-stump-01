// #72 오늘의 날씨 API (시민 홈 화면용, 로그인 없음)
// 기상청 단기예보(오늘 시간별 기온·강수, 최고·최저기온)와 기상특보(서울 발효 현황)를 받아 활동 추천 시간을 정한다.
// ASOS 일자료는 전날까지만 있어서 오늘 날씨에는 쓸 수 없다(나이테용 일자료는 data/weather.py가 매일 적재).
// 인증키: Src/.env의 KMA_SERVICE_KEY. 공공데이터포털에서 단기예보·기상특보 조회서비스 활용 신청이 되어 있어야 한다.
import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../common/db.js';
import { HttpError, notFound } from '../common/errors.js';
import { forecastBase, kstParts, latLngToGrid, summarizeToday, type ForecastItem } from './weather-logic.js';

// ── 기준값 ──
const FORECAST_URL = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
const WARNING_URL = 'https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnStatus';
const CACHE_TTL_MS = 30 * 60 * 1000; // 같은 격자는 30분 동안 다시 묻지 않는다
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_LOCATION = { lat: 37.5665, lng: 126.978 }; // treeId가 없으면 서울시청 기준

// 테스트에서 기상청 호출을 가짜로 바꿀 수 있게 한곳에 둔다
export const weatherDeps = {
  fetchJson: async (url: string): Promise<unknown> => {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`기상청 응답 ${res.status}`);
    return res.json();
  },
  now: () => new Date(),
};

const cache = new Map<string, { expires: number; value: unknown }>();
export function clearWeatherCache() {
  cache.clear();
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

/** 공공데이터포털 공통 응답에서 항목 목록을 꺼낸다. 결과 코드가 00이 아니면 에러 */
function itemsOf<T>(body: any): T[] {
  const header = body?.response?.header;
  if (header?.resultCode === '03') return []; // NODATA_ERROR: 자료 없음(예: 발효 중인 특보 없음)
  if (header?.resultCode !== '00') throw new Error(`기상청 결과 코드 ${header?.resultCode} ${header?.resultMsg ?? ''}`);
  const item = body.response.body?.items?.item;
  return Array.isArray(item) ? item : item ? [item] : [];
}

function serviceKey(): string {
  const key = process.env.KMA_SERVICE_KEY;
  if (!key) throw new HttpError(503, 'WEATHER_UNAVAILABLE', '날씨 서비스 키가 설정되지 않았다(KMA_SERVICE_KEY).');
  return key;
}

async function loadForecast(nx: number, ny: number, baseDate: string, baseTime: string): Promise<ForecastItem[]> {
  const q = new URLSearchParams({
    serviceKey: serviceKey(),
    pageNo: '1',
    numOfRows: '1000', // 하루치 + 다음 날 일부가 한 번에 오도록 넉넉히
    dataType: 'JSON',
    base_date: baseDate,
    base_time: baseTime,
    nx: String(nx),
    ny: String(ny),
  });
  return itemsOf<ForecastItem>(await weatherDeps.fetchJson(`${FORECAST_URL}?${q}`));
}

async function loadWarningStatus(): Promise<string | null> {
  const q = new URLSearchParams({ serviceKey: serviceKey(), pageNo: '1', numOfRows: '10', dataType: 'JSON' });
  const items = itemsOf<{ t6?: string }>(await weatherDeps.fetchJson(`${WARNING_URL}?${q}`));
  return items[0]?.t6 ?? null; // t6: 특보 발효 현황
}

const query = z.object({ treeId: z.coerce.number().int().positive().optional() });

// ── 라우터 (/weather) ──
export const weatherRouter = Router();

weatherRouter.get('/today', async (req, res) => {
  const { treeId } = query.parse(req.query);

  let location = DEFAULT_LOCATION;
  if (treeId) {
    const { rows } = await getPool().query<{ lat: number; lng: number }>(
      'SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM trees WHERE id = $1',
      [treeId],
    );
    if (!rows[0]) throw notFound('나무를 찾을 수 없다.');
    location = rows[0];
  }

  const now = weatherDeps.now();
  const { nx, ny } = latLngToGrid(location.lat, location.lng);
  const { baseDate, baseTime } = forecastBase(now);

  let items: ForecastItem[];
  let warningText: string | null;
  try {
    [items, warningText] = await Promise.all([
      cached(`fcst:${nx}:${ny}:${baseDate}${baseTime}`, () => loadForecast(nx, ny, baseDate, baseTime)),
      cached(`warn:${kstParts(now).date}:${kstParts(now).hour}`, loadWarningStatus),
    ]);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('[weather]', err);
    throw new HttpError(503, 'WEATHER_UNAVAILABLE', '기상청 날씨 정보를 가져오지 못했다. 잠시 뒤 다시 시도한다.');
  }

  res.json({
    ...summarizeToday(items, warningText, kstParts(now).date),
    location: { treeId: treeId ?? null, nx, ny },
    forecastBase: `${baseDate} ${baseTime}`,
  });
});
