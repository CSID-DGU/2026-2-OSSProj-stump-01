import { useState } from 'react'
import { api, ApiError, type IdentityInput } from '../lib/api'

// 본인인증 칸 (가입, 내 정보에서 다시 인증)
// 실제 휴대폰 본인인증은 인증 업체와 계약이 있어야 해서, 지금은 이름·생년월일·휴대폰을 넣으면 서버가
// 인증한 것처럼 거래 번호를 주는 개발용 가짜 인증이다(POST /auth/identity/mock). 실서비스에서는 이 자리에 인증 업체 창을 띄운다.
// 인증이 끝나면 onVerified(거래 번호, 인증한 값)를 부른다. 거래 번호는 10분 동안 쓸 수 있다.

const PHONE_RE = /^01\d-?\d{3,4}-?\d{4}$/

type Props = {
  onVerified: (identityToken: string, who: IdentityInput) => void
  buttonLabel?: string
}

export default function IdentityVerify({ onVerified, buttonLabel = '본인인증' }: Props) {
  const [name, setName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [phone, setPhone] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [verified, setVerified] = useState<IdentityInput | null>(null)

  if (verified) {
    return (
      <div className="tc-field">
        <span className="tc-field__label">본인인증</span>
        <p className="body identity-done">
          인증했어요 · {verified.name} · {verified.birthDate} · {verified.phone}
        </p>
        <button type="button" className="tc-link tc-link--muted identity-again" onClick={() => setVerified(null)}>
          다시 인증하기
        </button>
      </div>
    )
  }

  const ready = name.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && PHONE_RE.test(phone.trim())

  async function verify() {
    if (!ready) return
    setError('')
    setSending(true)
    try {
      const who = { name: name.trim(), birthDate, phone: phone.trim() }
      const { identityToken } = await api.mockIdentity(who)
      setVerified(who)
      onVerified(identityToken, who)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '본인인증을 하지 못했어요. 잠시 뒤 다시 해 주세요.')
    } finally {
      setSending(false)
    }
  }

  return (
    <fieldset className="identity-box">
      <legend className="tc-field__label">본인인증</legend>
      <p className="micro identity-note">
        봉사시간을 본인에게 기록하려고 본인인증을 해요. 지금은 개발용 인증이라 실제 문자는 가지 않아요. 주민등록번호는 받지 않아요.
      </p>
      <div className="tc-field">
        <label className="tc-field__label" htmlFor="identity-name">
          이름
        </label>
        <input id="identity-name" className={name ? 'tc-field__input is-filled' : 'tc-field__input'} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="tc-field">
        <label className="tc-field__label" htmlFor="identity-birth">
          생년월일
        </label>
        <input id="identity-birth" className={birthDate ? 'tc-field__input is-filled' : 'tc-field__input'} type="date" autoComplete="bday" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
      </div>
      <div className={phone && !PHONE_RE.test(phone.trim()) ? 'tc-field tc-field--error' : 'tc-field'}>
        <label className="tc-field__label" htmlFor="identity-phone">
          휴대폰 번호
        </label>
        <input
          id="identity-phone"
          className={phone ? 'tc-field__input is-filled' : 'tc-field__input'}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="010-1234-5678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {phone && !PHONE_RE.test(phone.trim()) && <span className="tc-field__error">휴대폰 번호 형식으로 써 주세요. 예: 010-1234-5678</span>}
      </div>
      {error && (
        <p className="tc-field__error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="tc-btn tc-btn--ink" disabled={!ready || sending} onClick={verify}>
        {sending ? '인증하는 중' : buttonLabel}
      </button>
    </fieldset>
  )
}
