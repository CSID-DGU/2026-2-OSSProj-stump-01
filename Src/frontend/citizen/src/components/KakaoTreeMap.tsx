// 카카오맵 위에 나무를 점으로 그린다. 끌기·확대는 카카오맵이 처리하고,
// 화면 범위가 바뀌면(idle) onBoundsChange 로 bbox 를 알려 준다 → MapPage 가 그 범위의 나무를 다시 받는다.
// 점은 CustomOverlay(HTML 요소)라 확대 단계와 상관없이 같은 픽셀 크기다 (미터 단위 Circle 은 멀리서 안 보였다).
// 공용 지도 컴포넌트(frontend/shared, 오승현)가 나오면 이 파일을 그쪽으로 옮기거나 교체한다.
import { useEffect, useRef, useState } from "react";
import type { Bbox, Tree } from "../lib/api";
import { loadKakao, type KakaoMap, type KakaoOverlay, type KakaoSdk } from "../lib/kakao";

// 내 위치: 위도·경도와, 브라우저가 알려 준 오차 반경(m). 오차가 있으면 실제 크기의 원으로 그린다
export type MyLocation = { lat: number; lng: number; accuracy?: number };
const ACCURACY_COLOR = "#4f7fbf"; // styles/tokens.css 의 --cold (카카오 원은 CSS 변수를 못 읽는다)

// 내 위치 점과 오차 원을 (다시) 그린다. 이동(flyTo)과 점만 찍기(me)가 같이 쓴다
function drawMeDot(sdk: KakaoSdk, map: KakaoMap, overlays: { current: KakaoOverlay[] }, at: MyLocation) {
  const position = new sdk.maps.LatLng(at.lat, at.lng);
  overlays.current.forEach((o) => o.setMap(null));
  const node = document.createElement("div");
  node.className = "me-dot";
  node.setAttribute("aria-label", at.accuracy ? `내 위치 (오차 약 ${Math.round(at.accuracy)}m)` : "내 위치");
  const dot = new sdk.maps.CustomOverlay({ position, content: node, xAnchor: 0.5, yAnchor: 0.5, zIndex: 3 });
  overlays.current = [dot];
  if (at.accuracy) {
    // 진짜 위치는 이 원 안 어딘가다. 노트북(와이파이 추정)은 수십~백여 m, 휴대폰(GPS)은 보통 수 m
    overlays.current.unshift(
      new sdk.maps.Circle({ center: position, radius: at.accuracy, strokeWeight: 1, strokeColor: ACCURACY_COLOR, strokeOpacity: 0.6, fillColor: ACCURACY_COLOR, fillOpacity: 0.12, zIndex: 1 }),
    );
  }
  overlays.current.forEach((o) => o.setMap(map));
  return position;
}

interface Props {
  appKey: string;
  center: { lat: number; lng: number };
  level: number; // 카카오맵 확대 단계. 작을수록 확대. 4 ≈ 가로 700m
  trees: Tree[];
  selectedId?: number;
  onSelect: (tree: Tree) => void;
  onBoundsChange: (bbox: Bbox) => void;
  flyTo?: MyLocation | null; // 바뀌면 그 위치로 이동하고 내 위치(오차 원 포함)를 그린다
  kindOf?: (tree: Tree) => string; // 나무 점에 붙일 종류 이름 (CSS 클래스 tree-dot--종류). 없으면 모두 같은 점
  me?: MyLocation | null; // 지도를 옮기지 않고 내 위치 점(오차 원 포함)만 그린다 (내 나무 찾아가기에서 걸어가며 갱신)
}

