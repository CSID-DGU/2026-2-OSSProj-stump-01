import { useState, type FormEvent } from 'react'
import IdentityVerify from '../components/IdentityVerify'
import TopBar from '../components/TopBar'
import { api, ApiError } from '../lib/api'
import { updateSignedInUser, useAuth } from '../store/authStore'
import './AuthPages.css'

const ADDRESS_MAX = 200
const POSTAL_RE = /^\d{5}$/

// 내 정보 (나 → 내 정보)
// - 이름·생년월일·휴대폰: 본인인증 결과라 여기서 고칠 수 없다. 휴대폰 번호가 바뀌면 본인인증을 다시 한다(가입한 사람과 같아야 함).
// - 주소: 본인이 고친다. 돌보미 신청서에는 신청할 때의 주소가 들어간다(이미 낸 신청서는 그대로).
// - 본인인증 기능 전에 만든 계정은 여기서 처음 본인인증을 한다.
export default function ProfilePage() {
  const auth = useAuth()
  const user = auth.status === 'signed-in' ? auth.user : null
  const [postalCode, setPostalCode] = useState(user?.profile.postalCode ?? '')
  const [address, setAddress] = useState(user?.profile.address ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [reverifying, setReverifying] = useState(false)

  if (!user) return null
  const { profile } = user
  const addressChanged = postalCode.trim() !== (profile.postalCode ?? '') || address.trim() !== (profile.address ?? '')
  const addressReady = POSTAL_RE.test(postalCode.trim()) && address.trim() !== ''

  async function saveAddress(e: FormEvent) {
    e.preventDefault()
    if (!addressReady || !addressChanged) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      updateSignedInUser(await api.updateMe({ postalCode: postalCode.trim(), address: address.trim() }))
      setMessage('주소를 고쳤어요. 앞으로 내는 신청서에 이 주소가 쓰여요.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '주소를 고치지 못했어요.')
    } finally {
      setSaving(false)
    }
  }

  async function reverify(identityToken: string) {
    setError('')
    setMessage('')
    try {
      updateSignedInUser(await api.reverifyIdentity(identityToken))
      setReverifying(false)
      setMessage('본인인증을 했어요.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IDENTITY_MISMATCH') setError('가입할 때 본인인증한 사람과 달라요. 계정은 본인만 쓸 수 있어요.')
      else if (err instanceof ApiError && err.code === 'IDENTITY_IN_USE') setError('이 본인인증으로 이미 가입한 다른 계정이 있어요. 그 계정으로 로그인해 주세요.')
      else if (err instanceof ApiError && err.code === 'UNDER_AGE') setError('만 14세 이상만 쓸 수 있어요.')
      else setError(err instanceof ApiError ? err.message : '본인인증을 하지 못했어요.')
    }
  }

  return (
    <div className="app-shell tc-screen">
      <TopBar title="내 정보" kind="back" />
      <div className="page auth-form">
        <section className="tc-field">
          <h2 className="tc-section-title">본인인증 정보</h2>
          {user.identityVerified ? (
            <>
              <ul className="tc-rows">
                <li className="tc-row">
                  <span>이름</span>
                  <span className="tc-row__value">{profile.realName}</span>
                </li>
                <li className="tc-row">
                  <span>생년월일</span>
                  <span className="tc-row__value">{profile.birthDate}</span>
                </li>
                <li className="tc-row">
                  <span>휴대폰</span>
                  <span className="tc-row__value">{profile.phone}</span>
                </li>
              </ul>
              <p className="micro profile-note">본인인증으로 확인한 정보라 직접 고칠 수 없어요. 봉사시간이 이 이름으로 기록돼요.</p>
              {reverifying ? (
                <IdentityVerify buttonLabel="본인인증하고 바꾸기" onVerified={(token) => reverify(token)} />
              ) : (
                <button type="button" className="tc-link tc-link--muted identity-again" onClick={() => setReverifying(true)}>
                  휴대폰 번호가 바뀌었어요 (본인인증 다시 하기)
                </button>
              )}
            </>
          ) : (
            <>
              <p className="body">아직 본인인증을 하지 않았어요. 돌보미 신청은 본인인증을 한 계정만 할 수 있어요.</p>
              <IdentityVerify onVerified={(token) => reverify(token)} />
            </>
          )}
        </section>

        <form className="tc-field" onSubmit={saveAddress} noValidate>
          <h2 className="tc-section-title">주소</h2>
          <div className={postalCode && !POSTAL_RE.test(postalCode.trim()) ? 'tc-field tc-field--error' : 'tc-field'}>
            <label className="tc-field__label" htmlFor="profile-postal">
              우편번호
            </label>
            <input
              id="profile-postal"
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
            <label className="tc-field__label" htmlFor="profile-address">
              주소
            </label>
            <input
              id="profile-address"
              className={address ? 'tc-field__input is-filled' : 'tc-field__input'}
              autoComplete="street-address"
              maxLength={ADDRESS_MAX}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <span className="tc-field__help">이미 낸 신청서의 주소는 바뀌지 않아요.</span>
          </div>
          <button className="tc-btn tc-btn--ink" type="submit" disabled={!addressReady || !addressChanged || saving}>
            {saving ? '저장하는 중' : '주소 저장'}
          </button>
        </form>

        {message && <p className="body">{message}</p>}
        {error && (
          <p className="tc-field__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
