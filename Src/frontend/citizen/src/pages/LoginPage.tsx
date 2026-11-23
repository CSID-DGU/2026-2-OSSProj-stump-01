import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { safeNext } from '../lib/safeNext'
import { ApiError } from '../lib/api'
import { OfficerAccountError, login, useAuth } from '../store/authStore'
import './AuthPages.css'

// 로그인 (시민 계정). 로그인하면 원래 가려던 화면(?next=)으로 돌아간다.
export default function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  // 이미 로그인했으면 바로 보낸다
  if (auth.status === 'signed-in') return <Navigate to={next} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      await login(email.trim(), password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(loginErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  const ready = email.trim() !== '' && password !== ''

  return (
    <div className="app-shell tc-screen">
      <form className="page auth-form" onSubmit={submit} noValidate>
        <div className="auth-brand display-xl">TreeCare</div>
        <div className="page-title">
          <h1 className="display">로그인</h1>
          <p className="body">가로수 한 그루와 시민 한 명을 잇는 돌봄 서비스예요.</p>
        </div>

        <div className="tc-field">
          <label className="tc-field__label" htmlFor="login-email">
            이메일
          </label>
          <input
            id="login-email"
            className={email ? 'tc-field__input is-filled' : 'tc-field__input'}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="tc-field">
          <label className="tc-field__label" htmlFor="login-password">
            비밀번호
          </label>
          <input
            id="login-password"
            className={password ? 'tc-field__input is-filled' : 'tc-field__input'}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p className="tc-field__error" role="alert">
            {error}
          </p>
        )}

        <div className="page-bottom">
          <button className="tc-btn tc-btn--primary" type="submit" disabled={!ready || sending}>
            {sending ? '로그인하는 중' : '로그인'}
          </button>
          <Link className="tc-link auth-switch" to={`/signup${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}>
            처음이에요 · 회원가입
          </Link>
        </div>
      </form>
    </div>
  )
}

function loginErrorMessage(err: unknown): string {
  if (err instanceof OfficerAccountError) return err.message
  if (err instanceof ApiError) {
    if (err.status === 401) return '이메일이나 비밀번호가 맞지 않아요. 다시 확인해 주세요.'
    if (err.status === 0) return err.message
    if (err.status === 400) return '이메일과 비밀번호를 모두 입력해 주세요.'
  }
  return '로그인하지 못했어요. 잠시 뒤 다시 해 주세요.'
}
