import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import TopBar from '../components/TopBar'
import Calendar from '../components/Calendar'
import { currentMonthKey, formatMonth, formatShortDate, shiftMonth } from '../lib/date'
import { formatMinutes } from '../content/recordOptions'
import { REPORT_STATUS_LABEL } from '../content/reportForm'
import { api, ApiError, type MonthlyReportDraft, type MyMonthlyReport, type ReportFieldKey } from '../lib/api'
import './ReportPages.css'

// 보고서를 쓸 수 있는 가장 이른 달 (몇 달 전까지 거슬러 갈 수 있는지). 임시값
const MONTHS_BACK = 3

type Step = 'pick' | 'preview' | 'done'

// 월간 보고서 작성·제출 (#80, API #62)
// ① 기록이 있는 날짜 고르기(GET /monthly-reports/dates) → ② 구청 양식 순서로 채운 미리보기(GET /monthly-reports/draft) → ③ 제출(POST /monthly-reports)
// 고를 수 있는 날·양식 칸·합계·관리청 검사는 모두 서버가 한다.
export default function ReportWritePage() {
  const thisMonth = currentMonthKey()
  const [month, setMonth] = useState(thisMonth)
  const [dates, setDates] = useState<{ month: string; open: Set<string>; submitted: Set<string> } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [step, setStep] = useState<Step>('pick')
  const [draft, setDraft] = useState<MonthlyReportDraft | null>(null)
  const [submitted, setSubmitted] = useState<MyMonthlyReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 달이 바뀌면 그 달의 날짜를 받아 온다
  useEffect(() => {
    let alive = true
    api
      .reportDates(month)
      .then((r) => {
        if (alive) setDates({ month: r.month, open: new Set(r.openDates), submitted: new Set(r.submittedDates) })
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiError ? e.message : '날짜를 불러오지 못했어요.')
      })
    return () => {
      alive = false
    }
  }, [month])

  const open = dates?.month === month ? dates.open : new Set<string>()
  const done = dates?.month === month ? dates.submitted : new Set<string>()

  function changeMonth(delta: number) {
    setMonth(shiftMonth(month, delta))
    setSelected(new Set()) // 보고서 하나는 한 달 것만 담는다
    setError('')
  }

  function toggle(date: string) {
    const next = new Set(selected)
    if (next.has(date)) next.delete(date)
    else next.add(date)
    setSelected(next)
  }

  async function preview() {
    setBusy(true)
    setError('')
    try {
      setDraft(await api.reportDraft([...selected].sort()))
      setStep('preview')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '미리보기를 만들지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      setSubmitted(await api.submitReport(draft.dates))
      setStep('done')
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? '보고서를 낼 수 없어요. 이미 낸 날이 섞였거나 관리청이 다른 나무가 섞였는지 확인해 주세요.' : '보고서를 내지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  // ③ 제출 완료
  if (step === 'done' && submitted) {
    return (
      <div className="app-shell tc-screen">
        <TopBar title="월간 보고서" kind="close" />
        <div className="page">
          <div className="page-title">
            <h1 className="display">보고서를 냈어요</h1>
            <p className="body">
              {submitted.agency} 담당자가 검토해요. 승인되면 활동 시간 {formatMinutes(submitted.totalMinutes)}이 봉사시간으로 기록되고, 결과는 알림으로 알려 드려요.
            </p>
          </div>
          <div className="tc-rows">
            <div className="tc-row">
              <span>상태</span>
              <span className="tc-status tc-status--wait">{REPORT_STATUS_LABEL[submitted.status]}</span>
            </div>
            <div className="tc-row">
              <span>보고서</span>
              <span className="tc-row__value">
                {formatMonth(month)} · {submitted.dates.length}일 · 기록 {submitted.recordCount}건
              </span>
            </div>
            <div className="tc-row">
              <span>활동 시간 합계</span>
              <span className="tc-row__value">{formatMinutes(submitted.totalMinutes)}</span>
            </div>
          </div>
          <div className="page-bottom">
            <Link className="tc-btn tc-btn--primary" to="/volunteer-hours" replace>
              내 봉사시간 보기
            </Link>
            <Link className="tc-link tc-link--muted report-secondary" to="/" replace>
              홈으로
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ② 미리보기
  if (step === 'preview' && draft) {
    const multipleAgencies = draft.agencies.length > 1
    return (
      <div className="app-shell tc-screen">
        <TopBar title="월간 보고서" kind="back" aside="2 / 2" onLeft={() => setStep('pick')} />
        <div className="page">
          <div className="page-title">
            <h1 className="display">{Number(month.slice(5))}월 보고서 미리보기</h1>
            <p className="body">고른 날의 기록을 구청 양식 순서로 채웠어요. 확인하고 내 주세요.</p>
          </div>

          <div className="tc-rows">
            <div className="tc-row">
              <span>내는 곳</span>
              <span className="tc-row__value">{draft.agencies.join(', ')}</span>
            </div>
            <div className="tc-row">
              <span>날짜</span>
              <span className="tc-row__value">
                {draft.dates.length}일 ({draft.dates.map(formatShortDate).join(', ')})
              </span>
            </div>
            <div className="tc-row">
              <span>기록</span>
              <span className="tc-row__value">
                {draft.rows.length}건 · 나무 {draft.treeCount}그루
              </span>
            </div>
            <div className="tc-row">
              <span>활동 시간 합계</span>
              <span className="tc-row__value">{formatMinutes(draft.totalMinutes)}</span>
            </div>
          </div>

          <ol className="report-entries">
            {draft.rows.map((row) => (
              <li key={row.recordId} className="report-entry">
                <dl>
                  {draft.fields.map((field) => (
                    <div key={field.key} className="report-entry__field">
                      <dt>{field.label}</dt>
                      <dd>{fieldValue(field.key, row.values[field.key])}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ol>

          {error && (
            <p className="tc-field__error" role="alert">
              {error}
            </p>
          )}

          <div className="page-bottom">
            {multipleAgencies ? (
              <p className="tc-field__error report-hint">관리청이 다른 나무가 섞여 있어요. 보고서는 관리청마다 따로 내야 해서, 한 관리청 나무의 날짜만 골라 주세요.</p>
            ) : (
              <p className="micro report-hint">내고 나면 고른 날은 다시 고를 수 없어요.</p>
            )}
            <button className="tc-btn tc-btn--primary" type="button" disabled={multipleAgencies || busy} onClick={submit}>
              {busy ? '내는 중' : '보고서 내기'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ① 날짜 고르기
  const earliest = shiftMonth(thisMonth, -MONTHS_BACK)
  const loading = dates?.month !== month
  return (
    <div className="app-shell tc-screen">
      <TopBar title="월간 보고서" kind="close" aside="1 / 2" />
      <div className="page">
        <div className="page-title">
          <h1 className="display">보고서에 넣을 날을 골라요</h1>
          <p className="body">기록이 있는 날만 고를 수 있어요. 이미 낸 날은 다시 고를 수 없어요.</p>
        </div>

        <div className="tc-month-nav">
          <button type="button" aria-label="이전 달" disabled={month <= earliest} onClick={() => changeMonth(-1)}>
            ‹
          </button>
          <span className="tc-month-nav__label">{formatMonth(month)}</span>
          <button type="button" aria-label="다음 달" disabled={month >= thisMonth} onClick={() => changeMonth(1)}>
            ›
          </button>
        </div>

        <Calendar month={month} selectable={open} submitted={done} selected={selected} onToggle={toggle} />

        {loading ? (
          <p className="body report-empty">날짜를 불러오는 중이에요.</p>
        ) : open.size > 0 ? (
          <div className="tc-choices__list">
            <button
              type="button"
              className="tc-choice"
              aria-pressed={selected.size === open.size}
              onClick={() => setSelected(selected.size === open.size ? new Set() : new Set(open))}
            >
              {selected.size === open.size ? '모두 빼기' : `기록 있는 ${open.size}일 모두 고르기`}
            </button>
          </div>
        ) : (
          <p className="body report-empty">이 달에는 아직 보고서에 넣을 기록이 없어요.</p>
        )}

        {error && (
          <p className="tc-field__error" role="alert">
            {error}
          </p>
        )}

        <div className="page-bottom">
          <p className="micro report-hint">{selected.size > 0 ? `${selected.size}일 골랐어요` : '날짜를 하나 이상 골라 주세요.'}</p>
          <button className="tc-btn tc-btn--primary" type="button" disabled={selected.size === 0 || busy} onClick={preview}>
            {busy ? '미리보기 만드는 중' : '미리보기'}
          </button>
        </div>
      </div>
    </div>
  )
}

// 미리보기 칸에 보일 글자 (서버가 준 값을 화면용으로)
function fieldValue(key: ReportFieldKey, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-'
  switch (key) {
    case 'date':
      return formatShortDate(String(value))
    case 'minutes':
      return formatMinutes(Number(value))
    case 'photoCount':
      return Number(value) > 0 ? `${value}장` : '없음'
    default:
      return String(value)
  }
}
