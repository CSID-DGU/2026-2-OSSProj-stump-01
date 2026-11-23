// 임시 지도. 지도 API(카카오/네이버)가 정해지고 공용 지도 컴포넌트(frontend/shared)가 나오면 교체한다.
// 배경은 OpenStreetMap 타일(라이브러리·키 없음), 그 위에 나무를 점으로 찍는다.
// 끌어서 이동, +/− 로 확대·축소. 배경은 채도를 낮춰 나무가 도드라지게 한다.
import { useRef, useState, type PointerEvent } from "react";
import type { Bbox, Tree } from "../lib/api";

interface Props {
  bbox: Bbox;
  trees: Tree[];
  selectedId?: number;
  onSelect: (tree: Tree) => void;
  onPan: (dLng: number, dLat: number) => void;
  onZoom: (dir: "in" | "out") => void;
  me?: { lat: number; lng: number } | null; // 내 위치 (있으면 파란 점)
  kindOf?: (tree: Tree) => string; // 나무 점에 붙일 종류 이름 (CSS 클래스 tree--종류). 없으면 모두 같은 점
}

const CLICK_TOLERANCE_PX = 4; // 이 거리 안에서 떼면 끌기가 아니라 클릭
const HIT_RADIUS_PX = 14; // 클릭 지점에서 이 거리 안의 가장 가까운 나무를 고른다 (손가락 크기 고려)
// OpenStreetMap 기본 타일(키 없음, 개발·시연 규모용). 회색조·저대비로 바꾸고 크림색 막을 덮어 나무가 도드라지게 한다 (styles.css .tiles).
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const MAP_WIDTH_PX_GUESS = 400; // 타일 줌 단계를 고를 때 쓰는 대략의 화면 폭
const MIN_ZOOM = 10, MAX_ZOOM = 19;

// ── 웹 메르카토르 투영: 경도·위도 → 0~1 사이의 월드 좌표 ──
const toWorldX = (lng: number) => (lng + 180) / 360;
const toWorldY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

export default function TreeMap({ bbox, trees, selectedId, onSelect, onPan, onZoom, me, kindOf }: Props) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  // bbox 의 월드 좌표 범위. 점·타일 모두 이 범위 안의 비율(0~1)로 놓는다.
  const wx0 = toWorldX(minLng), wx1 = toWorldX(maxLng);
  const wy0 = toWorldY(maxLat), wy1 = toWorldY(minLat); // 위도가 클수록 위(y 작음)
  const fx = (lng: number) => (toWorldX(lng) - wx0) / (wx1 - wx0);
  const fy = (lat: number) => (toWorldY(lat) - wy0) / (wy1 - wy0);

  // 타일: 화면 폭에 타일이 1.5~3장쯤 들어가는 줌을 고른다
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(Math.log2(MAP_WIDTH_PX_GUESS / 256 / (wx1 - wx0)))));
  const n = 2 ** zoom;
  const tiles: { x: number; y: number }[] = [];
  for (let tx = Math.floor(wx0 * n) - 1; tx <= Math.floor(wx1 * n) + 1; tx++)
    for (let ty = Math.floor(wy0 * n) - 1; ty <= Math.floor(wy1 * n) + 1; ty++)
      if (ty >= 0 && ty < n) tiles.push({ x: ((tx % n) + n) % n, y: ty });
  const tileSizePct = { w: (100 / n) / (wx1 - wx0), h: (100 / n) / (wy1 - wy0) };
  const tilePos = (tx: number, ty: number) => ({
    left: `${((tx / n - wx0) / (wx1 - wx0)) * 100}%`,
    top: `${((ty / n - wy0) / (wy1 - wy0)) * 100}%`,
  });

  // ── 끌기 ──
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  function down(e: PointerEvent<HTMLDivElement>) {
    // 버튼(+/−) 위에서 시작한 포인터는 끌기가 아니다. 여기서 캡처하면 버튼 click 이 사라진다.
    if ((e.target as HTMLElement).closest("button")) return;
    start.current = { x: e.clientX, y: e.clientY };
    dragged.current = false;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const dx = e.clientX - start.current.x, dy = e.clientY - start.current.y;
    if (Math.hypot(dx, dy) > CLICK_TOLERANCE_PX) dragged.current = true;
    setOffset({ x: dx, y: dy });
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - start.current.x, dy = e.clientY - start.current.y;
    start.current = null;
    setDragging(false);
    setOffset({ x: 0, y: 0 });
    if (dragged.current) {
      // 화면 px → 경도·위도 (작은 범위라 위도는 선형으로 근사)
      onPan(-(dx / rect.width) * (maxLng - minLng), (dy / rect.height) * (maxLat - minLat));
      return;
    }
    // 클릭: 포인터 캡처 때문에 circle 의 onClick 이 오지 않으므로, 뗀 위치에서 가장 가까운 나무를 직접 찾는다.
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    let best: Tree | null = null, bestDist = HIT_RADIUS_PX;
    for (const t of trees) {
      const d = Math.hypot(fx(t.location.lng) * rect.width - px, fy(t.location.lat) * rect.height - py);
      if (d < bestDist) { best = t; bestDist = d; }
    }
    if (best) onSelect(best);
  }

  return (
    <div
      className={`map${dragging ? " dragging" : ""}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      role="img"
      aria-label={`나무 ${trees.length}그루. 끌어서 이동`}
    >
      <div className="layer" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
        {/* 배경 타일 (채도 낮춤) */}
        <div className="tiles">
          {tiles.map((t) => (
            <img
              key={`${zoom}/${t.x}/${t.y}`}
              src={TILE_URL(zoom, t.x, t.y)}
              alt=""
              draggable={false}
              style={{ ...tilePos(t.x, t.y), width: `${tileSizePct.w}%`, height: `${tileSizePct.h}%` }}
            />
          ))}
        </div>
        <div className="wash" />
        {/* 나무 */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          {trees.map((t) => {
            const on = t.id === selectedId;
            return (
              <circle
                key={t.id}
                cx={fx(t.location.lng) * 100}
                cy={fy(t.location.lat) * 100}
                r={on ? 1.6 : 1}
                className={`tree${kindOf ? ` tree--${kindOf(t)}` : ""}${on ? " on" : ""}`}
              >
                <title>{t.species} · {t.roadName ?? t.dong ?? t.district}</title>
              </circle>
            );
          })}
        </svg>
        {me && <div className="me-dot" style={{ position: "absolute", left: `${fx(me.lng) * 100}%`, top: `${fy(me.lat) * 100}%`, transform: "translate(-50%, -50%)" }} aria-label="내 위치" />}
      </div>
      <div className="zoom" aria-label="확대 축소">
        <button onClick={() => onZoom("in")} aria-label="확대">+</button>
        <button onClick={() => onZoom("out")} aria-label="축소">−</button>
      </div>
      <div className="attribution">© OpenStreetMap contributors · 가로수: 서울 열린데이터광장</div>
    </div>
  );
}
