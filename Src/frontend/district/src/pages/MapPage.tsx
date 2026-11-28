// 나무 지도 (#27). 공용 지도 컴포넌트(Src/frontend/shared/map)로 관리청 나무를 한 화면에 보여 준다.
// 미처리 신고·관리 사각지대(돌보미 없음, 이번 달 활동 끊김)·돌보미 나무를 색으로 나누고, 누르면 오른쪽에 나무 정보를 보여 준다.
// 지도 위치(lat·lng·z)는 주소에 남겨 새로고침·뒤로 가기에도 같은 곳을 보여 준다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  createTreeMap,
  MARKER_KINDS,
  MARKER_LABEL,
  markerKind,
  MAX_ZOOM,
  MIN_ZOOM,
  type Bbox,
  type LatLng,
  type MapEngineKind,
  type MarkerKind,
  type TreeMapHandle,
} from '../../../shared/map';
import { useDashboard } from '../api/dashboard';
import { listIncidentReports } from '../api/incidentReports';
import { getTree, listTrees, type Tree, type TreeList } from '../api/trees';
import ui from '../components/ui.module.css';
import styles from './MapPage.module.css';

const KAKAO_KEY: string | undefined = import.meta.env.VITE_KAKAO_MAP_KEY || undefined;

// ── 기준값 ──
const SEOUL_CITY_HALL: LatLng = { lat: 37.5663, lng: 126.9779 }; // 관리청 위치를 못 찾을 때
const SEOUL_BBOX: Bbox = [126.76, 37.41, 127.19, 37.72]; // 서울 전체. 관리청 나무 위치를 찾을 때 쓴다
const DEFAULT_ZOOM = 16; // 처음 확대 단계(OSM 줌, 카카오 level 4 ≈ 동 하나). 15부터는 도심에서 나무가 2,000그루를 넘는다
const AGENCY_SAMPLE = 300; // 관리청 가운데를 잡을 때 받아 보는 나무 수
const OPEN_REPORT_LIMIT = 200; // 처리 중 신고를 한 번에 받는 수(API 최대값)

const KIND_HINT: Record<MarkerKind, string> = {
  report: '조치 완료 전인 이상 신고가 있음',
  inactive: '돌보미는 있는데 이번 달 활동 기록이 없음',
  cared: '돌보미가 이번 달 활동함',
  uncared: '이번 달 활동 기간이 걸친 돌보미가 없음',
};

