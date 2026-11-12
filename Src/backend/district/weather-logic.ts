// #72 오늘의 날씨 판단 로직 (기상청 응답 해석, 활동 추천 시간)
// 네트워크·DB 없이 시험할 수 있도록 순수 함수만 둔다. 기상청 호출은 weather.ts에 있다.

// ── 기준값 (구청 확인 전 임시값, #59) ──
export const HEATWAVE_MAX_TEMP = 33; // 일 최고기온 33℃ 이상이면 폭염
export const ACTIVITY_FIRST_HOUR = 6; // 활동을 추천하는 첫 시각(06시)
export const ACTIVITY_LAST_HOUR = 19; // 활동을 추천하는 마지막 시작 시각(19시 → 20시까지)
export const HEAT_AVOID_FROM = 11; // 폭염 날 피할 시간대 시작(11시)
export const HEAT_AVOID_UNTIL = 17; // 폭염 날 피할 시간대 끝(17시 전까지)
export const HOT_HOUR_TEMP = 31; // 그 시각 기온이 이 이상이면 추천하지 않는다
export const COLD_HOUR_TEMP = -5; // 그 시각 기온이 이 이하이면 추천하지 않는다
export const RAIN_POP_LIMIT = 60; // 강수확률(%)이 이 이상이면 추천하지 않는다
const WARNING_REGION = '서울'; // 특보 발효 지역에서 찾을 이름

// ── 좌표 → 기상청 격자 ──
// 기상청 단기예보는 위경도가 아니라 5km 격자(nx, ny)로 묻는다. 기상청이 공개한 람베르트 정각원추도법 변환식.
export function latLngToGrid(lat: number, lng: number): { nx: number; ny: number } {
  const RE = 6371.00877; // 지구 반경(km)
  const GRID = 5.0; // 격자 간격(km)
  const SLAT1 = 30.0; // 투영 위도1
  const SLAT2 = 60.0; // 투영 위도2
  const OLON = 126.0; // 기준점 경도
  const OLAT = 38.0; // 기준점 위도
  const XO = 43; // 기준점 X 격자
  const YO = 136; // 기준점 Y 격자
  const DEGRAD = Math.PI / 180.0;

  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

// ── 시간 ──
/** 한국 시간 기준 날짜·시각 */
export function kstParts(now: Date): { date: string; hour: number; minute: number } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: kst.toISOString().slice(0, 10), // YYYY-MM-DD
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes(),
  };
}

/**
 * 오늘 하루 전체(시간별 기온·일 최고/최저)가 들어 있는 단기예보 발표 시각을 고른다.
 * 02시 발표(02:10 이후 제공)에 오늘 0시~24시와 최고·최저기온이 모두 들어 있다. 그 전이면 어제 23시 발표를 쓴다.
 */
export function forecastBase(now: Date): { baseDate: string; baseTime: string } {
  const { date, hour, minute } = kstParts(now);
  if (hour > 2 || (hour === 2 && minute >= 15)) {
    return { baseDate: date.replaceAll('-', ''), baseTime: '0200' };
  }
  const yesterday = kstParts(new Date(now.getTime() - 24 * 60 * 60 * 1000)).date;
  return { baseDate: yesterday.replaceAll('-', ''), baseTime: '2300' };
}

// ── 단기예보 해석 ──
/** 기상청 단기예보 응답 항목 하나 (getVilageFcst) */
export type ForecastItem = { category: string; fcstDate: string; fcstTime: string; fcstValue: string };

export type HourlyWeather = {
  hour: number; // 0~23
  temp: number | null; // 기온(℃, TMP)
  pop: number | null; // 강수확률(%, POP)
  precipitationType: number; // 강수형태(PTY): 0 없음, 1 비, 2 비/눈, 3 눈, 4 소나기
  sky: number | null; // 하늘상태(SKY): 1 맑음, 3 구름많음, 4 흐림
};

