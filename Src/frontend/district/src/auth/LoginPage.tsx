import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from './AuthContext';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { token, login, loginWithToken } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [devToken, setDevToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (token) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('로그인 API가 아직 없습니다(#3). 아래 개발용 토큰으로 들어가세요.');
      } else {
        setError(err instanceof Error ? err.message : '로그인하지 못했습니다.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.box}>
        <div className={styles.brand}>
          <span className={styles.logo}>TreeCare 구청</span>
          <span className={styles.sub}>녹지 담당자용</span>
        </div>

        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.field}>
            <span>이메일</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className={styles.field}>
            <span>비밀번호</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button className={styles.primary} type="submit" disabled={busy}>
            {busy ? '확인 중…' : '로그인'}
          </button>
        </form>

        {/* 개발 서버(npm run dev)에서만 보인다. 배포 빌드에는 들어가지 않는다. */}
        {import.meta.env.DEV && (
          <details className={styles.dev}>
            <summary>개발용 토큰으로 들어가기</summary>
            <p>구청 담당자 토큰을 붙여 넣습니다. 만드는 방법은 Src/frontend/district/README.md에 있습니다.</p>
            <textarea rows={3} value={devToken} onChange={(e) => setDevToken(e.target.value)} aria-label="개발용 토큰" />
            <button type="button" disabled={!devToken.trim()} onClick={() => loginWithToken(devToken)}>
              토큰으로 들어가기
            </button>
          </details>
        )}
      </div>
    </main>
  );
}
