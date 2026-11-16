// 물품 지급 관리 (#76). 위: 돌보미 물품 신청 처리(승인·반려·수령), 아래: 물품 목록과 재고.
// 승인하면 신청 수량만큼 재고가 줄고, 수령 처리하면 끝난다. 반납·기한은 없다.
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import {
  RENTAL_STATUS_LABEL,
  createRentalItem,
  handleRental,
  listRentalItems,
  listRentals,
  updateRentalItem,
  type Rental,
  type RentalAction,
  type RentalItem,
} from '../api/rentals';
import { useAsync } from '../api/useAsync';
import { Pagination } from '../components/Pagination';
import { PersonName } from '../components/PersonName';
import { StatusTabs } from '../components/StatusTabs';
import ui from '../components/ui.module.css';
import { notifyCountsChanged } from '../lib/counts';
import { daysSince, formatShortDate } from '../lib/format';
import { useListParams } from '../lib/listParams';

const PAGE_SIZE = 20;
const ITEM_NAME_MAX = 50; // API 제한과 같다
const REJECT_REASON_MAX = 500;
const STATUSES = ['requested', 'approved', 'rejected', 'received'] as const;
const TABS = STATUSES.map((value) => ({ value, label: RENTAL_STATUS_LABEL[value] }));

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : '처리하지 못했습니다.';
}

