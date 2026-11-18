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

export async function api<T>(
  path: string,
  options: { method?: string; query?: Query; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(withQuery(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `요청에 실패했다 (${res.status})`);
  }
  return data as T;
}