/** 주소의 lat·lng·z. 하나라도 없거나 이상하면 null */
function readView(params: URLSearchParams): { center: LatLng; zoom: number } | null {
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const zoom = Number(params.get('z'));
  if (!params.get('lat') || !params.get('lng') || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { center: { lat, lng }, zoom: zoom >= MIN_ZOOM && zoom <= MAX_ZOOM ? zoom : DEFAULT_ZOOM };
}

/** 관리청(자치구) 나무 몇 그루의 위도·경도 가운데값. 구 이름으로 찾을 수 없으면 서울시청 */
async function agencyCenter(agency: string): Promise<LatLng> {
  if (!agency.endsWith('구')) return SEOUL_CITY_HALL;
  const { trees } = await listTrees(SEOUL_BBOX, { district: agency, limit: AGENCY_SAMPLE });
  if (trees.length === 0) return SEOUL_CITY_HALL;
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return { lat: median(trees.map((t) => t.location.lat)), lng: median(trees.map((t) => t.location.lng)) };
}

const inBbox = (p: LatLng, [minLng, minLat, maxLng, maxLat]: Bbox) =>
  p.lng >= minLng && p.lng <= maxLng && p.lat >= minLat && p.lat <= maxLat;

/**
 * 처리 중(확인 필요·현장 확인) 신고가 있는 나무. 지도를 넓게 보면 GET /trees가 일부 나무만 주므로(truncated)
 * 급한 나무가 빠지지 않게 신고 처리 큐에서 따로 받아 지도에 더한다. 자세한 정보는 누를 때 GET /trees/{id}로 받는다.
 */
async function openReportTrees(): Promise<Tree[]> {
  const { items } = await listIncidentReports({ status: 'unresolved', limit: OPEN_REPORT_LIMIT, offset: 0 });
  const byTree = new Map<number, Tree>();
  for (const r of items) {
    if (byTree.has(r.tree.id)) continue;
    byTree.set(r.tree.id, {
      id: r.tree.id,
      name: [r.tree.species, r.tree.roadName].filter(Boolean).join(', '),
      code: null,
      species: r.tree.species,
      district: '',
      dong: null,
      roadName: r.tree.roadName,
      location: r.tree.location,
      caregiverCount: 0,
      hasOpenReport: true,
      careGap: null,
    });
  }
  return [...byTree.values()];
}

export function MapPage() {
  const [params, setParams] = useSearchParams();
  const { data: dashboard } = useDashboard({});
  const [start, setStart] = useState(() => readView(params));
  const [list, setList] = useState<TreeList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<{ kind: MapEngineKind; error: Error | null } | null>(null);
  const [hidden, setHidden] = useState<Set<MarkerKind>>(new Set());
  const [selected, setSelected] = useState<Tree | null>(null);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [reportTrees, setReportTrees] = useState<Tree[]>([]);

  useEffect(() => {
    openReportTrees()
      .then(setReportTrees)
      .catch(() => setReportTrees([])); // 못 받아도 지도는 GET /trees 나무만으로 보여 준다
  }, []);

  // 누른 나무의 자세한 정보(관리번호·동 등)를 다시 받는다
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    getTree(selectedId)
      .then((detail) => !cancelled && setSelected(detail))
      .catch(() => undefined); // 못 받으면 지도에서 받은 정보로 보여 준다
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // 주소에 위치가 없으면 관리청 나무가 있는 곳에서 시작한다
  useEffect(() => {
    if (start || !dashboard) return;
    let cancelled = false;
    agencyCenter(dashboard.agency)
      .catch(() => SEOUL_CITY_HALL)
      .then((center) => !cancelled && setStart({ center, zoom: DEFAULT_ZOOM }));
    return () => {
      cancelled = true;
    };
  }, [start, dashboard]);

  // 지도 만들기 (시작 위치가 정해진 뒤 한 번)
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<TreeMapHandle<Tree> | null>(null);
  const requestSeq = useRef(0);
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  useEffect(() => {
    if (!start || !box.current) return;
    const handle = createTreeMap<Tree>(box.current, {
      kakaoKey: KAKAO_KEY,
      center: start.center,
      zoom: start.zoom,
      onEngine: (kind, err) => setEngine({ kind, error: err }),
      // 같은 나무를 다시 누르면 이미 받아 둔 자세한 정보를 그대로 둔다
      onSelect: (tree) => setSelected((prev) => (prev?.id === tree.id ? prev : tree)),
      onBoundsChange: ({ bbox, zoom, center }) => {
        setParamsRef.current(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('lat', center.lat.toFixed(5));
            next.set('lng', center.lng.toFixed(5));
            next.set('z', String(zoom));
            return next;
          },
          { replace: true },
        );
        setBbox(bbox);
        // 늦게 온 옛 범위 응답이 새 범위를 덮지 않게 마지막 요청만 쓴다
        const seq = ++requestSeq.current;
        listTrees(bbox)
          .then((res) => {
            if (seq !== requestSeq.current) return;
            setList(res);
            setError(null);
          })
          .catch((e: Error) => seq === requestSeq.current && setError(e.message));
      },
    });
    map.current = handle;
    return () => {
      handle.destroy();
      map.current = null;
    };
  }, [start]);

  // 화면 범위의 나무 + 그 안의 처리 중 신고 나무(목록에 없을 때만)
  // 넓게 봐서 GET /trees가 일부만 줬으면(truncated) 그 일부는 어느 구역에 몰려 있을 수 있어 그리지 않고,
  // 빠짐없이 받은 신고 나무만 보여 준다. 확대하면 모든 나무가 보인다.
  const truncated = list?.truncated ?? false;
  const trees = useMemo(() => {
    const base = truncated ? [] : (list?.trees ?? []);
    const ids = new Set(base.map((t) => t.id));
    const extra = bbox ? reportTrees.filter((t) => !ids.has(t.id) && inBbox(t.location, bbox)) : [];
    return [...base, ...extra];
  }, [list, truncated, reportTrees, bbox]);
  const visibleTrees = useMemo(() => trees.filter((t) => !hidden.has(markerKind(t))), [trees, hidden]);
  useEffect(() => map.current?.setTrees(visibleTrees), [visibleTrees]);
  useEffect(() => map.current?.setSelected(selectedId), [selectedId]);

  const counts = useMemo(() => {
    const c: Record<MarkerKind, number> = { report: 0, inactive: 0, cared: 0, uncared: 0 };
    for (const t of trees) c[markerKind(t)] += 1;
    return c;
  }, [trees]);

  // 오른쪽 목록: 미처리 신고 나무(관리청 전체)와 지금 화면에서 활동이 끊긴 나무
  const inactiveInView = useMemo(() => trees.filter((t) => markerKind(t) === 'inactive'), [trees]);

  function pick(tree: Tree) {
    setSelected(tree);
    map.current?.focus(tree.location);
  }

  function toggle(kind: MarkerKind) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <div className={ui.page}>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>나무 지도</h1>
          <p className={ui.lead}>
            지금 보이는 범위의 나무입니다. 묶음 숫자를 누르면 그 자리로 확대합니다.
          </p>
        </div>
      </div>

      <fieldset className={styles.legend}>
        <legend className="sr-only">지도에 보일 나무 종류</legend>
        {MARKER_KINDS.map((kind) => (
          <label key={kind} className={styles.legendItem} title={KIND_HINT[kind]}>
            <input type="checkbox" checked={!hidden.has(kind)} onChange={() => toggle(kind)} />
            <span className={`tm-dot tm-dot--${kind}`} aria-hidden="true" />
            <span>{MARKER_LABEL[kind]}</span>
            <span className={styles.legendCount}>{!list || (truncated && kind !== 'report') ? '-' : counts[kind].toLocaleString()}</span>
          </label>
        ))}
      </fieldset>

      {engine?.error && (
        <p className={ui.hint}>카카오맵을 불러오지 못해 임시 지도(OpenStreetMap)로 보여 줍니다. ({engine.error.message})</p>
      )}
      {!KAKAO_KEY && engine?.kind === 'osm' && (
        <p className={ui.hint}>카카오맵 키(Src/.env의 VITE_KAKAO_MAP_KEY)가 없어 임시 지도(OpenStreetMap)로 보여 줍니다.</p>
      )}
      {truncated && (
        <p className={ui.hint}>
          이 범위에는 나무가 너무 많아 미처리 신고 나무만 보여 줍니다. 확대하면 모든 나무가 보입니다.
        </p>
      )}
      {error && <p className={ui.error}>나무를 불러오지 못했습니다. {error}</p>}

      <div className={styles.body}>
        <div className={styles.map}>
          {/* 이 안은 공용 지도가 직접 그리므로 React 자식을 두지 않는다 */}
          <div ref={box} className={styles.canvas} />
          {!start && <p className={styles.loading}>관리청 위치를 찾는 중…</p>}
        </div>
        <aside className={styles.side} aria-live="polite">
          {selected ? (
            <TreeInfo tree={selected} onClose={() => setSelected(null)} />
          ) : (
            <UrgentList reports={reportTrees} inactive={inactiveInView} truncated={truncated} onPick={pick} />
          )}
        </aside>
      </div>
    </div>
  );
}

