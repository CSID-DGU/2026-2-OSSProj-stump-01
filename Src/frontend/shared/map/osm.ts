// OSM 임시 지도 바탕. 카카오맵 키가 없거나 SDK를 못 불러올 때 쓴다(라이브러리·키 없음).
// OpenStreetMap 타일을 웹 메르카토르 좌표로 깔고, 끌기·휠·+/− 버튼으로 움직인다.
// 타일 서버는 OSM 재단의 기본 서버라 개발·시연 규모에서만 쓴다.
import { clampZoom, MAX_ZOOM, MIN_ZOOM, type MapEngine, type MarkerHandle } from './engine';
import type { Bbox, LatLng } from './types';

const TILE_PX = 256;
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const CLICK_TOLERANCE_PX = 4; // 이만큼 안 움직이고 떼면 끌기가 아니다
const IDLE_DELAY_MS = 200; // 휠을 연달아 돌릴 때 멈춘 뒤 한 번만 알린다

// ── 웹 메르카토르: 경도·위도 ↔ 0~1 월드 좌표 ──
const toWorldX = (lng: number) => (lng + 180) / 360;
const toWorldY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};
const fromWorldX = (x: number) => x * 360 - 180;
const fromWorldY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

export function createOsmEngine(el: HTMLElement, center: LatLng, zoom: number): MapEngine {
  let cx = toWorldX(center.lng);
  let cy = toWorldY(center.lat);
  let z = clampZoom(zoom);

  el.classList.add('tm-osm');
  const pane = document.createElement('div');
  pane.className = 'tm-osm-pane';
  const tileLayer = document.createElement('div');
  tileLayer.className = 'tm-osm-tiles';
  const markerLayer = document.createElement('div');
  markerLayer.className = 'tm-osm-markers';
  pane.append(tileLayer, markerLayer);

  const zoomBox = document.createElement('div');
  zoomBox.className = 'tm-osm-zoom';
  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.textContent = '+';
  zoomIn.setAttribute('aria-label', '확대');
  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.textContent = '−';
  zoomOut.setAttribute('aria-label', '축소');
  zoomBox.append(zoomIn, zoomOut);
  el.append(pane, zoomBox);

  const tiles = new Map<string, HTMLImageElement>();
  const markers = new Set<{ p: LatLng; node: HTMLElement }>();
  const idleHandlers: (() => void)[] = [];
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const scale = () => TILE_PX * 2 ** z;
  // 지도 틀 왼쪽 위의 월드 px
  const origin = () => ({ x: cx * scale() - el.clientWidth / 2, y: cy * scale() - el.clientHeight / 2 });
  const toPixel = (p: LatLng) => {
    const o = origin();
    return { x: toWorldX(p.lng) * scale() - o.x, y: toWorldY(p.lat) * scale() - o.y };
  };

  function render() {
    const o = origin();
    const n = 2 ** z;
    const want = new Set<string>();
    for (let tx = Math.floor(o.x / TILE_PX); tx <= Math.floor((o.x + el.clientWidth) / TILE_PX); tx++) {
      for (let ty = Math.floor(o.y / TILE_PX); ty <= Math.floor((o.y + el.clientHeight) / TILE_PX); ty++) {
        if (ty < 0 || ty >= n) continue;
        const key = `${z}/${tx}/${ty}`;
        want.add(key);
        let img = tiles.get(key);
        if (!img) {
          img = document.createElement('img');
          img.alt = '';
          img.draggable = false;
          img.src = TILE_URL(z, ((tx % n) + n) % n, ty);
          tileLayer.appendChild(img);
          tiles.set(key, img);
        }
        img.style.left = `${tx * TILE_PX - o.x}px`;
        img.style.top = `${ty * TILE_PX - o.y}px`;
      }
    }
    for (const [key, img] of tiles) {
      if (!want.has(key)) {
        img.remove();
        tiles.delete(key);
      }
    }
    for (const m of markers) {
      const px = toPixel(m.p);
      m.node.style.left = `${px.x}px`;
      m.node.style.top = `${px.y}px`;
    }
  }

  function idleSoon() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idleHandlers.forEach((cb) => cb()), IDLE_DELAY_MS);
  }

  /** 화면의 (mx, my) 지점이 그대로 있도록 줌을 바꾼다 */
  function setZoomAround(next: number, mx: number, my: number) {
    next = clampZoom(next);
    if (next === z) return;
    const o = origin();
    const wx = (o.x + mx) / scale();
    const wy = (o.y + my) / scale();
    z = next;
    cx = wx - (mx - el.clientWidth / 2) / scale();
    cy = wy - (my - el.clientHeight / 2) / scale();
    render();
    idleSoon();
  }

  // ── 끌기 ──
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    // 마커·버튼 위에서 시작한 포인터는 끌기가 아니다(캡처하면 클릭이 사라진다)
    if ((e.target as HTMLElement).closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, cx, cy, moved: false };
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > CLICK_TOLERANCE_PX) drag.moved = true;
    cx = drag.cx - dx / scale();
    cy = drag.cy - dy / scale();
    render();
  };
  const onUp = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    el.classList.remove('is-dragging');
    if (moved) idleSoon();
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    setZoomAround(z + (e.deltaY < 0 ? 1 : -1), e.clientX - rect.left, e.clientY - rect.top);
  };
  const onZoomIn = () => setZoomAround(z + 1, el.clientWidth / 2, el.clientHeight / 2);
  const onZoomOut = () => setZoomAround(z - 1, el.clientWidth / 2, el.clientHeight / 2);

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  zoomIn.addEventListener('click', onZoomIn);
  zoomOut.addEventListener('click', onZoomOut);

  const resizeObserver = new ResizeObserver(() => {
    render();
    idleSoon();
  });
  resizeObserver.observe(el);
  render();

  return {
    kind: 'osm',
    getBounds(): Bbox {
      const o = origin();
      const s = scale();
      return [
        fromWorldX(o.x / s),
        fromWorldY((o.y + el.clientHeight) / s),
        fromWorldX((o.x + el.clientWidth) / s),
        fromWorldY(o.y / s),
      ];
    },
    getZoom: () => z,
    toPixel,
    setCenter(p) {
      cx = toWorldX(p.lng);
      cy = toWorldY(p.lat);
      render();
      idleSoon();
    },
    zoomInAt(p, by) {
      cx = toWorldX(p.lng);
      cy = toWorldY(p.lat);
      z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + by));
      render();
      idleSoon();
    },
    addMarker(p, node, zIndex): MarkerHandle {
      const m = { p, node };
      node.classList.add('tm-osm-marker');
      node.style.zIndex = String(zIndex);
      const px = toPixel(p);
      node.style.left = `${px.x}px`;
      node.style.top = `${px.y}px`;
      markerLayer.appendChild(node);
      markers.add(m);
      return {
        remove() {
          node.remove();
          markers.delete(m);
        },
      };
    },
    onIdle(cb) {
      idleHandlers.push(cb);
    },
    destroy() {
      clearTimeout(idleTimer);
      resizeObserver.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.classList.remove('tm-osm', 'is-dragging');
      el.innerHTML = '';
    },
  };
}
