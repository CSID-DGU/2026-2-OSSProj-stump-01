// 지도 바탕(카카오맵·OSM 임시 지도)이 공통으로 해 줘야 하는 일.
// 나무 마커·묶음은 treeMap.ts가 이 함수들만 써서 그리므로, 바탕을 바꿔도 마커 규칙은 그대로다.
import type { Bbox, LatLng, MapEngineKind } from './types';

/**
 * 확대 단계는 OSM(웹 메르카토르) 줌으로 통일한다. 클수록 확대.
 * 카카오맵 level과는 zoom = 20 - level 관계다(level 4 ≈ zoom 16 ≈ 휴대폰 화면 가로 700m).
 */
export const MIN_ZOOM = 11; // 서울 전체가 보이는 정도
export const MAX_ZOOM = 19;

export interface MarkerHandle {
  remove(): void;
}

export interface MapEngine {
  readonly kind: MapEngineKind;
  getBounds(): Bbox;
  getZoom(): number;
  /** 위도·경도 → 지도 틀 왼쪽 위 기준 px */
  toPixel(p: LatLng): { x: number; y: number };
  setCenter(p: LatLng): void;
  /** p를 가운데 두고 by 단계 확대 */
  zoomInAt(p: LatLng, by: number): void;
  /** p를 가운데 두고 zoom 단계로 맞춘다 */
  setView(p: LatLng, zoom: number): void;
  /** 화면 크기가 고정된 HTML 요소를 좌표에 붙인다(요소의 가운데가 좌표에 온다) */
  addMarker(p: LatLng, el: HTMLElement, zIndex: number): MarkerHandle;
  /** 끌기·확대가 끝나 지도가 멈추면 부른다 */
  onIdle(cb: () => void): void;
  destroy(): void;
}

export const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z)));
