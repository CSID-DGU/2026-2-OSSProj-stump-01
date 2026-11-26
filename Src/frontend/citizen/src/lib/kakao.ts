// 카카오맵 JS SDK 로더. 스크립트를 한 번만 넣고, 준비되면 window.kakao 를 돌려준다.
// 키는 Src/.env 의 VITE_KAKAO_MAP_KEY. JavaScript 키는 등록한 도메인에서만 동작하는 공개용 키다.

export const KAKAO_MAP_KEY: string | undefined = import.meta.env.VITE_KAKAO_MAP_KEY || undefined;

// SDK 타입은 최소한만 선언한다 (우리가 쓰는 것만)
export interface KakaoLatLng { getLat(): number; getLng(): number }
export interface KakaoBounds { getSouthWest(): KakaoLatLng; getNorthEast(): KakaoLatLng }
export interface KakaoMap {
  getBounds(): KakaoBounds;
  setCenter(latlng: KakaoLatLng): void;
  getLevel(): number;
  addControl(control: unknown, position: unknown): void;
  relayout(): void;
}
export interface KakaoOverlay {
  setMap(map: KakaoMap | null): void;
}
// 미터 단위 원 (확대하면 같이 커진다). 내 위치 오차 반경을 그린다.
export interface KakaoCircleOptions {
  center: KakaoLatLng;
  radius: number; // m
  strokeWeight?: number;
  strokeColor?: string;
  strokeOpacity?: number;
  fillColor?: string;
  fillOpacity?: number;
  zIndex?: number;
}
export interface KakaoSdk {
  maps: {
    load(cb: () => void): void;
    LatLng: new (lat: number, lng: number) => KakaoLatLng;
    Map: new (el: HTMLElement, opts: { center: KakaoLatLng; level: number }) => KakaoMap;
    // 화면 픽셀 크기가 고정된 HTML 요소를 좌표에 붙인다. 나무 점에 쓴다.
    CustomOverlay: new (opts: { position: KakaoLatLng; content: HTMLElement; xAnchor?: number; yAnchor?: number; zIndex?: number; clickable?: boolean }) => KakaoOverlay;
    Circle: new (opts: KakaoCircleOptions) => KakaoOverlay;
    ZoomControl: new () => unknown;
    ControlPosition: { RIGHT: unknown; TOPRIGHT: unknown };
    event: {
      addListener(target: unknown, type: string, handler: (...args: unknown[]) => void): void;
      removeListener(target: unknown, type: string, handler: (...args: unknown[]) => void): void;
    };
  };
}

declare global {
  interface Window { kakao?: KakaoSdk }
}

let loading: Promise<KakaoSdk> | null = null;

export function loadKakao(appKey: string): Promise<KakaoSdk> {
  if (window.kakao?.maps?.Map) return Promise.resolve(window.kakao);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    // autoload=false: 스크립트가 붙은 뒤 kakao.maps.load 로 직접 초기화한다 (React 와 타이밍 맞추기)
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.async = true;
    script.onload = () => {
      const sdk = window.kakao;
      if (!sdk) { reject(new Error("카카오맵 SDK 를 불러오지 못했어요.")); return; }
      sdk.maps.load(() => resolve(sdk));
    };
    script.onerror = () => reject(new Error("카카오맵 SDK 를 불러오지 못했어요. 키와 등록 도메인(localhost:5173)을 확인하세요."));
    document.head.appendChild(script);
  });
  return loading;
}
