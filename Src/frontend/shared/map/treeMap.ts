// 공용 나무 지도(#27). 시민 웹(모바일)과 구청 웹(데스크탑)이 함께 쓴다.
//
// React·Vite 버전이 두 웹에서 달라서, 이 모듈은 React 없이 DOM만 쓴다. 각 웹은 useEffect 안에서
// createTreeMap(틀 요소, 옵션)을 부르고, 돌려받은 handle로 나무를 넣거나(setTrees) 고른 나무를 바꾼다(setSelected).
// 한쪽 화면만을 위한 동작은 이 파일을 고치지 않고 옵션으로 넘긴다(CLAUDE.md 경계 규칙).
//
// - 바탕: 카카오맵 키가 있으면 카카오맵, 없거나 불러오지 못하면 OSM 임시 지도(onEngine으로 알려 준다)
// - 마커: 미처리 신고 / 활동이 끊긴 나무 / 돌보미 나무 / 돌보미 없는 나무 (markers.ts)
// - 묶음: 화면에서 가까운 나무를 칸 단위로 묶어 숫자로 보여 주고, 누르면 그 자리로 확대한다
// - 출처: 가로수 데이터는 공공누리 제4유형이라 출처를 지도 위에 항상 보여 준다
import './treeMap.css';
import type { MapEngine, MarkerHandle } from './engine';
import { createKakaoEngine } from './kakao';
import { clusterByGrid, MARKER_LABEL, markerKind, mostUrgent, type MarkerKind, type ScreenPoint } from './markers';
import { createOsmEngine } from './osm';
import type { Bbox, LatLng, MapEngineKind, MapTree } from './types';

// ── 기준값 ──
const CLUSTER_CELL_PX = 48; // 이 크기(px) 칸 안의 나무를 하나로 묶는다
const CLUSTER_UNTIL_ZOOM = 17; // 이 줌부터는 묶지 않고 한 그루씩 보여 준다(OSM 줌 17 ≈ 카카오 level 3, 가로수 간격이 점 하나 정도)
const CLUSTER_ZOOM_STEP = 2; // 묶음을 누르면 이만큼 확대한다
const CLUSTER_MAX_LABEL = 999; // 이보다 많으면 "999+"로 줄인다

export const TREE_DATA_ATTRIBUTION = '가로수: 서울특별시, 서울 열린데이터광장 (공공누리 제4유형)';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export type TreeMapOptions<T extends MapTree> = {
  /** 카카오맵 JavaScript 키. 비우면 OSM 임시 지도를 쓴다 */
  kakaoKey?: string | null;
  center: LatLng;
  /** 처음 확대 단계(OSM 줌 11~19, 클수록 확대) */
  zoom: number;
  /** 지도가 멈출 때마다 부른다. 이 범위로 GET /trees?bbox= 를 다시 부르면 된다 */
  onBoundsChange?: (view: { bbox: Bbox; zoom: number; center: LatLng }) => void;
  /** 나무 마커를 누르면 부른다 */
  onSelect?: (tree: T) => void;
  /** 바탕이 정해지면 부른다. 카카오맵을 못 불러와 OSM으로 바꿨으면 error가 있다 */
  onEngine?: (kind: MapEngineKind, error: Error | null) => void;
  /** 마커 종류를 화면에서 다르게 정하고 싶을 때(기본: markerKind) */
  kindOf?: (tree: T) => MarkerKind;
};

export type TreeMapHandle<T extends MapTree> = {
  setTrees(trees: T[]): void;
  setSelected(id: number | null): void;
  setCenter(p: LatLng): void;
  /** p로 옮기고 적어도 minZoom까지 확대한다(목록에서 나무를 골랐을 때) */
  focus(p: LatLng, minZoom?: number): void;
  destroy(): void;
};