/** 오늘(date: 'YYYY-MM-DD') 시간별 날씨와 일 최고·최저기온을 꺼낸다. 최고기온(TMX)이 없으면 시간별 기온 중 가장 높은 값을 쓴다. */
export function parseForecast(items: ForecastItem[], date: string) {
  const ymd = date.replaceAll('-', '');
  const byHour = new Map<number, HourlyWeather>();
  let tmx: number | null = null;
  let tmn: number | null = null;

  for (const it of items) {
    if (it.fcstDate !== ymd) continue;
    const hour = Number(it.fcstTime.slice(0, 2));
    const value = Number(it.fcstValue);
    const h = byHour.get(hour) ?? { hour, temp: null, pop: null, precipitationType: 0, sky: null };
    switch (it.category) {
      case 'TMP': h.temp = value; break;
      case 'POP': h.pop = value; break;
      case 'PTY': h.precipitationType = value; break;
      case 'SKY': h.sky = value; break;
      case 'TMX': tmx = value; break;
      case 'TMN': tmn = value; break;
    }
    byHour.set(hour, h);
  }

  const hourly = [...byHour.values()].sort((a, b) => a.hour - b.hour);
  const temps = hourly.map((h) => h.temp).filter((t): t is number => t !== null);
  return {
    hourly,
    tempMax: tmx ?? (temps.length ? Math.max(...temps) : null),
    tempMin: tmn ?? (temps.length ? Math.min(...temps) : null),
  };
}

// ── 기상특보 해석 ──
/**
 * 기상특보 발효 현황 문장(getPwnStatus의 t6)에서 서울에 내려진 특보 이름을 꺼낸다.
 * 형식: 한 줄에 "o 폭염경보 : 서울, 인천, 경기도(...)" (특보마다 한 줄)
 */
export function parseWarnings(statusText: string | null | undefined, region = WARNING_REGION): string[] {
  if (!statusText) return [];
  const names: string[] = [];
  for (const raw of statusText.split(/\r?\n/)) {
    const m = raw.trim().match(/^o\s*([^:]+?)\s*:\s*(.+)$/);
    if (!m) continue;
    const [, name, areas] = m;
    if (areas!.includes(region) && !names.includes(name!)) names.push(name!);
  }
  return names;
}

// ── 활동 추천 ──
export type TimeWindow = { start: string; end: string }; // 'HH:00'

/** 한 시각이 활동하기 괜찮은지 */
function isGoodHour(h: HourlyWeather, heat: boolean): boolean {
  if (h.hour < ACTIVITY_FIRST_HOUR || h.hour > ACTIVITY_LAST_HOUR) return false;
  if (heat && h.hour >= HEAT_AVOID_FROM && h.hour < HEAT_AVOID_UNTIL) return false;
  if (h.precipitationType !== 0) return false;
  if (h.pop !== null && h.pop >= RAIN_POP_LIMIT) return false;
  if (h.temp !== null && (h.temp >= HOT_HOUR_TEMP || h.temp <= COLD_HOUR_TEMP)) return false;
  return true;
}

const hh = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** 괜찮은 시각을 이어 붙여 시간대로 만든다. 예: 6·7·8시 → 06:00~09:00 */
export function recommendTimes(hourly: HourlyWeather[], heat: boolean): TimeWindow[] {
  const good = hourly.filter((h) => isGoodHour(h, heat)).map((h) => h.hour);
  const windows: TimeWindow[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const hour of good) {
    if (start === null) start = hour;
    else if (hour !== prev! + 1) {
      windows.push({ start: hh(start), end: hh(prev! + 1) });
      start = hour;
    }
    prev = hour;
  }
  if (start !== null) windows.push({ start: hh(start), end: hh(prev! + 1) });
  return windows;
}

/** 홈 화면 안내 문구 */
export function weatherMessage(opts: { heat: boolean; warnings: string[]; windows: TimeWindow[] }): string {
  if (opts.heat) {
    return opts.windows.length
      ? `폭염이에요. 낮(${HEAT_AVOID_FROM}~${HEAT_AVOID_UNTIL}시) 활동은 피하고 이른 아침이나 저녁에 짧게 돌봐 주세요.`
      : '폭염이에요. 오늘은 활동을 쉬어도 괜찮아요.';
  }
  if (!opts.windows.length) return '오늘은 활동하기 좋은 시간이 없어요. 쉬어도 괜찮아요.';
  if (opts.warnings.length) return `${opts.warnings.join(', ')} 중이에요. 안전을 먼저 챙겨 주세요.`;
  return '오늘 활동하기 좋은 시간이에요.';
}

/** 예보·특보로 오늘 요약을 만든다 */
export function summarizeToday(items: ForecastItem[], statusText: string | null, date: string) {
  const { hourly, tempMax, tempMin } = parseForecast(items, date);
  const warnings = parseWarnings(statusText);
  const isHeatwave = (tempMax !== null && tempMax >= HEATWAVE_MAX_TEMP) || warnings.some((w) => w.includes('폭염'));
  const recommendedTimes = recommendTimes(hourly, isHeatwave);
  return {
    date,
    tempMax,
    tempMin,
    isHeatwave,
    warnings,
    recommendedTimes,
    message: weatherMessage({ heat: isHeatwave, warnings, windows: recommendedTimes }),
    hourly,
  };
}
