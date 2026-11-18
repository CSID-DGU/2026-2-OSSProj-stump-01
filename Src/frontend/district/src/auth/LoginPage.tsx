import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from './AuthContext';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { token, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      if (err instanceof ApiError && err.status === 401) setError('이메일 또는 비밀번호가 맞지 않습니다.');
      else setError(err instanceof Error ? err.message : '로그인하지 못했습니다.');
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
        <p className={styles.sub}>구청 담당자 계정은 운영자가 관리청과 함께 만듭니다.</p>
      </div>
    </main>
  );
}
