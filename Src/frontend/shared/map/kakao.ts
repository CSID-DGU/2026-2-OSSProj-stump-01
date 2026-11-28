// 카카오맵 바탕. SDK 스크립트를 한 번만 넣고, 준비되면 MapEngine으로 감싼다.
// 키는 Src/.env의 VITE_KAKAO_MAP_KEY. JavaScript 키는 카카오 개발자 콘솔에 등록한 도메인에서만 동작하는 공개용 키다
// (로컬 개발: 시민 웹 http://localhost:5173, 구청 웹 http://localhost:5174).
// SDK 로더는 시민 웹 lib/kakao.ts(김태형·김양우)와 같은 방식이다.
import { clampZoom, type MapEngine, type MarkerHandle } from './engine';
import type { Bbox, LatLng } from './types';

// SDK 타입은 여기서 쓰는 것만 최소한으로 선언한다
interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}
interface KakaoMap {
  getBounds(): { getSouthWest(): KakaoLatLng; getNorthEast(): KakaoLatLng };
  getLevel(): number;
  setLevel(level: number, opts?: { anchor?: KakaoLatLng }): void;
  setCenter(latlng: KakaoLatLng): void;
  getProjection(): { containerPointFromCoords(latlng: KakaoLatLng): { x: number; y: number } };
  addControl(control: unknown, position: unknown): void;
  relayout(): void;
}
interface KakaoOverlay {
  setMap(map: KakaoMap | null): void;
}
interface KakaoSdk {
  maps: {
    load(cb: () => void): void;
    LatLng: new (lat: number, lng: number) => KakaoLatLng;
    Map: new (el: HTMLElement, opts: { center: KakaoLatLng; level: number }) => KakaoMap;
    CustomOverlay: new (opts: {
      position: KakaoLatLng;
      content: HTMLElement;
      xAnchor?: number;
      yAnchor?: number;
      zIndex?: number;
      clickable?: boolean;
    }) => KakaoOverlay;
    ZoomControl: new () => unknown;
    ControlPosition: { RIGHT: unknown };
    event: {
      addListener(target: unknown, type: string, handler: () => void): void;
      removeListener(target: unknown, type: string, handler: () => void): void;
    };
  };
}

// 카카오 level(1 = 가장 확대)과 공용 줌(클수록 확대)의 관계. engine.ts 참고
const KAKAO_LEVEL_OFFSET = 20;
const MIN_LEVEL = 1;
const MAX_LEVEL = 14;

let loading: Promise<KakaoSdk> | null = null;

function loadKakao(appKey: string): Promise<KakaoSdk> {
  const w = window as unknown as { kakao?: KakaoSdk };
  if (w.kakao?.maps?.Map) return Promise.resolve(w.kakao);
  if (loading) return loading;
  loading = new Promise<KakaoSdk>((resolve, reject) => {
    const script = document.createElement('script');
    // autoload=false: 스크립트가 붙은 뒤 kakao.maps.load로 직접 초기화한다
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.async = true;
    script.onload = () => {
      const sdk = w.kakao;
      if (!sdk) return reject(new Error('카카오맵 SDK를 불러오지 못했습니다.'));
      sdk.maps.load(() => resolve(sdk));
    };
    script.onerror = () => reject(new Error('카카오맵 SDK를 불러오지 못했습니다. 키와 등록 도메인을 확인하세요.'));
    document.head.appendChild(script);
  });
  // 실패하면 다음 시도에서 다시 불러올 수 있게 비운다
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export async function createKakaoEngine(el: HTMLElement, appKey: string, center: LatLng, zoom: number): Promise<MapEngine> {
  const sdk = await loadKakao(appKey);
  const { maps } = sdk;
  const toLatLng = (p: LatLng) => new maps.LatLng(p.lat, p.lng);
  const toLevel = (z: number) => Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, KAKAO_LEVEL_OFFSET - z));

  const map = new maps.Map(el, { center: toLatLng(center), level: toLevel(clampZoom(zoom)) });
  map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT);

  // 지도 틀 크기가 바뀌면(창 크기·화면 회전) 카카오맵이 일부만 그려지므로 다시 그리게 한다
  const resizeObserver = new ResizeObserver(() => map.relayout());
  resizeObserver.observe(el);

  const idleHandlers: (() => void)[] = [];

  return {
    kind: 'kakao',
    getBounds(): Bbox {
      const b = map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      return [sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()];
    },
    getZoom: () => KAKAO_LEVEL_OFFSET - map.getLevel(),
    toPixel(p) {
      const pt = map.getProjection().containerPointFromCoords(toLatLng(p));
      return { x: pt.x, y: pt.y };
    },
    setCenter: (p) => map.setCenter(toLatLng(p)),
    zoomInAt(p, by) {
      map.setCenter(toLatLng(p));
      map.setLevel(Math.max(MIN_LEVEL, map.getLevel() - by), { anchor: toLatLng(p) });
    },
    addMarker(p, content, zIndex): MarkerHandle {
      // clickable: 마커를 누를 때 지도 끌기·클릭이 같이 일어나지 않게 한다
      const overlay = new maps.CustomOverlay({ position: toLatLng(p), content, xAnchor: 0.5, yAnchor: 0.5, zIndex, clickable: true });
      overlay.setMap(map);
      return { remove: () => overlay.setMap(null) };
    },
    onIdle(cb) {
      idleHandlers.push(cb);
      maps.event.addListener(map, 'idle', cb);
    },
    destroy() {
      resizeObserver.disconnect();
      for (const cb of idleHandlers) maps.event.removeListener(map, 'idle', cb);
      el.innerHTML = '';
    },
  };
}
