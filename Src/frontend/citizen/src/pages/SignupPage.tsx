import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import TopBar from '../components/TopBar'
import { safeNext } from '../lib/safeNext'
import { ApiError } from '../lib/api'
import { signup, useAuth } from '../store/authStore'
import './AuthPages.css'

// 서버(openapi.yaml)와 같은 기준
const PASSWORD_MIN = 8
const PASSWORD_MAX = 72
const NICKNAME_MAX = 20

// 회원가입 (시민 계정). 실명·연락처는 받지 않는다. 돌보미 신청서(#40)에서 따로 받는다.
// 단체 초대 코드 연결(시안의 2단계)은 #83에서 더한다.
export default function SignupPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [touched, setTouched] = useState({ email: false, password: false })

  if (auth.status === 'signed-in') return <Navigate to={next} replace />

  // 입력 칸 아래에 바로 알려 주는 문제
  const emailProblem = touched.email && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? '이메일 형식이 맞지 않아요. 예: name@example.com' : ''
  const passwordProblem =
    touched.password && password && password.length < PASSWORD_MIN ? `${PASSWORD_MIN}자 이상으로 써 주세요. 지금 ${password.length}자예요.` : ''

  const ready =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    password.length >= PASSWORD_MIN &&
    password.length <= PASSWORD_MAX &&
    nickname.trim() !== '' &&
    agreed

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready) return
    setError('')
    setSending(true)
    try {
      await signup(email.trim(), password, nickname.trim())
      navigate(next, { replace: true })
    } catch (err) {
      setError(signupErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="app-shell tc-screen">
      <TopBar title="회원가입" kind="close" />
      <form className="page auth-form" onSubmit={submit} noValidate>
        <div className="page-title">
          <h1 className="display">계정을 만들어요</h1>
          <p className="body">돌보미 신청에 필요한 실명과 연락처는 나중에 신청할 때 따로 받아요.</p>
        </div>

        <div className={emailProblem ? 'tc-field tc-field--error' : 'tc-field'}>
          <label className="tc-field__label" htmlFor="signup-email">
            이메일
          </label>
          <input
            id="signup-email"
            className={email ? 'tc-field__input is-filled' : 'tc-field__input'}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          />
          {emailProblem && <span className="tc-field__error">{emailProblem}</span>}
        </div>

        <div className={passwordProblem ? 'tc-field tc-field--error' : 'tc-field'}>
          <label className="tc-field__label" htmlFor="signup-password">
            비밀번호
          </label>
          <input
            id="signup-password"
            className={password ? 'tc-field__input is-filled' : 'tc-field__input'}
            type="password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            placeholder={`${PASSWORD_MIN}자 이상`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          />
          {passwordProblem ? (
            <span className="tc-field__error">{passwordProblem}</span>
          ) : (
            <span className="tc-field__help">
              {PASSWORD_MIN}자 이상 {PASSWORD_MAX}자 이하로 써 주세요.
            </span>
          )}
        </div>

        <div className="tc-field">
          <label className="tc-field__label" htmlFor="signup-nickname">
            활동 이름
          </label>
          <input
            id="signup-nickname"
            className={nickname ? 'tc-field__input is-filled' : 'tc-field__input'}
            type="text"
            autoComplete="nickname"
            maxLength={NICKNAME_MAX}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <span className="tc-field__help">이야기와 응답에 이 이름이 보여요. {NICKNAME_MAX}자까지 쓸 수 있어요.</span>
        </div>

        <label className="tc-check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>이용약관과 개인정보 처리방침에 동의합니다.</span>
        </label>

        {error && (
          <p className="tc-field__error" role="alert">
            {error}
          </p>
        )}

        <div className="page-bottom">
          <button className="tc-btn tc-btn--ink" type="submit" disabled={!ready || sending}>
            {sending ? '가입하는 중' : '가입하기'}
          </button>
          <Link className="tc-link tc-link--muted auth-switch" to={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} replace>
            이미 계정이 있어요
          </Link>
        </div>
      </form>
    </div>
  )
}

function signupErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return '이미 가입한 이메일이에요. 로그인해 주세요.'
    if (err.status === 400) return `입력한 내용을 다시 확인해 주세요. (${err.message})`
    if (err.status === 0) return err.message
  }
  return '가입하지 못했어요. 잠시 뒤 다시 해 주세요.'
}
