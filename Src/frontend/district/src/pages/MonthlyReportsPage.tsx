// 월간 보고서 검토 (#75). 돌보미가 낸 보고서를 날짜별 기록으로 확인하고 승인·보완 요청한다.
// 승인하면 보고서의 활동 시간 합계가 봉사시간으로 기록된다(백엔드가 한 트랜잭션으로 처리).
import { useState } from 'react';
import { ApiError } from '../api/client';
import {
  REPORT_STATUS_LABEL,
  VERIFICATION_LABEL,
  getMonthlyReport,
  listMonthlyReports,
  reviewMonthlyReport,
  type MonthlyReport,
  type MonthlyReportDetail,
  type ReportReview,
  type ReportStatus,
} from '../api/monthlyReports';
import { useAsync } from '../api/useAsync';
import { Pagination } from '../components/Pagination';
import { PersonName } from '../components/PersonName';
import { StatusTabs } from '../components/StatusTabs';
import ui from '../components/ui.module.css';
import { notifyCountsChanged } from '../lib/counts';
import { daysSince, formatDate, formatDateTime, formatMinutes, formatShortDate } from '../lib/format';
import { groupByDate } from '../lib/groupRecords';
import { selectableRow, useListParams, useOffsetFallback } from '../lib/listParams';
import styles from './MonthlyReportsPage.module.css';

const PAGE_SIZE = 20;
const REVIEW_NOTE_MAX = 1000; // API 제한과 같다
const STATUSES = ['submitted', 'revision_requested', 'approved'] as const;
const TABS = STATUSES.map((value) => ({ value, label: REPORT_STATUS_LABEL[value] }));

const BADGE: Record<ReportStatus, string> = {
  submitted: ui.badgeInfo,
  revision_requested: ui.badgeWait,
  approved: ui.badgeOk,
};

function dateRange(r: Pick<MonthlyReport, 'firstDate' | 'lastDate'>): string {
  if (!r.firstDate || !r.lastDate) return '-';
  return r.firstDate === r.lastDate
    ? formatShortDate(r.firstDate)
    : `${formatShortDate(r.firstDate)} ~ ${formatShortDate(r.lastDate)}`;
}

