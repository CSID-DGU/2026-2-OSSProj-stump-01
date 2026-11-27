import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import IdentityVerify from '../components/IdentityVerify'
import TopBar from '../components/TopBar'
import { safeNext } from '../lib/safeNext'
import { ApiError } from '../lib/api'
import { signup, useAuth } from '../store/authStore'
import './AuthPages.css'

// 서버(openapi.yaml)와 같은 기준
const PASSWORD_MIN = 8
const PASSWORD_MAX = 72
const NICKNAME_MAX = 20
const ADDRESS_MAX = 200
const POSTAL_RE = /^\d{5}$/

// 회원가입 (시민 계정). 봉사시간이 본인에게 기록되도록 본인인증(이름·생년월일·휴대폰)을 하고 주소를 받는다.
// 이 정보가 프로필이 되고, 돌보미 신청서의 신청인 정보는 프로필에서 가져온다(다시 쓰지 않는다).
// 만 14세 이상만, 한 사람은 계정 하나만 만든다. 단체 초대 코드 연결(시안의 2단계)은 #83에서 더한다.
export default function SignupPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [identityToken, setIdentityToken] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [address, setAddress] = useState('')
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
    identityToken !== '' &&
    POSTAL_RE.test(postalCode.trim()) &&
    address.trim() !== '' &&
    agreed

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready) return
    setError('')
    setSending(true)
    try {
      await signup({ email: email.trim(), password, nickname: nickname.trim(), identityToken, postalCode: postalCode.trim(), address: address.trim() })
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
          <p className="body">본인인증한 이름·연락처와 주소는 돌보미 신청서에 그대로 쓰여서, 신청할 때 다시 적지 않아요.</p>
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

        <IdentityVerify onVerified={(token) => setIdentityToken(token)} />

        <div className={postalCode && !POSTAL_RE.test(postalCode.trim()) ? 'tc-field tc-field--error' : 'tc-field'}>
          <label className="tc-field__label" htmlFor="signup-postal">
            우편번호
          </label>
          <input
            id="signup-postal"
            className={postalCode ? 'tc-field__input is-filled' : 'tc-field__input'}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
          />
          {postalCode && !POSTAL_RE.test(postalCode.trim()) && <span className="tc-field__error">숫자 5자리로 써 주세요.</span>}
        </div>

        <div className="tc-field">
          <label className="tc-field__label" htmlFor="signup-address">
            주소
          </label>
          <input
            id="signup-address"
            className={address ? 'tc-field__input is-filled' : 'tc-field__input'}
            autoComplete="street-address"
            maxLength={ADDRESS_MAX}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <span className="tc-field__help">돌보미 신청서에 쓰여요. 이사하면 내 정보에서 고칠 수 있어요.</span>
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
    if (err.code === 'IDENTITY_IN_USE') return '이미 이 본인인증으로 가입한 계정이 있어요. 한 사람은 계정 하나만 쓸 수 있어요. 그 계정으로 로그인해 주세요.'
    if (err.code === 'UNDER_AGE') return '만 14세 이상만 가입할 수 있어요.'
    if (err.code === 'IDENTITY_INVALID') return '본인인증 시간이 지났어요. 본인인증을 다시 해 주세요.'
    if (err.status === 409) return '이미 가입한 이메일이에요. 로그인해 주세요.'
    if (err.status === 400) return `입력한 내용을 다시 확인해 주세요. (${err.message})`
    if (err.status === 0) return err.message
  }
  return '가입하지 못했어요. 잠시 뒤 다시 해 주세요.'
}
