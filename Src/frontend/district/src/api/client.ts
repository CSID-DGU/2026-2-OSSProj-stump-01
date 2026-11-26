// API 호출 공통 함수. 토큰을 붙이고, 에러 응답({ error: { code, message } })을 ApiError로 바꾼다.
// 각 화면은 fetch를 직접 쓰지 않고 이 함수를 쓴다.

const TOKEN_KEY = 'treecare.district.token';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 새로고침 때 다시 로그인한다
  }
}

// 401이 오면 로그인 화면으로 보내기 위해 AuthProvider가 등록한다
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

type Query = Record<string, string | number | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 실패 응답을 ApiError로 바꿔 던진다. 401이면 로그인 화면으로 보낸다 */
async function throwApiError(res: Response): Promise<never> {
  const data = await res.json().catch(() => null);
  if (res.status === 401) onUnauthorized?.();
  const err = data?.error;
  throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `요청에 실패했다 (${res.status})`);
}

export async function api<T>(
  path: string,
  options: { method?: string; query?: Query; body?: unknown } = {},
): Promise<T> {
  const headers = authHeaders();
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(withQuery(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) return throwApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => null)) as T;
}

/**
 * 파일 내려받기. 토큰이 필요해 <a href>로는 못 받으므로 fetch로 받아 브라우저 저장을 띄운다.
 * 파일 이름은 서버의 Content-Disposition을 따르고, 없으면 fallbackName을 쓴다.
 */
export async function apiDownload(path: string, query: Query, fallbackName: string): Promise<void> {
  const res = await fetch(withQuery(path, query), { headers: authHeaders() });
  if (!res.ok) return throwApiError(res);

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 클릭 직후 바로 해제하면 일부 브라우저에서 저장이 취소되어 조금 뒤에 해제한다
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
