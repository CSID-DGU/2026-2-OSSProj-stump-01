// 돌보미 신청 심사 (#74). 왼쪽 목록에서 신청서를 고르면 오른쪽에서 보고 승인·반려한다.
import { useState } from 'react';
import { ApiError } from '../api/client';
import {
  APPLICATION_STATUS_LABEL,
  PARTICIPATION_TYPE_LABEL,
  getApplication,
  listApplications,
  reviewApplication,
  type Application,
  type ApplicationStatus,
} from '../api/applications';
import { useAsync } from '../api/useAsync';
import { OrgFilter } from '../components/OrgFilter';
import { Pagination } from '../components/Pagination';
import { PersonName } from '../components/PersonName';
import { StatusTabs } from '../components/StatusTabs';
import ui from '../components/ui.module.css';
import { notifyCountsChanged } from '../lib/counts';
import { daysSince, formatDate, formatDateTime, formatShortDate } from '../lib/format';
import { selectableRow, useListParams, useOffsetFallback } from '../lib/listParams';

const PAGE_SIZE = 20;
const REJECT_REASON_MAX = 500; // API 제한과 같다
const STATUSES = ['pending', 'approved', 'rejected', 'ended'] as const;
const TABS = STATUSES.map((value) => ({ value, label: APPLICATION_STATUS_LABEL[value] }));

const BADGE: Record<ApplicationStatus, string> = {
  pending: ui.badgeWait,
  approved: ui.badgeOk,
  rejected: ui.badgeNo,
  ended: '',
};

