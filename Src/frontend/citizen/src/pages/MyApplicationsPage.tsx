import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import TopBar from '../components/TopBar'
import { APPLICATION_STATUS } from '../content/applicationForm'
import { api, ApiError, type MyApplication } from '../lib/api'
import { formatLongDate } from '../lib/date'
import './ApplyPages.css'

// 내 돌보미 신청 현황 (#40)
// 나무마다 심사 결과(심사 대기·승인·반려·종료)와 반려 사유를 보여 준다.
export default function MyApplicationsPage() {
  const [items, setItems] = useState<MyApplication[] | null>(null)
  const [error, setError] = useState('')

  // 서버에서 받아 온다 (응답이 오면 상태를 바꾼다)
  function fetchApplications() {
    api
      .myApplications()
      .then((r) => setItems(r.applications))
      .catch((e) => setError(e instanceof ApiError ? e.message : '신청 현황을 불러오지 못했어요.'))
  }

  useEffect(fetchApplications, [])

  // "다시 불러오기" 버튼
  function load() {
    setError('')
    fetchApplications()
  }

  const approved = items?.filter((a) => a.status === 'approved').length ?? 0
  const pending = items?.filter((a) => a.status === 'pending').length ?? 0

  return (
    <div className="app-shell tc-screen">
      <TopBar title="내 신청 현황" kind="back" />
      <div className="page">
        <div className="page-title">
          <h1 className="display">{approved > 0 ? `돌보는 나무 ${approved}그루` : '돌보미 신청'}</h1>
          <p className="body">{pending > 0 ? `심사 대기 ${pending}건이 있어요. 결과는 알림으로 알려 드려요.` : '나무마다 관리청 담당자가 심사해요.'}</p>
        </div>

        {error && (
          <div className="apply-error">
            <p className="tc-field__error" role="alert">
              {error}
            </p>
            <button type="button" className="tc-choice" onClick={load}>
              다시 불러오기
            </button>
          </div>
        )}

        {items === null && !error && <p className="body apply-muted">불러오는 중이에요.</p>}

        {items?.length === 0 && <p className="body apply-muted">아직 낸 신청서가 없어요. 지도에서 돌볼 나무를 골라 신청해 보세요.</p>}

        {items && items.length > 0 && (
          <ul className="tc-rows apply-list">
            {items.map((a) => {
              const status = APPLICATION_STATUS[a.status]
              return (
                <li key={a.id} className="tc-row apply-item">
                  <div className="apply-item__main">
                    <span className="tc-tree__name">
                      {a.tree.name}
                    </span>
                    <span className="caption apply-muted">
                      {a.tree.code ?? a.tree.district} · {formatLongDate(a.periodStart)} ~ {formatLongDate(a.periodEnd)}
                    </span>
                    {a.status === 'rejected' && a.rejectReason && <span className="body apply-reject">반려 사유: {a.rejectReason}</span>}
                  </div>
                  <span className={`tc-status ${status.className}`}>{status.label}</span>
                </li>
              )
            })}
          </ul>
        )}

        <div className="page-bottom">
          <Link className="tc-btn tc-btn--primary" to="/map">
            지도에서 나무 골라 신청하기
          </Link>
        </div>
      </div>
    </div>
  )
}
