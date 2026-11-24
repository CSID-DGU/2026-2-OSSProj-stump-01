// 위치 계산 (내 나무 찾아가기)

type LatLng = { lat: number; lng: number }

const EARTH_RADIUS_M = 6_371_000

/** 두 지점 사이 거리(m). 걸어서 찾아가는 수백 m 거리에서는 구면 거리(하버사인)로 충분하다 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** 42m, 1.3km 처럼 보여 준다 */
export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`
}

/** 카카오맵 길찾기 링크 (/link/to/이름,위도,경도). PC·모바일 웹·앱에 맞춰 카카오맵이 열린다. 이름의 쉼표는 구분자라 뺀다 */
export function kakaoDirectionsUrl(name: string, at: LatLng): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(name.replaceAll(',', ' '))},${at.lat},${at.lng}`
}