export function RentalsPage() {
  const { status, offset, setStatus, setOffset } = useListParams(STATUSES, 'requested');
  const rentals = useAsync(() => listRentals({ status, limit: PAGE_SIZE, offset }), [status, offset]);
  const items = useAsync(() => listRentalItems(), []);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 신청을 처리하면 재고와 대기 수량이 바뀌므로 두 목록과 메뉴 건수를 다시 불러온다
  function refreshAll() {
    rentals.reload();
    items.reload();
    notifyCountsChanged();
  }

  return (
    <div className={ui.page}>
      <header>
        <h1 className={ui.title}>물품 지급</h1>
        <p className={ui.lead}>쿨토시·모자 같은 활동 물품은 지급만 하고 돌려받지 않습니다. 승인하면 재고가 줄고 신청자에게 알림이 갑니다.</p>
      </header>

      {message && <p className={message.ok ? ui.success : ui.error}>{message.text}</p>}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 className={ui.sectionTitle}>신청 처리</h2>
        <StatusTabs label="물품 신청 상태" tabs={TABS} value={status} onChange={setStatus} />
        {rentals.error && <p className={ui.error}>신청 목록을 불러오지 못했습니다. {rentals.error.message}</p>}
        {rentals.loading && !rentals.data && <p className={ui.muted}>불러오는 중…</p>}
        {rentals.data && rentals.data.items.length === 0 && (
          <p className={ui.empty}>{RENTAL_STATUS_LABEL[status]} 상태인 신청이 없습니다.</p>
        )}
        {rentals.data && rentals.data.items.length > 0 && (
          <>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>신청자</th>
                  <th>물품</th>
                  <th className={ui.num}>수량</th>
                  <th className={ui.num}>{status === 'requested' ? '기다린 날' : '신청일'}</th>
                  <th>{status === 'rejected' ? '반려 사유' : '처리'}</th>
                </tr>
              </thead>
              <tbody>
                {rentals.data.items.map((r) => (
                  <RentalRow
                    key={r.id}
                    rental={r}
                    onDone={(text) => {
                      setMessage({ ok: true, text });
                      refreshAll();
                    }}
                    onError={(text, stale) => {
                      setMessage({ ok: false, text });
                      if (stale) refreshAll();
                    }}
                  />
                ))}
              </tbody>
            </table>
            <Pagination total={rentals.data.total} limit={rentals.data.limit} offset={rentals.data.offset} onChange={setOffset} />
          </>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 className={ui.sectionTitle}>물품과 재고</h2>
        {items.error && <p className={ui.error}>물품 목록을 불러오지 못했습니다. {items.error.message}</p>}
        {items.data && (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>물품</th>
                <th className={ui.num}>남은 재고</th>
                <th className={ui.num}>승인 대기</th>
                <th className={ui.num}>수령 대기</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className={ui.muted}>
                    등록한 물품이 없습니다. 아래에서 추가하세요.
                  </td>
                </tr>
              )}
              {items.data.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onSaved={(text) => {
                    setMessage({ ok: true, text });
                    items.reload();
                    rentals.reload();
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
        <NewItemForm
          onCreated={(text) => {
            setMessage({ ok: true, text });
            items.reload();
          }}
        />
      </section>
    </div>
  );
}

function RentalRow({
  rental: r,
  onDone,
  onError,
}: {
  rental: Rental;
  onDone: (text: string) => void;
  onError: (text: string, stale: boolean) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const shortStock = r.status === 'requested' && r.item.stock < r.quantity;

  async function act(action: RentalAction, doneText: string) {
    setBusy(true);
    try {
      await handleRental(r.id, action);
      onDone(doneText);
    } catch (err) {
      // 409: 재고 부족이거나 그새 상태가 바뀐 경우. 서버 메시지를 그대로 보여 주고 목록을 새로 불러온다
      onError(errorText(err), err instanceof ApiError && err.status === 409);
    } finally {
      setBusy(false);
    }
  }

  const who = r.requester.nickname;

  return (
    <tr>
      <td>
        <PersonName person={r.requester} />
      </td>
      <td>{r.item.name}</td>
      <td className={ui.num}>{r.quantity}개</td>
      <td className={ui.num}>{r.status === 'requested' ? `${daysSince(r.createdAt)}일` : formatShortDate(r.createdAt)}</td>
      <td>
        {r.status === 'requested' && !rejecting && (
          <div className={ui.actions}>
            <button
              type="button"
              className={`${ui.button} ${ui.small} ${ui.primary}`}
              disabled={busy || shortStock}
              title={shortStock ? `재고가 ${r.item.stock}개뿐이라 승인할 수 없습니다` : undefined}
              onClick={() => act({ status: 'approved' }, `${who} 님의 ${r.item.name} ${r.quantity}개를 승인했습니다.`)}
            >
              승인
            </button>
            <button type="button" className={`${ui.button} ${ui.small} ${ui.danger}`} disabled={busy} onClick={() => setRejecting(true)}>
              반려
            </button>
            {shortStock && <span className={ui.muted}>재고 부족 (남은 {r.item.stock}개)</span>}
          </div>
        )}
        {r.status === 'requested' && rejecting && (
          <form
            style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = reason.trim();
              void act(trimmed ? { status: 'rejected', rejectReason: trimmed } : { status: 'rejected' }, `${who} 님의 신청을 반려했습니다.`);
            }}
          >
            <input
              className={ui.input}
              style={{ height: 30, minWidth: 180 }}
              value={reason}
              maxLength={REJECT_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              placeholder="반려 사유 (선택, 신청자에게 보임)"
              aria-label="반려 사유"
              autoFocus
            />
            <button type="submit" className={`${ui.button} ${ui.small} ${ui.danger}`} disabled={busy}>
              반려하기
            </button>
            <button type="button" className={`${ui.button} ${ui.small}`} disabled={busy} onClick={() => setRejecting(false)}>
              취소
            </button>
          </form>
        )}
        {r.status === 'approved' && (
          <button
            type="button"
            className={`${ui.button} ${ui.small}`}
            disabled={busy}
            onClick={() => {
              if (window.confirm(`${who} 님이 ${r.item.name} ${r.quantity}개를 받아 갔나요?`)) {
                void act({ status: 'received' }, `${who} 님의 수령을 기록했습니다.`);
              }
            }}
          >
            수령 처리
          </button>
        )}
        {r.status === 'rejected' && <span className={ui.muted}>{r.rejectReason ?? '사유 없음'}</span>}
        {r.status === 'received' && <span className={ui.muted}>{r.receivedAt ? `${formatShortDate(r.receivedAt)} 수령` : '수령'}</span>}
      </td>
    </tr>
  );
}

function ItemRow({ item, onSaved }: { item: RentalItem; onSaved: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [stock, setStock] = useState(String(item.stock));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stockNum = Number(stock);
  const valid = name.trim() !== '' && stock !== '' && Number.isInteger(stockNum) && stockNum >= 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const body: { name?: string; stock?: number } = {};
    if (name.trim() !== item.name) body.name = name.trim();
    if (stockNum !== item.stock) body.stock = stockNum;
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateRentalItem(item.id, body);
      setEditing(false);
      onSaved(`${name.trim()} 정보를 고쳤습니다.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <tr>
        <td>{item.name}</td>
        <td className={ui.num}>
          <strong>{item.stock}개</strong>
        </td>
        <td className={ui.num}>{item.requestedQuantity}개</td>
        <td className={ui.num}>{item.awaitingPickupQuantity}개</td>
        <td className={ui.num}>
          <button
            type="button"
            className={`${ui.button} ${ui.small}`}
            onClick={() => {
              setName(item.name);
              setStock(String(item.stock));
              setEditing(true);
            }}
          >
            수정
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={5}>
        <form style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={save}>
          <label className={ui.field}>
            물품 이름
            <input className={ui.input} value={name} maxLength={ITEM_NAME_MAX} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className={ui.field}>
            남은 재고
            <input
              className={ui.input}
              style={{ width: 100 }}
              type="number"
              min={0}
              step={1}
              value={stock}
              onChange={(e) => setStock(e.target.value)}
            />
          </label>
          <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={busy || !valid}>
            저장
          </button>
          <button type="button" className={ui.button} disabled={busy} onClick={() => setEditing(false)}>
            취소
          </button>
          <span className={ui.hint} style={{ flexBasis: '100%' }}>
            남은 재고는 지금 배정할 수 있는 수량을 새 값으로 바꿉니다. 입고하면 늘리고, 실사 후 맞춥니다.
          </span>
          {error && (
            <p className={ui.error} style={{ flexBasis: '100%' }}>
              {error}
            </p>
          )}
        </form>
      </td>
    </tr>
  );
}

function NewItemForm({ onCreated }: { onCreated: (text: string) => void }) {
  const [name, setName] = useState('');
  const [stock, setStock] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stockNum = Number(stock);
  const valid = name.trim() !== '' && stock !== '' && Number.isInteger(stockNum) && stockNum >= 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createRentalItem({ name: name.trim(), stock: stockNum });
      setName('');
      setStock('0');
      onCreated(`${created.name}을(를) 재고 ${created.stock}개로 등록했습니다.`);
    } catch (err) {
      // 409: 같은 이름의 물품이 이미 있음
      setError(err instanceof ApiError && err.status === 409 ? '같은 이름의 물품이 이미 있습니다.' : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={submit}>
      <label className={ui.field}>
        새 물품
        <input
          className={ui.input}
          value={name}
          maxLength={ITEM_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 쿨토시"
        />
      </label>
      <label className={ui.field}>
        처음 재고
        <input
          className={ui.input}
          style={{ width: 100 }}
          type="number"
          min={0}
          step={1}
          value={stock}
          onChange={(e) => setStock(e.target.value)}
        />
      </label>
      <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={busy || !valid}>
        물품 추가
      </button>
      {error && (
        <p className={ui.error} style={{ flexBasis: '100%' }}>
          {error}
        </p>
      )}
    </form>
  );
}
