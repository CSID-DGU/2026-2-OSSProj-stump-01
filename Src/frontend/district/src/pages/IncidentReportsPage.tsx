// 신고 처리 (#29). 이 관리청에 배정된 이상 신고를 오래 기다린 순으로 보고, 확인 필요 → 현장 확인 → 조치 완료로 처리한다.
// 신고는 공개 게시하지 않는다. 조치 완료하면 조치 내용이 신고자와 그 나무의 돌보미에게만 알림으로 간다(백엔드 #21).
import { useState } from 'react';
import { ApiError } from '../api/client';
import {
  INCIDENT_FILTER_LABEL,
  INCIDENT_STATUS_LABEL,
  getIncidentReport,
  listIncidentReports,
  updateIncidentReport,
  type IncidentFilter,
  type IncidentReport,
  type IncidentStatus,
  type IncidentUpdate,
} from '../api/incidentReports';
import { useAsync } from '../api/useAsync';
import { Pagination } from '../components/Pagination';
import { StatusTabs } from '../components/StatusTabs';
import ui from '../components/ui.module.css';
import { notifyCountsChanged } from '../lib/counts';
import { formatDateTime, formatShortDate } from '../lib/format';
import { selectableRow, useListParams, useOffsetFallback } from '../lib/listParams';
import { OLD_INCIDENT_DAYS } from '../lib/thresholds';
import styles from './IncidentReportsPage.module.css';

const PAGE_SIZE = 20;
const ACTION_NOTE_MAX = 1000; // API 제한과 같다
const FILTERS = ['unresolved', 'pending', 'inspecting', 'resolved'] as const;
const TABS = FILTERS.map((value) => ({ value, label: INCIDENT_FILTER_LABEL[value] }));

const BADGE: Record<IncidentStatus, string> = {
  pending: ui.badgeNo,
  inspecting: ui.badgeWait,
  resolved: ui.badgeOk,
};

function place(r: IncidentReport): string {
  return r.tree.roadName ?? r.tree.address ?? `나무 #${r.tree.id}`;
}

