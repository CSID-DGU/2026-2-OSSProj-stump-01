// 활동 기록 현장 확인(#13)을 화면에서 미리 판정한다. 화면과 분리된 순수 함수다.
// 최종 판정은 저장할 때 서버(Src/backend/citizen/records.ts)가 한다. 아래 두 값은 서버와 같아야 한다(구청 확인 전 임시값, #59).
import { distanceMeters } from './geo'

export const LOCATION_CHECK_DISTANCE_M = 30 // 내 위치가 나무에서 이 안이면 현장으로 본다
export const MAX_LOCATION_ACCURACY_M = 30 // 위치 오차 반경이 이보다 크면 위치를 믿지 않는다

type LatLng = { lat: number; lng: number }

// near: 현장 확인됨(사진 선택) / far: 나무에서 멀다 / blurry: 위치 오차가 커서 믿을 수 없다 (far·blurry는 사진 필요)
export type SiteVerdict = 'near' | 'far' | 'blurry'

export type SiteCheck = { distance: number; verdict: SiteVerdict }

/** 내 위치(오차 포함)와 나무 위치로 현장 확인 결과를 낸다. 서버와 같은 순서: 오차가 크면 거리와 상관없이 blurry */
export function checkSite(me: LatLng & { accuracy: number }, tree: LatLng): SiteCheck {
  const distance = distanceMeters(me, tree)
  if (me.accuracy > MAX_LOCATION_ACCURACY_M) return { distance, verdict: 'blurry' }
  return { distance, verdict: distance <= LOCATION_CHECK_DISTANCE_M ? 'near' : 'far' }
}
