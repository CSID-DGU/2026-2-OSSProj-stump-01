// 공용 지도(#27)가 쓰는 자료형. 나무 모양은 GET /trees 응답(openapi.yaml Tree)에서 지도에 필요한 것만 뽑았다.

export type LatLng = { lat: number; lng: number };

/** 지도 범위 [서남쪽 경도, 위도, 동북쪽 경도, 위도]. GET /trees?bbox= 와 같은 순서 */
export type Bbox = [number, number, number, number];

export type CareGap = 'no_caregiver' | 'inactive';

/** 지도에 찍을 나무. 시민 웹·구청 웹의 Tree 형이 이 칸들을 가지고 있으면 그대로 넘길 수 있다 */
export type MapTree = {
  id: number;
  name: string; // "은행나무, 소월로 1번"
  location: LatLng;
  caregiverCount: number; // 승인된 돌보미 수
  hasOpenReport: boolean; // 조치 완료 전인 이상 신고가 있는지
  careGap: CareGap | null; // 관리 사각지대(#22). null = 돌보미가 이번 달 활동함
};

/** 지도를 그리는 바탕. 카카오맵이나 OSM 임시 지도 */
export type MapEngineKind = 'kakao' | 'osm';