export function IncidentReportsPage() {
  const { status, offset, selectedId, setStatus, setOffset, select } = useListParams<IncidentFilter>(FILTERS, 'unresolved');
  const list = useAsync(() => listIncidentReports({ status, limit: PAGE_SIZE, offset }), [status, offset]);
  useOffsetFallback(list.data, offset, PAGE_SIZE, setOffset);
  const resolvedTab = status === 'resolved';

  return (
    <div className={ui.page}>
      <header>
        <h1 className={ui.title}>신고 처리</h1>
        <p className={ui.lead}>
          이 관리청에 배정된 이상 신고입니다. 신고는 공개되지 않고, 조치 결과는 신고자와 그 나무 돌보미에게만 알림으로 갑니다.
        </p>
      </header>

      <StatusTabs label="신고 상태" tabs={TABS} value={status} onChange={setStatus} />

      <div className={ui.split}>
        <section>
          {list.error && <p className={ui.error}>목록을 불러오지 못했습니다. {list.error.message}</p>}
          {list.loading && !list.data && <p className={ui.muted}>불러오는 중…</p>}
          {list.data && list.data.items.length === 0 && (
            <p className={ui.empty}>{INCIDENT_FILTER_LABEL[status]} 신고가 없습니다.</p>
          )}
          {list.data && list.data.items.length > 0 && (
            <>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>신고</th>
                    <th>상태</th>
                    <th className={ui.num}>{resolvedTab ? '걸린 날' : '지난 날'}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((r) => {
                    const old = !resolvedTab && r.elapsedDays > OLD_INCIDENT_DAYS;
                    return (
                      <tr
                        key={r.id}
                        className={`${ui.rowButton} ${r.id === selectedId ? ui.selected : ''}`}
                        aria-selected={r.id === selectedId}
                        {...selectableRow(() => select(r.id))}
                      >
                        <td>
                          <span className={styles.titleLine}>
                            {r.categoryLabel}
                            {r.urgency === 'high' && <span className={`${ui.badge} ${ui.badgeNo}`}>긴급</span>}
                          </span>
                          <div className={ui.muted}>
                            {r.tree.species}, {place(r)} · {formatShortDate(r.createdAt)} 접수
                          </div>
                        </td>
                        <td>
                          <span className={`${ui.badge} ${BADGE[r.status]}`}>{INCIDENT_STATUS_LABEL[r.status]}</span>
                        </td>
                        <td className={`${ui.num} ${old ? styles.old : ''}`}>{r.elapsedDays}일</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pagination total={list.data.total} limit={list.data.limit} offset={list.data.offset} onChange={setOffset} />
            </>
          )}
        </section>

        <aside>
          {selectedId ? (
            <IncidentDetail
              key={selectedId}
              id={selectedId}
              onChanged={() => {
                list.reload();
                notifyCountsChanged();
              }}
            />
          ) : (
            <p className={ui.empty}>왼쪽에서 신고를 고르세요.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function IncidentDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const detail = useAsync(() => getIncidentReport(id), [id]);
  const [current, setCurrent] = useState<IncidentReport | null>(null); // 처리 직후 응답으로 바로 바꾼다
  const [note, setNote] = useState<string | null>(null); // null이면 아직 고치지 않음(저장된 메모를 보여 준다)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const report = current ?? detail.data;

  if (detail.error) {
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className={ui.panel}>
        <p className={ui.error}>{notFound ? '이 관리청에 배정된 신고가 아니거나 없는 신고입니다.' : detail.error.message}</p>
      </div>
    );
  }
  if (!report) return <div className={ui.panel}>불러오는 중…</div>;

  const savedNote = report.actionNote ?? '';
  const noteValue = note ?? savedNote;
  const trimmed = noteValue.trim();
  const noteChanged = trimmed !== savedNote.trim();
  const old = report.status !== 'resolved' && report.elapsedDays > OLD_INCIDENT_DAYS;

  async function submit(body: IncidentUpdate, doneText: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateIncidentReport(id, body);
      setCurrent(updated);
      setNote(null);
      setDone(doneText);
      onChanged();
    } catch (err) {
      // 409: 그새 다른 담당자가 상태를 바꿨거나 이미 조치 완료된 신고
      const conflict = err instanceof ApiError && err.status === 409;
      setError(conflict ? '그새 상태가 바뀌었습니다. 최신 상태로 다시 불러옵니다.' : err instanceof Error ? err.message : '처리하지 못했습니다.');
      if (conflict) {
        setCurrent(null);
        detail.reload();
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  // 메모를 고쳤을 때만 같이 보낸다(빈 메모는 API가 받지 않는다)
  const withNote = (body: IncidentUpdate): IncidentUpdate => (noteChanged && trimmed ? { ...body, actionNote: trimmed } : body);

  function toInspecting() {
    void submit(withNote({ status: 'inspecting' }), '현장 확인으로 바꿨습니다.');
  }

  function toResolved() {
    if (!trimmed) return;
    if (!window.confirm('조치 완료로 바꿀까요? 조치 내용이 신고자와 이 나무 돌보미에게 알림으로 가고, 이후에는 바꿀 수 없습니다.')) return;
    void submit(withNote({ status: 'resolved' }), '조치 완료로 바꿨습니다. 신고자와 돌보미에게 알림이 갔습니다.');
  }

  function saveNoteOnly() {
    if (!trimmed || !noteChanged) return;
    void submit({ actionNote: trimmed }, '처리 메모를 저장했습니다.');
  }

  return (
    <div className={ui.panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h2 className={ui.panelTitle}>{report.categoryLabel}</h2>
        <span className={`${ui.badge} ${BADGE[report.status]}`}>{INCIDENT_STATUS_LABEL[report.status]}</span>
      </div>

      {old && (
        <p className={ui.error}>
          접수 후 {report.elapsedDays}일이 지났습니다. 기준({OLD_INCIDENT_DAYS}일)을 넘긴 미처리 신고입니다.
        </p>
      )}

      {report.photoUrl ? (
        <a href={report.photoUrl} target="_blank" rel="noreferrer" className={styles.photo}>
          <img src={report.photoUrl} alt={`${report.tree.species} 신고 사진`} />
        </a>
      ) : (
        <p className={ui.muted}>사진 없음</p>
      )}

      <dl className={ui.facts}>
        <dt>나무</dt>
        <dd>
          {report.tree.species} · 나무 #{report.tree.id}
          <div className={ui.muted}>{[report.tree.roadName, report.tree.address].filter(Boolean).join(' · ') || '주소 없음'}</div>
        </dd>
        <dt>긴급도</dt>
        <dd>{report.urgency === 'high' ? <span className={`${ui.badge} ${ui.badgeNo}`}>긴급</span> : '보통'}</dd>
        <dt>신고자</dt>
        <dd>
          {report.reporter.nickname}
          {report.isTrusted && <span className={ui.muted}> · 교육 이수 돌보미</span>}
        </dd>
        <dt>신고 위치</dt>
        <dd>
          {report.location
            ? `${report.location.lat.toFixed(6)}, ${report.location.lng.toFixed(6)}`
            : '위치 없음 (나무 위치 기준)'}
        </dd>
        <dt>경과</dt>
        <dd className={styles.timeline}>
          <span>접수 {formatDateTime(report.createdAt)}</span>
          {report.inspectedAt && <span>현장 확인 {formatDateTime(report.inspectedAt)}</span>}
          {report.resolvedAt && <span>조치 완료 {formatDateTime(report.resolvedAt)}</span>}
          <span className={ui.muted}>
            {report.status === 'resolved' ? `완료까지 ${report.elapsedDays}일` : `접수 후 ${report.elapsedDays}일`}
          </span>
        </dd>
      </dl>

      {done && <p className={ui.success}>{done}</p>}
      {error && <p className={ui.error}>{error}</p>}

      {report.status === 'resolved' ? (
        <div>
          <h3 className={ui.sectionTitle} style={{ marginBottom: 8 }}>
            조치 내용
          </h3>
          <p className={ui.quote}>{report.actionNote ?? '-'}</p>
          <p className={ui.muted} style={{ marginTop: 6 }}>
            조치 완료한 신고는 더 바꿀 수 없습니다.
          </p>
        </div>
      ) : (
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            saveNoteOnly();
          }}
        >
          <label className={ui.field}>
            {report.status === 'inspecting' ? '조치 내용 (조치 완료에 필수)' : '처리 메모 (선택)'}
            <textarea
              className={ui.textarea}
              value={noteValue}
              maxLength={ACTION_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder={report.status === 'inspecting' ? '예: 지지대 결속끈을 풀고 다시 묶었습니다.' : '예: 내일 오전 현장 방문 예정'}
            />
            <span className={ui.hint}>
              조치 완료하면 이 내용이 신고자와 이 나무 돌보미에게 알림으로 갑니다. {noteValue.length}/{ACTION_NOTE_MAX}
            </span>
          </label>
          <div className={ui.actions}>
            {report.status === 'pending' && (
              <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy} onClick={toInspecting}>
                현장 확인으로
              </button>
            )}
            {report.status === 'inspecting' && (
              <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy || !trimmed} onClick={toResolved}>
                조치 완료
              </button>
            )}
            <button type="submit" className={ui.button} disabled={busy || !trimmed || !noteChanged}>
              메모만 저장
            </button>
          </div>
          {report.status === 'pending' && (
            <p className={ui.muted}>상태는 확인 필요 → 현장 확인 → 조치 완료 순서로 한 단계씩 바뀝니다.</p>
          )}
        </form>
      )}
    </div>
  );
}
