import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import TopBar from '../components/TopBar'
import ChoiceGroup from '../components/ChoiceGroup'
import {
  ADDRESS_MAX,
  HEADCOUNT_MAX,
  LONG_TEXT_MAX,
  MAX_TREES,
  MOTIVATION_MAX,
  NAME_MAX,
  PARTICIPATION_NOTICE,
  PARTICIPATION_TYPES,
  PERIOD_YEARS,
  participationLabel,
  type ParticipationType,
} from '../content/applicationForm'
import { api, ApiError, type MyApplication } from '../lib/api'
import { formatLongDate, periodEndOf, todayKey } from '../lib/date'
import { clearCart, removeFromCart, useApplyCart } from '../store/applyCart'
import './ApplyPages.css'

// 서버와 같은 형식 검사
const PHONE_RE = /^0\d{1,2}-?\d{3,4}-?\d{4}$/
const POSTAL_RE = /^\d{5}$/

// 서버 오류의 칸 이름 → 화면 칸 이름
const FIELD_LABEL: Record<string, string> = {
  treeIds: '돌볼 나무',
  periodStart: '시작일',
  applicantName: '신청인',
  contactPerson: '담당자',
  headcount: '인원',
  postalCode: '우편번호',
  address: '주소',
  phone: '연락처',
  participationType: '참여 유형',
  motivation: '신청 사유',
  activityPlan: '활동 계획',
  organizationIntro: '단체 소개',
  agreed: '안내 사항 동의',
}

