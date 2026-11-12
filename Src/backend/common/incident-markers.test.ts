import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createIncident, createTree, createUser, resetData } from '../test/fixtures.js';
import { closePool, getPool } from './db.js';
import { monthlyIncidentMarkers } from './incident-markers.js';

beforeEach(resetData);
afterAll(closePool);

describe('monthlyIncidentMarkers', () => {
  it('한 나무의 한 해 신고·조치 수를 한국 시간 월별 12개로 센다', async () => {
    const user = await createUser();
    const tree = await createTree();
    const otherTree = await createTree();
    // 3월 신고 → 4월 조치 완료
    const a = await createIncident({ userId: user.id, treeId: tree, createdAt: '2026-03-10T00:00:00Z' });
    await getPool().query(
      "UPDATE reports SET status = 'resolved', inspected_at = '2026-03-11T00:00:00Z', resolved_at = '2026-04-02T00:00:00Z', action_note = 'x' WHERE id = $1",
      [a],
    );
    // 한국 시간으로 7월 1일(UTC로는 6월 30일) 신고, 미처리
    await createIncident({ userId: user.id, treeId: tree, createdAt: '2026-06-30T16:00:00Z' });
    // 다른 해, 다른 나무는 세지 않는다
    await createIncident({ userId: user.id, treeId: tree, createdAt: '2025-03-10T00:00:00Z' });
    await createIncident({ userId: user.id, treeId: otherTree, createdAt: '2026-03-10T00:00:00Z' });

    const markers = await monthlyIncidentMarkers(getPool(), tree, 2026);

    expect(markers).toHaveLength(12);
    expect(markers[2]).toEqual({ month: 3, reported: 1, resolved: 0 });
    expect(markers[3]).toEqual({ month: 4, reported: 0, resolved: 1 });
    expect(markers[5]).toEqual({ month: 6, reported: 0, resolved: 0 });
    expect(markers[6]).toEqual({ month: 7, reported: 1, resolved: 0 });
    expect(markers.reduce((n, m) => n + m.reported, 0)).toBe(2);
  });
});