export function MonthlyReportsPage() {
  const { status, offset, selectedId, setStatus, setOffset, select } = useListParams(STATUSES, 'submitted');
  const list = useAsync(() => listMonthlyReports({ status, limit: PAGE_SIZE, offset }), [status, offset]);
  useOffsetFallback(list.data, offset, PAGE_SIZE, setOffset);
  const approvedTab = status === 'approved';

  return (
    <div className={ui.page}>
      <header>
        <h1 className={ui.title}>월간 보고서 검토</h1>
        <p className={ui.lead}>
          승인하면 보고서의 활동 시간이 봉사시간으로 기록되고 돌보미에게 알림이 갑니다. 같은 보고서는 한 번만 인정됩니다.
        </p>
      </header>

      <StatusTabs label="보고서 상태" tabs={TABS} value={status} onChange={setStatus} />

      <div className={ui.split}>
        <section>
          {list.error && <p className={ui.error}>목록을 불러오지 못했습니다. {list.error.message}</p>}
          {list.loading && !list.data && <p className={ui.muted}>불러오는 중…</p>}
          {list.data && list.data.items.length === 0 && (
            <p className={ui.empty}>{REPORT_STATUS_LABEL[status]} 상태인 보고서가 없습니다.</p>
          )}
          {list.data && list.data.items.length > 0 && (
            <>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>돌보미</th>
                    <th>활동 날짜</th>
                    <th className={ui.num}>기록</th>
                    <th className={ui.num}>{approvedTab ? '인정한 봉사시간' : '활동 시간'}</th>
                    <th className={ui.num}>{status === 'submitted' ? '기다린 날' : approvedTab ? '승인일' : '요청일'}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((r) => (
                    <tr
                      key={r.id}
                      className={`${ui.rowButton} ${r.id === selectedId ? ui.selected : ''}`}
                      aria-selected={r.id === selectedId}
                      {...selectableRow(() => select(r.id))}
                    >
                      <td>
                        <PersonName person={r.caregiver} />
                        <div className={ui.muted}>나무 {r.treeCount}그루</div>
                      </td>
                      <td>{dateRange(r)}</td>
                      <td className={ui.num}>{r.recordCount}건</td>
                      <td className={ui.num}>{formatMinutes(approvedTab ? (r.volunteerMinutes ?? 0) : r.totalMinutes)}</td>
                      <td className={ui.num}>
                        {status === 'submitted'
                          ? `${daysSince(r.submittedAt)}일`
                          : r.reviewedAt
                            ? formatShortDate(r.reviewedAt)
                            : '-'}
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
            <ReportDetail
              key={selectedId}
              id={selectedId}
              onReviewed={() => {
                list.reload();
                notifyCountsChanged();
              }}
            />
          ) : (
            <p className={ui.empty}>왼쪽에서 보고서를 고르세요.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function ReportDetail({ id, onReviewed }: { id: number; onReviewed: () => void }) {
  const detail = useAsync(() => getMonthlyReport(id), [id]);
  const [current, setCurrent] = useState<MonthlyReportDetail | null>(null); // 검토 직후 응답으로 바로 바꾼다
  const [mode, setMode] = useState<'idle' | 'approve' | 'revision'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const report = current ?? detail.data;

  if (detail.error) {
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className={ui.panel}>
        <p className={ui.error}>{notFound ? '이 관리청의 보고서가 아니거나 없는 보고서입니다.' : detail.error.message}</p>
      </div>
    );
  }
  if (!report) return <div className={ui.panel}>불러오는 중…</div>;

  async function submit(review: ReportReview) {
    setBusy(true);
    setError(null);
    try {
      const updated = await reviewMonthlyReport(id, review);
      setCurrent(updated);
      setMode('idle');
      setNote('');
      setDone(
        review.status === 'approved'
          ? `승인했습니다. 봉사시간 ${formatMinutes(updated.volunteerMinutes ?? updated.totalMinutes)}이 기록되었습니다.`
          : '보완을 요청했습니다. 의견이 돌보미에게 전달됩니다.',
      );
      onReviewed();
    } catch (err) {
      const conflict = err instanceof ApiError && err.status === 409;
      setError(conflict ? '이미 검토된 보고서입니다. 최신 상태로 다시 불러옵니다.' : err instanceof Error ? err.message : '처리하지 못했습니다.');
      if (conflict) {
        detail.reload();
        onReviewed();
      }
    } finally {
      setBusy(false);
    }
  }

  const trimmed = note.trim();
  const days = groupByDate(report.records);

  return (
    <div className={ui.panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h2 className={ui.panelTitle}>
          <PersonName person={report.caregiver} />
        </h2>
        <span className={`${ui.badge} ${BADGE[report.status]}`}>{REPORT_STATUS_LABEL[report.status]}</span>
      </div>

      <dl className={ui.facts}>
        <dt>제출일</dt>
        <dd>{formatDateTime(report.submittedAt)}</dd>
        <dt>활동 날짜</dt>
        <dd>
          {dateRange(report)} · {days.length}일
        </dd>
        <dt>기록</dt>
        <dd>
          {report.recordCount}건 · 나무 {report.treeCount}그루
        </dd>
        <dt>활동 시간 합계</dt>
        <dd>
          <strong>{formatMinutes(report.totalMinutes)}</strong>
        </dd>
        {report.status === 'approved' && (
          <>
            <dt>인정한 봉사시간</dt>
            <dd>
              <strong>{formatMinutes(report.volunteerMinutes ?? 0)}</strong>
              {report.reviewedAt && <span className={ui.muted}> · {formatDate(report.reviewedAt)} 승인</span>}
            </dd>
          </>
        )}
      </dl>

      {report.reviewNote && (
        <div>
          <h3 className={ui.sectionTitle} style={{ marginBottom: 8 }}>
            구청 의견
          </h3>
          <p className={ui.quote}>{report.reviewNote}</p>
        </div>
      )}

      <div className={styles.days}>
        <h3 className={ui.sectionTitle}>날짜별 기록</h3>
        {days.length === 0 && <p className={ui.muted}>묶인 기록이 없습니다.</p>}
        {days.map((day) => (
          <section key={day.date} className={styles.day}>
            <div className={styles.dayHead}>
              <span>{formatShortDate(day.date)}</span>
              <span className={ui.muted}>{formatMinutes(day.minutes)}</span>
            </div>
            {day.records.map((rec) => (
              <article key={rec.id} className={styles.record}>
                {rec.photoUrl ? (
                  <a href={rec.photoUrl} target="_blank" rel="noreferrer" className={styles.photo}>
                    <img src={rec.photoUrl} alt={`${formatShortDate(day.date)} ${rec.tree.species} 활동 사진`} loading="lazy" />
                  </a>
                ) : (
                  <div className={`${styles.photo} ${styles.noPhoto}`}>사진 없음</div>
                )}
                <div className={styles.recordBody}>
                  <div className={styles.recordTitle}>
                    <span>
                      {rec.tree.species} {rec.tree.roadName ?? rec.tree.address ?? ''}
                    </span>
                    <span className={`${ui.badge} ${rec.verification === 'none' ? ui.badgeWait : ''}`}>
                      {VERIFICATION_LABEL[rec.verification]}
                    </span>
                  </div>
                  <span className={ui.muted}>
                    {rec.activityKind ?? '활동'} · {formatMinutes(rec.durationMin)}
                  </span>
                  {rec.memo && <p className={styles.memo}>{rec.memo}</p>}
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>

      {done && <p className={ui.success}>{done}</p>}
      {error && <p className={ui.error}>{error}</p>}

      {report.status === 'submitted' && mode === 'idle' && (
        <div className={ui.actions}>
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy} onClick={() => setMode('approve')}>
            승인
          </button>
          <button type="button" className={ui.button} disabled={busy} onClick={() => setMode('revision')}>
            보완 요청
          </button>
        </div>
      )}

      {report.status === 'submitted' && mode !== 'idle' && (
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'approve') void submit(trimmed ? { status: 'approved', reviewNote: trimmed } : { status: 'approved' });
            else if (trimmed) void submit({ status: 'revision_requested', reviewNote: trimmed });
          }}
        >
          {mode === 'approve' && (
            <p className={ui.success}>
              활동 시간 합계 <strong>{formatMinutes(report.totalMinutes)}</strong>을 봉사시간으로 기록합니다. 승인 뒤에는 되돌릴 수
              없습니다.
            </p>
          )}
          <label className={ui.field}>
            {mode === 'approve' ? '의견 (선택)' : '보완할 내용 (필수)'}
            <textarea
              className={ui.textarea}
              value={note}
              maxLength={REVIEW_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder={mode === 'approve' ? '예: 꾸준히 돌봐 주셔서 고맙습니다.' : '예: 10월 14일 기록에 사진을 한 장 더 붙여 주세요.'}
              autoFocus
            />
            <span className={ui.hint}>
              돌보미에게 그대로 보입니다. {note.length}/{REVIEW_NOTE_MAX}
            </span>
          </label>
          <div className={ui.actions}>
            <button
              type="submit"
              className={`${ui.button} ${mode === 'approve' ? ui.primary : ''}`}
              disabled={busy || (mode === 'revision' && !trimmed)}
            >
              {mode === 'approve' ? '승인하고 봉사시간 기록' : '보완 요청 보내기'}
            </button>
            <button type="button" className={ui.button} disabled={busy} onClick={() => setMode('idle')}>
              취소
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