// 돌보미 신청서 (#40)
// 지도에서 담은 나무로 구청 「나무돌보미 신청서」 양식을 채워 낸다. 나무마다 신청서가 하나씩 생기고 구청이 그루마다 심사한다.
export default function ApplyPage() {
  const cart = useApplyCart()
  const today = todayKey()

  const [type, setType] = useState<ParticipationType[]>(['individual'])
  const [periodStart, setPeriodStart] = useState(today)
  const [applicantName, setApplicantName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [headcount, setHeadcount] = useState('1')
  const [phone, setPhone] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [address, setAddress] = useState('')
  const [motivation, setMotivation] = useState('')
  const [activityPlan, setActivityPlan] = useState('')
  const [organizationIntro, setOrganizationIntro] = useState('')
  const [agreed, setAgreed] = useState(false)

  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<MyApplication[] | null>(null)

  const isGroup = type[0] !== 'individual' // 기업·단체면 담당자·단체 소개 칸이 생긴다
  const count = Number(headcount)

  // 아직 안 채운 것 (제출 버튼 위에 알려 준다)
  const missing: string[] = []
  if (cart.length === 0) missing.push('돌볼 나무')
  if (!periodStart || periodStart < today) missing.push('시작일')
  if (!applicantName.trim()) missing.push(isGroup ? '단체명' : '신청인 성명')
  if (isGroup && !contactPerson.trim()) missing.push('담당자')
  if (!Number.isInteger(count) || count < 1 || count > HEADCOUNT_MAX) missing.push('인원')
  if (!PHONE_RE.test(phone.trim())) missing.push('연락처')
  if (!POSTAL_RE.test(postalCode.trim())) missing.push('우편번호')
  if (!address.trim()) missing.push('주소')
  if (!motivation.trim()) missing.push('신청 사유')
  if (!activityPlan.trim()) missing.push('활동 계획')
  if (!agreed) missing.push('안내 사항 동의')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (missing.length > 0) return
    setError('')
    setSending(true)
    try {
      const res = await api.apply({
        treeIds: cart.map((t) => t.id),
        periodStart,
        applicantName: applicantName.trim(),
        contactPerson: isGroup ? contactPerson.trim() : null,
        headcount: count,
        postalCode: postalCode.trim(),
        address: address.trim(),
        phone: phone.trim(),
        participationType: type[0],
        motivation: motivation.trim(),
        activityPlan: activityPlan.trim(),
        organizationIntro: isGroup && organizationIntro.trim() ? organizationIntro.trim() : null,
        agreed: true,
      })
      clearCart()
      setDone(res.applications)
      window.scrollTo(0, 0)
    } catch (err) {
      setError(applyErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  // 제출 완료
  if (done) {
    return (
      <div className="app-shell tc-screen">
        <TopBar title="돌보미 신청" kind="close" />
        <div className="page">
          <div className="page-title">
            <h1 className="display">신청서를 냈어요</h1>
            <p className="body">
              나무 {done.length}그루의 신청서가 관리청 담당자에게 갔어요. 심사 결과는 알림으로 알려 드려요.
            </p>
          </div>
          <ul className="tc-rows apply-list">
            {done.map((a) => (
              <li key={a.id} className="tc-row">
                <span className="tc-tree__name">
                  {a.tree.name}
                </span>
                <span className="tc-status tc-status--wait">심사 대기</span>
              </li>
            ))}
          </ul>
          <div className="page-bottom">
            <Link className="tc-btn tc-btn--primary" to="/applications" replace>
              내 신청 현황 보기
            </Link>
            <Link className="tc-link tc-link--muted apply-secondary" to="/" replace>
              홈으로
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell tc-screen">
      <TopBar title="돌보미 신청" kind="close" />
      <form className="page apply-form" onSubmit={submit} noValidate>
        <div className="page-title">
          <h1 className="display">돌보미 신청서</h1>
          <p className="body">구청 나무돌보미 신청서 양식이에요. 승인되면 그 나무의 돌보미로 활동할 수 있어요.</p>
        </div>

        {/* 1. 돌볼 나무 */}
        <Section title="돌볼 나무" note={`한 번에 ${MAX_TREES}그루까지 신청할 수 있어요. 나무마다 따로 심사해요.`}>
          {cart.length === 0 ? (
            <p className="body apply-muted">아직 담은 나무가 없어요. 지도에서 나무를 누르고 "돌보미 신청할 나무로 담기"를 눌러 주세요.</p>
          ) : (
            <ul className="tc-rows apply-list">
              {cart.map((t) => (
                <li key={t.id} className="tc-row">
                  <span className="apply-tree">
                    <span className="tc-tree__name">
                      {t.name}
                    </span>
                    <span className="tc-tree__meta">{t.code ?? t.district}</span>
                  </span>
                  <button type="button" className="tc-link tc-link--muted apply-remove" onClick={() => removeFromCart(t.id)}>
                    빼기
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link className="tc-link apply-more" to="/map">
            {cart.length === 0 ? '지도에서 나무 고르기' : '지도에서 더 고르기'}
          </Link>
        </Section>

        {/* 2. 활동 기간 */}
        <Section title="활동 기간" note={`${PERIOD_YEARS}년이 기본이에요. 끝나는 날은 시작일에 맞춰 정해져요.`}>
          <div className="tc-field">
            <label className="tc-field__label" htmlFor="apply-start">
              시작일
            </label>
            <input
              id="apply-start"
              className="tc-field__input is-filled"
              type="date"
              min={today}
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
            {periodStart && periodStart >= today && (
              <span className="tc-field__help">
                {formatLongDate(periodStart)} ~ {formatLongDate(periodEndOf(periodStart, PERIOD_YEARS))}
              </span>
            )}
          </div>
        </Section>

        {/* 3. 신청인 */}
        <Section title="신청인" note="심사와 연락에만 쓰이고 관리청 담당자만 볼 수 있어요.">
          <ChoiceGroup
            label="참여 유형"
            options={PARTICIPATION_TYPES.map((t) => t.code)}
            selected={type}
            onChange={(next) => next.length > 0 && setType(next)}
            format={participationLabel}
          />
          <TextInput id="apply-name" label={isGroup ? '단체명' : '신청인 성명'} value={applicantName} onChange={setApplicantName} max={NAME_MAX} autoComplete={isGroup ? 'organization' : 'name'} />
          {isGroup && (
            <TextInput id="apply-contact" label="담당 부서와 담당자" value={contactPerson} onChange={setContactPerson} max={NAME_MAX} placeholder="예: 사회공헌팀 김양우" />
          )}
          <TextInput id="apply-headcount" label="인원" value={headcount} onChange={setHeadcount} type="number" inputMode="numeric" help={`함께 활동할 사람 수 (최대 ${HEADCOUNT_MAX}명)`} />
          <TextInput
            id="apply-phone"
            label="연락처"
            value={phone}
            onChange={setPhone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="010-1234-5678"
            problem={phone && !PHONE_RE.test(phone.trim()) ? '전화번호 형식으로 써 주세요. 예: 010-1234-5678' : ''}
          />
          <TextInput
            id="apply-postal"
            label="우편번호"
            value={postalCode}
            onChange={setPostalCode}
            inputMode="numeric"
            autoComplete="postal-code"
            max={5}
            problem={postalCode && !POSTAL_RE.test(postalCode.trim()) ? '숫자 5자리로 써 주세요.' : ''}
          />
          <TextInput id="apply-address" label="주소" value={address} onChange={setAddress} max={ADDRESS_MAX} autoComplete="street-address" />
        </Section>

        {/* 4. 신청 내용 */}
        <Section title="신청 내용">
          <TextArea id="apply-motivation" label="신청 사유" value={motivation} onChange={setMotivation} max={MOTIVATION_MAX} placeholder="출근길에 매일 보는 나무라서 돌보고 싶어요" />
          <TextArea id="apply-plan" label="활동 계획" value={activityPlan} onChange={setActivityPlan} max={LONG_TEXT_MAX} placeholder="주 2회 아침에 보호틀을 정리하고 주변 쓰레기를 주워요" />
          {isGroup && (
            <TextArea id="apply-intro" label="단체 소개 (선택)" value={organizationIntro} onChange={setOrganizationIntro} max={LONG_TEXT_MAX} />
          )}
        </Section>

        {/* 5. 안내 사항 동의 */}
        <Section title="참여 안내">
          <ul className="apply-notice body">
            {PARTICIPATION_NOTICE.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <label className="tc-check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>위 안내 사항을 읽고 동의합니다.</span>
          </label>
        </Section>

        {error && (
          <p className="tc-field__error" role="alert">
            {error}
          </p>
        )}

        <div className="page-bottom">
          {missing.length > 0 && <p className="micro apply-muted apply-center">아직 안 채운 것: {missing.join(', ')}</p>}
          <button className="tc-btn tc-btn--primary" type="submit" disabled={missing.length > 0 || sending}>
            {sending ? '내는 중' : `신청서 내기${cart.length > 0 ? ` (${cart.length}그루)` : ''}`}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---- 이 화면에서만 쓰는 작은 부품 ----

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="apply-section">
      <div className="apply-section__head">
        <h2 className="tc-section-title">{title}</h2>
        {note && <p className="micro apply-muted">{note}</p>}
      </div>
      {children}
    </section>
  )
}

type TextInputProps = {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  max?: number
  type?: 'text' | 'tel' | 'number'
  inputMode?: 'text' | 'tel' | 'numeric'
  autoComplete?: string
  placeholder?: string
  help?: string
  problem?: string // 형식 오류 (빨간 글씨)
}

function TextInput({ id, label, value, onChange, max, type = 'text', inputMode, autoComplete, placeholder, help, problem }: TextInputProps) {
  return (
    <div className={problem ? 'tc-field tc-field--error' : 'tc-field'}>
      <label className="tc-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={value ? 'tc-field__input is-filled' : 'tc-field__input'}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={max}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {problem ? <span className="tc-field__error">{problem}</span> : help && <span className="tc-field__help">{help}</span>}
    </div>
  )
}

function TextArea({ id, label, value, onChange, max, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; max: number; placeholder?: string }) {
  return (
    <div className="tc-field">
      <label className="tc-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={value ? 'tc-field__input is-filled' : 'tc-field__input'}
        maxLength={max}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="tc-field__count">
        {value.length}/{max}
      </span>
    </div>
  )
}

function applyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return '이미 심사 대기 중이거나 승인된 나무가 섞여 있어요. 그 나무를 빼고 다시 내 주세요. (내 신청 현황에서 확인할 수 있어요)'
    if (err.status === 403) return '시민 계정만 신청할 수 있어요.'
    if (err.status === 400 && err.issues.length > 0) {
      const fields = [...new Set(err.issues.map((i) => FIELD_LABEL[String(i.path[0])] ?? String(i.path[0])))]
      return `다시 확인해 주세요: ${fields.join(', ')}`
    }
    if (err.status === 0) return err.message
  }
  return '신청서를 내지 못했어요. 잠시 뒤 다시 해 주세요.'
}