export default function KakaoTreeMap({ appKey, center, level, trees, selectedId, onSelect, onBoundsChange, flyTo, kindOf, me }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const sdkRef = useRef<KakaoSdk | null>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const dots = useRef<Map<number, { overlay: KakaoOverlay; node: HTMLElement }>>(new Map());
  const meOverlay = useRef<KakaoOverlay[]>([]); // 내 위치 표시 (점 + 오차 원)
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 최신 콜백을 ref 로 들고 있어야 idle 리스너가 옛 클로저를 부르지 않는다
  const onBoundsRef = useRef(onBoundsChange); onBoundsRef.current = onBoundsChange;
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;

  // 지도 만들기 (한 번)
  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    loadKakao(appKey).then((sdk) => {
      if (cancelled || !el.current) return;
      sdkRef.current = sdk;
      const map = new sdk.maps.Map(el.current, { center: new sdk.maps.LatLng(center.lat, center.lng), level });
      map.addControl(new sdk.maps.ZoomControl(), sdk.maps.ControlPosition.RIGHT);
      mapRef.current = map;
      const report = () => {
        const b = map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast();
        onBoundsRef.current([sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()]);
      };
      sdk.maps.event.addListener(map, "idle", report);
      report();
      // 지도 틀 크기가 바뀌면(화면 회전·창 크기 변경) 카카오맵이 일부만 그려지므로 다시 그리게 한다
      resizeObserver = new ResizeObserver(() => map.relayout());
      resizeObserver.observe(el.current);
      setReady(true);
    }).catch((e: Error) => setError(e.message));
    return () => { cancelled = true; resizeObserver?.disconnect(); };
    // center/level 은 처음 값만 쓴다. 이후 이동은 사용자가 지도를 끌어서 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appKey]);

  // 나무 점 그리기: 바뀐 것만 더하고 빼서 깜빡임을 줄인다
  useEffect(() => {
    const sdk = sdkRef.current, map = mapRef.current;
    if (!sdk || !map) return;
    const next = new Set(trees.map((t) => t.id));
    for (const [id, d] of dots.current) if (!next.has(id)) { d.overlay.setMap(null); dots.current.delete(id); }
    for (const t of trees) {
      if (dots.current.has(t.id)) continue;
      const node = document.createElement("button");
      node.className = "tree-dot";
      node.type = "button";
      node.setAttribute("aria-label", t.name);
      node.addEventListener("click", (e) => { e.stopPropagation(); onSelectRef.current(t); });
      const overlay = new sdk.maps.CustomOverlay({ position: new sdk.maps.LatLng(t.location.lat, t.location.lng), content: node, xAnchor: 0.5, yAnchor: 0.5, zIndex: 2 });
      overlay.setMap(map);
      dots.current.set(t.id, { overlay, node });
    }
  }, [trees, ready]);

  // 선택 강조 + 나무 종류(내 나무 등). 종류는 내 신청 현황이 늦게 와도 바뀌도록 여기서 다시 붙인다
  useEffect(() => {
    const byId = new Map(trees.map((t) => [t.id, t]));
    for (const [id, d] of dots.current) {
      const t = byId.get(id);
      d.node.className = `tree-dot${kindOf && t ? ` tree-dot--${kindOf(t)}` : ""}${id === selectedId ? " on" : ""}`;
    }
  }, [selectedId, trees, kindOf]);

  // 현재 위치로 이동 + 내 위치 점 표시 (다시 누르면 위치를 갱신)
  useEffect(() => {
    const sdk = sdkRef.current, map = mapRef.current;
    if (!sdk || !map || !flyTo) return;
    map.setCenter(drawMeDot(sdk, map, meOverlay, flyTo));
  }, [flyTo, ready]);

  // 내 위치 점만 갱신 (지도는 그대로)
  useEffect(() => {
    const sdk = sdkRef.current, map = mapRef.current;
    if (!sdk || !map || !me) return;
    drawMeDot(sdk, map, meOverlay, me);
  }, [me, ready]);

  return (
    <div className="map kakao">
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {error && <p className="map-error">{error}</p>}
      <div className="attribution">가로수: 서울 열린데이터광장</div>
    </div>
  );
}