export function createTreeMap<T extends MapTree>(el: HTMLElement, options: TreeMapOptions<T>): TreeMapHandle<T> {
  const kindOf = options.kindOf ?? markerKind;
  let trees: T[] = [];
  let selectedId: number | null = null;
  let engine: MapEngine | null = null;
  let destroyed = false;
  let drawn: MarkerHandle[] = [];

  el.classList.add('tm-root');
  const canvas = document.createElement('div');
  canvas.className = 'tm-canvas';
  const attribution = document.createElement('div');
  attribution.className = 'tm-attribution';
  attribution.textContent = TREE_DATA_ATTRIBUTION;
  el.append(canvas, attribution);

  function dotElement(tree: T, selected: boolean): HTMLElement {
    const kind = kindOf(tree);
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `tm-dot tm-dot--${kind}${selected ? ' is-selected' : ''}`;
    node.title = `${tree.name} · ${MARKER_LABEL[kind]}`;
    node.setAttribute('aria-label', node.title);
    if (selected) node.setAttribute('aria-pressed', 'true');
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedId = tree.id;
      draw();
      options.onSelect?.(tree);
    });
    return node;
  }

  function clusterElement(items: T[], at: LatLng): HTMLElement {
    const kind = mostUrgent(items.map(kindOf));
    const count = items.length;
    const node = document.createElement('button');
    node.type = 'button';
    const size = count >= 100 ? 'l' : count >= 10 ? 'm' : 's';
    node.className = `tm-cluster tm-cluster--${kind} tm-cluster--${size}`;
    node.textContent = count > CLUSTER_MAX_LABEL ? `${CLUSTER_MAX_LABEL}+` : String(count);
    // 안에 급한 나무(미처리 신고·활동 끊김)가 있으면 모서리에 그 수를 달아 묶음 속에서도 보이게 한다
    const urgent = items.filter((t) => URGENT_KINDS.includes(kindOf(t))).length;
    if (urgent > 0) {
      const badge = document.createElement('span');
      badge.className = `tm-badge tm-badge--${kind}`;
      badge.textContent = String(urgent);
      node.appendChild(badge);
    }
    node.setAttribute('aria-label', `나무 ${count}그루 묶음(${MARKER_LABEL[kind]} 포함). 눌러서 확대`);
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      engine?.zoomInAt(at, CLUSTER_ZOOM_STEP);
    });
    return node;
  }

  // 마커를 모두 지우고 지금 화면 기준으로 다시 묶어 그린다. 지도가 멈출 때·나무가 바뀔 때 부른다
  function draw() {
    if (!engine) return;
    const map = engine;
    drawn.forEach((m) => m.remove());
    drawn = [];

    const cell = map.getZoom() >= CLUSTER_UNTIL_ZOOM ? 0 : CLUSTER_CELL_PX;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const points: ScreenPoint<T>[] = [];
    let selected: T | null = null;
    for (const t of trees) {
      if (t.id === selectedId) {
        selected = t; // 고른 나무는 묶지 않고 맨 위에 따로 그린다
        continue;
      }
      const px = map.toPixel(t.location);
      if (px.x < -cell || px.y < -cell || px.x > w + cell || px.y > h + cell) continue; // 화면 밖
      points.push({ ...px, item: t });
    }

    for (const c of clusterByGrid(points, cell)) {
      if (c.items.length === 1) {
        const t = c.items[0];
        drawn.push(map.addMarker(t.location, dotElement(t, false), zIndexOf(kindOf(t))));
      } else {
        const at = {
          lat: c.items.reduce((s, t) => s + t.location.lat, 0) / c.items.length,
          lng: c.items.reduce((s, t) => s + t.location.lng, 0) / c.items.length,
        };
        drawn.push(map.addMarker(at, clusterElement(c.items, at), 10 + zIndexOf(mostUrgent(c.items.map(kindOf)))));
      }
    }
    if (selected) drawn.push(map.addMarker(selected.location, dotElement(selected, true), 100));
  }

  function report() {
    // 지운 뒤나 틀이 페이지에서 빠진 뒤에 늦게 온 idle은 알리지 않는다.
    // 다른 화면으로 넘어갈 때 React는 틀을 먼저 떼고 effect 정리는 나중에 하므로, 그 사이 알림이 주소를 되돌리지 않게 한다
    if (!engine || destroyed || !el.isConnected) return;
    const bbox = engine.getBounds();
    const center = { lng: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 };
    options.onBoundsChange?.({ bbox, zoom: engine.getZoom(), center });
  }

  function start(next: MapEngine, error: Error | null) {
    if (destroyed) return next.destroy();
    engine = next;
    if (next.kind === 'osm') attribution.textContent = `${OSM_ATTRIBUTION} · ${TREE_DATA_ATTRIBUTION}`;
    next.onIdle(() => {
      if (destroyed) return;
      draw();
      report();
    });
    options.onEngine?.(next.kind, error);
    draw();
    report();
  }

  const startOsm = (error: Error | null) => start(createOsmEngine(canvas, options.center, options.zoom), error);
  if (options.kakaoKey) {
    createKakaoEngine(canvas, options.kakaoKey, options.center, options.zoom).then(
      (e) => start(e, null),
      (e: Error) => !destroyed && startOsm(e),
    );
  } else {
    startOsm(null);
  }

  return {
    setTrees(next) {
      trees = next;
      draw();
    },
    setSelected(id) {
      if (id === selectedId) return;
      selectedId = id;
      draw();
    },
    setCenter(p) {
      engine?.setCenter(p);
    },
    focus(p, minZoom = CLUSTER_UNTIL_ZOOM) {
      if (!engine) return;
      engine.setView(p, Math.max(engine.getZoom(), minZoom));
    },
    destroy() {
      destroyed = true;
      drawn.forEach((m) => m.remove());
      engine?.destroy();
      el.classList.remove('tm-root');
      el.innerHTML = '';
    },
  };
}

// 묶음에 따로 수를 달아 줄 급한 종류
const URGENT_KINDS: readonly MarkerKind[] = ['report', 'inactive'];

// 급한 종류일수록 위에 그린다
function zIndexOf(kind: MarkerKind): number {
  return { report: 4, inactive: 3, cared: 2, uncared: 1 }[kind];
}