export function ApplicationsPage() {
  const { status, offset, selectedId, setStatus, setOffset, select, organizationId, setOrganization } = useListParams(STATUSES, 'pending');
  const list = useAsync(() => listApplications({ status, limit: PAGE_SIZE, offset, organizationId }), [status, offset, organizationId]);
  useOffsetFallback(list.data, offset, PAGE_SIZE, setOffset);

  return (
    <div className={ui.page}>
      <header className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>돌보미 신청 심사</h1>
          <p className={ui.lead}>대기 중인 신청은 오래 기다린 순서로 보입니다. 결과는 신청자에게 알림으로 갑니다.</p>
        </div>
        <OrgFilter value={organizationId} onChange={setOrganization} />
      </header>

      <StatusTabs label="신청 상태" tabs={TABS} value={status} onChange={setStatus} />

      <div className={ui.split}>
        <section>
          {list.error && <p className={ui.error}>목록을 불러오지 못했습니다. {list.error.message}</p>}
          {list.loading && !list.data && <p className={ui.muted}>불러오는 중…</p>}
          {list.data && list.data.items.length === 0 && (
            <p className={ui.empty}>{APPLICATION_STATUS_LABEL[status]} 상태인 신청이 없습니다.</p>
          )}
          {list.data && list.data.items.length > 0 && (
            <>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>신청자</th>
                    <th>나무</th>
                    <th>활동 기간</th>
                    <th className={ui.num}>{status === 'pending' ? '기다린 날' : '신청일'}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((a) => (
                    <tr
                      key={a.id}
                      className={`${ui.rowButton} ${a.id === selectedId ? ui.selected : ''}`}
                      aria-selected={a.id === selectedId}
                      {...selectableRow(() => select(a.id))}
                    >
                      <td>
                        <PersonName person={a.applicant} />
                      </td>
                      <td>
                        {a.tree.species}
                        <div className={ui.muted}>{a.tree.roadName ?? a.tree.address ?? a.tree.dong ?? a.tree.district}</div>
                      </td>
                      <td>
                        {formatShortDate(a.periodStart)} ~ {formatShortDate(a.periodEnd)}
                      </td>
                      <td className={ui.num}>
                        {status === 'pending' ? `${daysSince(a.createdAt)}일` : formatShortDate(a.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination total={list.data.total} limit={list.data.limit} offset={list.data.offset} onChange={setOffset} />
            </>
          )}
        </section>

        <aside>
          {selectedId ? (
            <ApplicationDetail
              key={selectedId}
              id={selectedId}
              onReviewed={() => {
                list.reload();
                notifyCountsChanged();
              }}
            />
          ) : (
            <p className={ui.empty}>왼쪽에서 신청서를 고르세요.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function ApplicationDetail({ id, onReviewed }: { id: number; onReviewed: () => void }) {
  const detail = useAsync(() => getApplication(id), [id]);
  const [current, setCurrent] = useState<Application | null>(null); // 심사 직후 응답으로 화면을 바로 바꾼다
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const app = current ?? detail.data;

  if (detail.error) {
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className={ui.panel}>
        <p className={ui.error}>{notFound ? '이 관리청의 신청서가 아니거나 없는 신청서입니다.' : detail.error.message}</p>
      </div>
    );
  }
  if (!app) return <div className={ui.panel}>불러오는 중…</div>;

  async function submit(review: Parameters<typeof reviewApplication>[1]) {
    setBusy(true);
    setError(null);
    try {
      const updated = await reviewApplication(id, review);
      setCurrent(updated);
      setRejecting(false);
      setDone(review.status === 'approved' ? '승인했습니다. 신청자에게 알림이 갔습니다.' : '반려했습니다. 사유가 신청자에게 전달됩니다.');
      onReviewed();
    } catch (err) {
      // 409: 그새 다른 담당자가 먼저 심사한 경우
      setError(
        err instanceof ApiError && err.status === 409
          ? '이미 심사된 신청서입니다. 목록을 새로 불러옵니다.'
          : err instanceof Error
            ? err.message
            : '처리하지 못했습니다.',
      );
      if (err instanceof ApiError && err.status === 409) {
        detail.reload();
        onReviewed();
      }
    } finally {
      setBusy(false);
    }
  }

  function approve() {
    if (!app) return;
    if (!window.confirm(`${app.applicant.nickname} 님의 신청을 승인할까요?`)) return;
    void submit({ status: 'approved' });
  }

  const trimmed = reason.trim();

  return (
    <div className={ui.panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h2 className={ui.panelTitle}>
          <PersonName person={app.applicant} />
        </h2>
        <span className={`${ui.badge} ${BADGE[app.status]}`}>{APPLICATION_STATUS_LABEL[app.status]}</span>
      </div>

      <ApplicantFacts app={app} />

      <dl className={ui.facts}>
        <dt>돌볼 나무</dt>
        <dd>
          {app.tree.species} · {app.tree.code ?? `나무 #${app.tree.id}`}
          <div className={ui.muted}>
            {[app.tree.district, app.tree.dong, app.tree.roadName].filter(Boolean).join(' ')}
            {app.tree.address && ` (${app.tree.address})`}
          </div>
        </dd>
        <dt>지금 돌보미</dt>
        <dd>{app.tree.caregiverCount === 0 ? '없음 (첫 돌보미)' : `${app.tree.caregiverCount}명`}</dd>
        <dt>활동 기간</dt>
        <dd>
          {formatDate(app.periodStart)} ~ {formatDate(app.periodEnd)}
        </dd>
        <dt>신청일</dt>
        <dd>{formatDateTime(app.createdAt)}</dd>
        {app.reviewedAt && (
          <>
            <dt>심사일</dt>
            <dd>{formatDateTime(app.reviewedAt)}</dd>
          </>
        )}
      </dl>

      <div>
        <h3 className={ui.sectionTitle} style={{ marginBottom: 8 }}>
          신청사유
        </h3>
        <p className={ui.quote}>{app.motivation || '적지 않았습니다.'}</p>
      </div>

      {app.activityPlan && <LongText title="활동계획" text={app.activityPlan} />}
      {app.organizationIntro && <LongText title="기업·단체 소개" text={app.organizationIntro} />}

      {app.rejectReason && (
        <div>
          <h3 className={ui.sectionTitle} style={{ marginBottom: 8 }}>
            반려 사유
          </h3>
          <p className={ui.quote}>{app.rejectReason}</p>
        </div>
      )}

      {done && <p className={ui.success}>{done}</p>}
      {error && <p className={ui.error}>{error}</p>}

      {app.status === 'pending' && !rejecting && (
        <div className={ui.actions}>
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy} onClick={approve}>
            승인
          </button>
          <button type="button" className={`${ui.button} ${ui.danger}`} disabled={busy} onClick={() => setRejecting(true)}>
            반려
          </button>
        </div>
      )}

      {app.status === 'pending' && rejecting && (
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) void submit({ status: 'rejected', rejectReason: trimmed });
          }}
        >
          <label className={ui.field}>
            반려 사유 (필수)
            <textarea
              className={ui.textarea}
              value={reason}
              maxLength={REJECT_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 이 나무는 돌보미가 이미 충분합니다. 가까운 다른 나무를 추천드려요."
              autoFocus
            />
            <span className={ui.hint}>
              신청자에게 그대로 보입니다. {reason.length}/{REJECT_REASON_MAX}
            </span>
          </label>
          <div className={ui.actions}>
            <button type="submit" className={`${ui.button} ${ui.danger}`} disabled={busy || !trimmed}>
              반려하기
            </button>
            <button type="button" className={ui.button} disabled={busy} onClick={() => setRejecting(false)}>
              취소
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** 신청인 정보 (구청 신청서 양식 항목, #68). 신청서·연락처는 개인정보라 구청 담당자 화면에서만 보여 준다 */
function ApplicantFacts({ app }: { app: Application }) {
  if (app.applicantName === null) {
    return <p className={ui.hint}>신청서 양식 항목이 생기기 전에 낸 신청서라 신청인 정보가 없습니다.</p>;
  }
  return (
    <dl className={ui.facts}>
      <dt>신청인</dt>
      <dd>{app.applicantName}</dd>
      <dt>참여 유형</dt>
      <dd>{app.participationType ? PARTICIPATION_TYPE_LABEL[app.participationType] : '-'}</dd>
      {app.contactPerson && (
        <>
          <dt>담당자</dt>
          <dd>{app.contactPerson}</dd>
        </>
      )}
      <dt>신청 인원</dt>
      <dd>{app.headcount !== null ? `${app.headcount}명` : '-'}</dd>
      <dt>연락처</dt>
      <dd>{app.phone ?? '-'}</dd>
      <dt>주소</dt>
      <dd>{app.address ? `${app.postalCode ? `(${app.postalCode}) ` : ''}${app.address}` : '-'}</dd>
      <dt>안내 동의</dt>
      <dd>{app.agreedAt ? `${formatDateTime(app.agreedAt)} 동의` : '-'}</dd>
    </dl>
  );
}

function LongText({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className={ui.sectionTitle} style={{ marginBottom: 8 }}>
        {title}
      </h3>
      <p className={ui.quote}>{text}</p>
    </div>
  );
}
