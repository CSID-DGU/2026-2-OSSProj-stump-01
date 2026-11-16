// 로그인 상태(토큰)를 앱 전체에 나눠 준다.
// 토큰 발급(POST /auth/login)은 시민-BE 회원·인증(#3)이 만든다. 응답 형식이 확정되면 login()만 맞춘다.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from '../api/client';

type AuthValue = {
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string) => void; // 개발용: #3 전까지 직접 만든 토큰으로 들어간다
  logout: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());

  const save = useCallback((next: string | null) => {
    setToken(next);
    setTokenState(next);
  }, []);

  const logout = useCallback(() => save(null), [save]);

  // 어떤 요청이든 401(토큰 만료·잘못된 토큰)이 오면 로그아웃해서 로그인 화면으로 보낸다
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(
    async (email: string, password: string) => {
      // 가정: 응답이 { token }이다. #3 명세가 나오면 확인한다.
      const res = await api<{ token: string }>('/auth/login', { method: 'POST', body: { email, password } });
      save(res.token);
    },
    [save],
  );

  const value = useMemo<AuthValue>(
    () => ({ token, login, loginWithToken: (t) => save(t.trim()), logout }),
    [token, login, save, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Provider와 훅을 한 파일에 두는 흔한 구성이다. 개발 중 자동 새로고침(fast refresh)만 이 파일에서 전체 새로고침으로 바뀐다.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider 안에서만 쓴다');
  return value;
}
