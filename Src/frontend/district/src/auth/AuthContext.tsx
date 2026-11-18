// 로그인 상태(토큰)를 앱 전체에 나눠 준다.
// 로그인 API(POST /auth/login, #3)는 시민·구청 담당자가 같이 쓴다. 구청 웹은 구청 담당자(officer)만 들어온다.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from '../api/client';

// openapi.yaml의 User·AuthResponse
export type User = {
  id: number;
  email: string;
  nickname: string;
  role: 'citizen' | 'officer';
  agency: string | null; // 구청 담당자의 소속 관리청
  educationCompleted: boolean;
};
type AuthResponse = { token: string; user: User };

/** 구청 담당자가 아닌 계정으로 로그인하려 할 때 */
export class NotOfficerError extends Error {
  constructor() {
    super('구청 담당자 계정이 아닙니다. 돌보미 계정은 시민 웹에서 로그인하세요.');
  }
}

type AuthValue = {
  token: string | null;
  user: User | null; // 토큰을 확인하기 전에는 null
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<User | null>(null);

  const save = useCallback((next: string | null, nextUser: User | null = null) => {
    setToken(next);
    setTokenState(next);
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => save(null), [save]);

  // 어떤 요청이든 401(토큰 만료·잘못된 토큰)이 오면 로그아웃해서 로그인 화면으로 보낸다
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // 저장해 둔 토큰으로 다시 열었을 때, 그 계정이 아직 구청 담당자인지 확인한다
  useEffect(() => {
    if (!token || user) return;
    let cancelled = false;
    api<User>('/auth/me')
      .then((me) => {
        if (cancelled) return;
        if (me.role === 'officer') setUser(me);
        else logout();
      })
      .catch(() => {
        // 401이면 위 핸들러가 로그아웃한다. 서버가 꺼져 있는 등 다른 에러는 각 화면이 보여 준다
      });
    return () => {
      cancelled = true;
    };
  }, [token, user, logout]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } });
      // 시민 계정 토큰은 저장하지 않는다. 구청 화면의 API가 모두 403으로 막히기 때문이다.
      if (res.user.role !== 'officer') throw new NotOfficerError();
      save(res.token, res.user);
    },
    [save],
  );

  const value = useMemo<AuthValue>(() => ({ token, user, login, logout }), [token, user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Provider와 훅을 한 파일에 두는 흔한 구성이다. 개발 중 자동 새로고침(fast refresh)만 이 파일에서 전체 새로고침으로 바뀐다.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider 안에서만 쓴다');
  return value;
}
