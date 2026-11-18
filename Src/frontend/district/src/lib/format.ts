// 화면에 보여 줄 값을 만드는 함수. 화면 코드와 분리해 두고 여러 화면에서 같이 쓴다.

const TIME_ZONE = 'Asia/Seoul'; // 백엔드와 같은 기준(한국 시간 달력)
const DAY_MS = 24 * 60 * 60 * 1000;

/** 지금 한국 시간 기준 'YYYY-MM' */
export function currentMonth(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE }).slice(0, 7);
}

/** 'YYYY-MM'에서 n달 더한 'YYYY-MM' (n이 음수면 이전 달) */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** '2026-11' → '2026년 11월' */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}년 ${m}월`;
}

/** 분 → '3시간 20분', '40분', '0분' */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/** 어떤 시각부터 지금까지 지난 날 수(한국 시간 날짜 기준). 같은 날이면 0 */
export function daysSince(iso: string, now = new Date()): number {
  const day = (d: Date) => Date.parse(d.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE }));
  return Math.max(0, Math.round((day(now) - day(new Date(iso))) / DAY_MS));
}

/** 오늘 날짜 '2026년 11월 16일 월요일' */
export function todayLabel(now = new Date()): string {
  return now.toLocaleDateString('ko-KR', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

/** 'YYYY-MM-DD' 또는 ISO 시각 → '2026년 11월 3일' (한국 시간) */
export function formatDate(value: string): string {
  const [y, m, d] = toKoreanDate(value).split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

/** 'YYYY-MM-DD' 또는 ISO 시각 → '11월 3일' (한국 시간) */
export function formatShortDate(value: string): string {
  const [, m, d] = toKoreanDate(value).split('-').map(Number);
  return `${m}월 ${d}일`;
}

/** ISO 시각 → '11월 3일 14:05' (한국 시간) */
export function formatDateTime(iso: string): string {
  const time = new Date(iso).toLocaleTimeString('ko-KR', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${formatShortDate(iso)} ${time}`;
}

/** 날짜만 있는 값('YYYY-MM-DD')은 그대로, 시각이 있으면 한국 시간 날짜로 바꾼다 */
function toKoreanDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });
}