/** 처리가 필요한 나무 목록. 누르면 지도가 그 나무로 옮겨 가고 정보를 보여 준다 */
function UrgentList({
  reports,
  inactive,
  truncated,
  onPick,
}: {
  reports: Tree[];
  inactive: Tree[];
  truncated: boolean;
  onPick: (tree: Tree) => void;
}) {
  return (
    <div className={styles.urgent}>
      <h2 className={ui.panelTitle}>처리가 필요한 나무</h2>
      <section>
        <h3 className={styles.urgentTitle}>
          <span className="tm-dot tm-dot--report" aria-hidden="true" />
          미처리 신고 <span className={styles.urgentCount}>{reports.length}</span>
          <span className={ui.muted}> · 관리청 전체</span>
        </h3>
        <TreeButtons trees={reports} onPick={onPick} empty="처리 중인 신고가 없습니다." />
      </section>
      <section>
        <h3 className={styles.urgentTitle}>
          <span className="tm-dot tm-dot--inactive" aria-hidden="true" />
          활동이 끊긴 나무 <span className={styles.urgentCount}>{truncated ? '-' : inactive.length}</span>
          <span className={ui.muted}> · 지금 화면</span>
        </h3>
        <TreeButtons
          trees={truncated ? [] : inactive}
          onPick={onPick}
          empty={truncated ? '확대하면 보입니다.' : '지금 화면에는 없습니다.'}
        />
      </section>
      <p className={ui.muted}>지도에서 나무를 누르면 정보를 보여 줍니다.</p>
    </div>
  );
}

function TreeButtons({ trees, onPick, empty }: { trees: Tree[]; onPick: (tree: Tree) => void; empty: string }) {
  if (trees.length === 0) return <p className={ui.muted}>{empty}</p>;
  return (
    <ul className={styles.urgentList}>
      {trees.map((t) => (
        <li key={t.id}>
          <button type="button" className={styles.urgentItem} onClick={() => onPick(t)}>
            {t.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

function TreeInfo({ tree, onClose }: { tree: Tree; onClose: () => void }) {
  const kind = markerKind(tree);
  return (
    <div className={styles.info}>
      <div className={styles.infoHead}>
        <h2 className={ui.panelTitle}>{tree.name}</h2>
        <button type="button" className={`${ui.button} ${ui.small}`} onClick={onClose}>
          닫기
        </button>
      </div>
      <p className={styles.kind}>
        <span className={`tm-dot tm-dot--${kind}`} aria-hidden="true" />
        {MARKER_LABEL[kind]}
        <span className={ui.muted}> · {KIND_HINT[kind]}</span>
      </p>
      <dl className={ui.facts}>
        <dt>관리번호</dt>
        <dd>{tree.code ?? `나무 #${tree.id}`}</dd>
        <dt>수종</dt>
        <dd>{tree.species}</dd>
        <dt>위치</dt>
        <dd>{[tree.district, tree.dong, tree.roadName].filter(Boolean).join(' ') || '-'}</dd>
        <dt>돌보미</dt>
        <dd>{tree.caregiverCount > 0 ? `${tree.caregiverCount}명` : '없음'}</dd>
      </dl>
      {tree.hasOpenReport && (
        <Link to="/incident-reports" className={`${ui.button} ${ui.primary}`}>
          신고 처리로 가기
        </Link>
      )}
    </div>
  );
}
