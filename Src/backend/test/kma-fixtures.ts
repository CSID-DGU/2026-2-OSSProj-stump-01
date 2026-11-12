// 기상청 단기예보·특보 응답 모양의 테스트 데이터
import type { ForecastItem } from '../district/weather-logic.js';

type Hour = { temp: number; pop?: number; pty?: number; sky?: number };

/** date('YYYY-MM-DD')의 시간별 예보 항목. hours[h]가 없으면 기본값(기온 20℃, 강수확률 10%) */
export function forecastItems(date: string, hours: Partial<Record<number, Hour>> = {}, extra: { tmx?: number; tmn?: number } = {}): ForecastItem[] {
  const ymd = date.replaceAll('-', '');
  const items: ForecastItem[] = [];
  for (let h = 0; h < 24; h++) {
    const v = hours[h] ?? { temp: 20 };
    const t = `${String(h).padStart(2, '0')}00`;
    items.push({ category: 'TMP', fcstDate: ymd, fcstTime: t, fcstValue: String(v.temp) });
    items.push({ category: 'POP', fcstDate: ymd, fcstTime: t, fcstValue: String(v.pop ?? 10) });
    items.push({ category: 'PTY', fcstDate: ymd, fcstTime: t, fcstValue: String(v.pty ?? 0) });
    items.push({ category: 'SKY', fcstDate: ymd, fcstTime: t, fcstValue: String(v.sky ?? 1) });
  }
  if (extra.tmx !== undefined) items.push({ category: 'TMX', fcstDate: ymd, fcstTime: '1500', fcstValue: String(extra.tmx) });
  if (extra.tmn !== undefined) items.push({ category: 'TMN', fcstDate: ymd, fcstTime: '0600', fcstValue: String(extra.tmn) });
  // 다음 날 항목도 섞여 온다
  items.push({ category: 'TMP', fcstDate: '29991231', fcstTime: '0000', fcstValue: '99' });
  return items;
}

export const kmaOk = (items: unknown[]) => ({
  response: { header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' }, body: { items: { item: items } } },
});
export const kmaNoData = { response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } };
