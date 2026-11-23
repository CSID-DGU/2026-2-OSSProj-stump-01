import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import TopBar from '../components/TopBar'
import { MAX_QUANTITY, RENTAL_STATUS } from '../content/rentals'
import { api, ApiError, type AvailableItem, type MyRental } from '../lib/api'
import { formatShortDate, toDateKey } from '../lib/date'
import './RentalsPage.css'

// 물품 신청 (#81)
// 쿨토시·모자 같은 활동 물품을 신청하고 결과를 본다. 신청 → 구청 승인 → 수령으로 끝나고 반납은 없다.
// 물품은 내가 승인된 돌보미인 나무의 관리청 것만 보인다.
export default function RentalsPage() {
  const [items, setItems] = useState<AvailableItem[] | null>(null)
  const [rentals, setRentals] = useState<MyRental[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [quantity, setQuantity] = useState<Record<number, number>>({}) // 물품 id → 고른 수량
  const [sendingId, setSendingId] = useState<number | null>(null)
  const [message, setMessage] = useState<{ itemId: number; text: string; ok: boolean } | null>(null)

  // 물품 목록과 내 신청을 함께 받아 온다 (응답이 오면 상태를 바꾼다)
  function fetchAll() {
    Promise.all([api.rentalItems(), api.myRentals()])
      .then(([i, r]) => {
        setItems(i.items)
        setRentals(r.rentals)
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : '물품 정보를 불러오지 못했어요.'))
  }

  useEffect(fetchAll, [])

  // 같은 물품에 아직 처리 중인(승인 대기) 신청이 있으면 다시 신청할 수 없다
  const pendingItemIds = new Set((rentals ?? []).filter((r) => r.status === 'requested').map((r) => r.item.id))

  async function request(item: AvailableItem) {
    const qty = quantity[item.id] ?? 1
    setSendingId(item.id)
    setMessage(null)
    try {
      await api.requestRental(item.id, qty)
      setMessage({ itemId: item.id, text: `${item.name} ${qty}개를 신청했어요. 구청이 승인하면 알림으로 알려 드려요.`, ok: true })
      fetchAll() // 재고·현황을 새로 받는다
    } catch (err) {
      setMessage({ itemId: item.id, text: rentalErrorMessage(err), ok: false })
    } finally {
      setSendingId(null)
    }
  }

  const agencies = [...new Set((items ?? []).map((i) => i.agency))]

  return (
    <div className="app-shell tc-screen">
      <TopBar title="물품 신청" kind="back" />
      <div className="page rentals">
        <div className="page-title">
          <h1 className="display">활동 물품</h1>
          <p className="body">돌보미 활동에 쓰는 물품을 관리청에서 받아요. 받은 물품은 반납하지 않아요.</p>
        </div>

        {loadError && (
          <div className="rentals-error">
            <p className="tc-field__error" role="alert">
              {loadError}
            </p>
            <button
              type="button"
              className="tc-choice"
              onClick={() => {
                setLoadError('')
                fetchAll()
              }}
            >
              다시 불러오기
            </button>
          </div>
        )}

        {items === null && !loadError && <p className="body rentals-muted">불러오는 중이에요.</p>}

        {/* 신청할 수 있는 물품 */}
        {items !== null && (
          <section className="rentals-section" aria-labelledby="rental-items">
            <h2 id="rental-items" className="tc-section-title">
              신청할 수 있는 물품
            </h2>
            {items.length === 0 ? (
              <div className="rentals-empty">
                <p className="body rentals-muted">승인된 돌보미가 되면 그 나무 관리청의 물품을 신청할 수 있어요.</p>
                <Link className="tc-link" to="/applications">
                  내 신청 현황 보기
                </Link>
              </div>
            ) : (
              agencies.map((agency) => (
                <div key={agency} className="rentals-agency">
                  {agencies.length > 1 && <p className="caption rentals-muted">{agency}</p>}
                  <ul className="tc-rows rentals-list">
                    {items
                      .filter((i) => i.agency === agency)
                      .map((item) => {
                        const max = Math.min(MAX_QUANTITY, item.stock)
                        const qty = Math.min(quantity[item.id] ?? 1, Math.max(max, 1))
                        const pending = pendingItemIds.has(item.id)
                        const soldOut = item.stock <= 0
                        return (
                          <li key={item.id} className="rentals-item">
                            <div className="rentals-item__head">
                              <span className="label-lg">{item.name}</span>
                              <span className={soldOut ? 'caption rentals-alert' : 'caption rentals-muted'}>
                                {soldOut ? '재고 없음' : `남은 재고 ${item.stock}개`}
                              </span>
                            </div>
                            {pending ? (
                              <p className="caption rentals-muted">승인 대기 중인 신청이 있어요. 결과가 나오면 다시 신청할 수 있어요.</p>
                            ) : (
                              !soldOut && (
                                <div className="rentals-item__action">
                                  <div className="rentals-qty" role="group" aria-label={`${item.name} 수량`}>
                                    <button
                                      type="button"
                                      className="rentals-qty__btn"
                                      aria-label="하나 빼기"
                                      disabled={qty <= 1}
                                      onClick={() => setQuantity({ ...quantity, [item.id]: qty - 1 })}
                                    >
                                      −
                                    </button>
                                    <span className="rentals-qty__n" aria-live="polite">
                                      {qty}개
                                    </span>
                                    <button
                                      type="button"
                                      className="rentals-qty__btn"
                                      aria-label="하나 더하기"
                                      disabled={qty >= max}
                                      onClick={() => setQuantity({ ...quantity, [item.id]: qty + 1 })}
                                    >
                                      +
                                    </button>
                                  </div>
                                  <button type="button" className="tc-choice" disabled={sendingId !== null} onClick={() => request(item)}>
                                    {sendingId === item.id ? '신청하는 중' : '신청'}
                                  </button>
                                </div>
                              )
                            )}
                            {message?.itemId === item.id && (
                              <p className={message.ok ? 'caption rentals-ok' : 'tc-field__error'} role="status">
                                {message.text}
                              </p>
                            )}
                          </li>
                        )
                      })}
                  </ul>
                </div>
              ))
            )}
          </section>
        )}

        {/* 내 신청 현황 */}
        {rentals !== null && (
          <section className="rentals-section" aria-labelledby="my-rentals">
            <h2 id="my-rentals" className="tc-section-title">
              내 신청 현황
            </h2>
            {rentals.length === 0 ? (
              <p className="body rentals-muted">아직 신청한 물품이 없어요.</p>
            ) : (
              <ul className="tc-rows rentals-list">
                {rentals.map((r) => {
                  const s = RENTAL_STATUS[r.status]
                  return (
                    <li key={r.id} className="tc-row rentals-mine">
                      <div className="rentals-mine__main">
                        <span className="body">
                          {r.item.name} {r.quantity}개
                        </span>
                        <span className="caption rentals-muted">
                          {r.item.agency} · {formatShortDate(toDateKey(new Date(r.createdAt)))} 신청
                          {r.receivedAt && ` · ${formatShortDate(toDateKey(new Date(r.receivedAt)))} 받음`}
                        </span>
                        {s.help && <span className="caption">{s.help}</span>}
                        {r.status === 'rejected' && r.rejectReason && <span className="caption rentals-alert">반려 사유: {r.rejectReason}</span>}
                      </div>
                      <span className={`tc-status ${s.className}`}>{s.label}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function rentalErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return '재고가 모자라거나 같은 물품을 이미 신청했어요. 현황을 확인해 주세요.'
    if (err.status === 403) return '이 관리청 나무의 승인된 돌보미만 신청할 수 있어요.'
    if (err.status === 0) return err.message
  }
  return '신청하지 못했어요. 잠시 뒤 다시 해 주세요.'
}
