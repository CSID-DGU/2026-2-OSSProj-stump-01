// 내 나무 찾아가기: 신청한 나무 앞에 거리에서 정확히 서도록 돕는다.
// 같은 길에 같은 수종이 수십 그루 줄지어 있고 휴대폰 GPS 는 5~10m 틀리므로,
// ① 지도로 근처까지 가고(내 위치·남은 거리, 카카오맵 길찾기) ② 마지막 몇 m 는 양옆 나무(서버가 준 neighbors)로 확인한다.
import { useCallback, useEffect, useRef, useState } from 'react'
import KakaoTreeMap from './KakaoTreeMap'
import { api, type Bbox, type Tree, type TreeDetail } from '../lib/api'
import { distanceMeters, formatDistance, kakaoDirectionsUrl } from '../lib/geo'
import { KAKAO_MAP_KEY } from '../lib/kakao'
import '../pages/MapPage.css' // 지도 틀·나무 점·내 위치 점 스타일을 지도 화면과 같이 쓴다
import './FindMyTree.css'

// ── 기준값 ──
const MAP_LEVEL = 2 // 카카오맵 확대 단계. 2 ≈ 가로 170m (양옆 나무가 점으로 구분되는 정도)
const NEARBY_LIMIT = 500 // 작은 지도에 함께 찍는 주변 나무 수
const NEAR_M = 15 // 남은 거리가 이 안(또는 위치 오차 안)이면 "거의 다 왔다"고 알려 준다

type Me = { lat: number; lng: number; accuracy: number }

export default function FindMyTree({ tree }: { tree: TreeDetail }) {
  const [bbox, setBbox] = useState<Bbox | null>(null)
  const [nearby, setNearby] = useState<Tree[]>([])
  const [me, setMe] = useState<Me | null>(null)
  const [locError, setLocError] = useState<string | null>(null)
  const watchId = useRef<number | null>(null)

  // 작은 지도 범위의 주변 나무 (못 받아도 내 나무 점·양옆 나무 안내는 그대로)
  useEffect(() => {
    if (!bbox) return
    let alive = true
    api
      .trees(bbox, NEARBY_LIMIT)
      .then((r) => {
        if (alive) setNearby(r.trees)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [bbox])

  // 화면을 떠나면 위치 추적을 멈춘다
  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    },
    [],
  )

  function startLocating() {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setLocError('이 브라우저에서는 위치를 쓸 수 없어요. https 주소로 열었는지 확인해 주세요.')
      return
    }
    if (watchId.current !== null) return
    setLocError(null)
    watchId.current = navigator.geolocation.watchPosition(
      (p) => setMe({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => {
        setLocError(e.code === e.PERMISSION_DENIED ? '위치 권한을 허용해야 남은 거리를 알려 드릴 수 있어요.' : '지금 위치를 찾지 못했어요. 잠시 뒤 다시 눌러 주세요.')
        if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
        watchId.current = null
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    )
  }

  // 지도에 찍는 나무: 주변 나무 + 내 나무 (주변 목록이 아직 없어도 내 나무는 보인다)
  const trees = nearby.some((t) => t.id === tree.id) ? nearby : [...nearby, tree]
  const kindOf = useCallback((t: Tree) => (t.id === tree.id ? 'mine' : 'other'), [tree.id])
  const noop = useCallback(() => {}, [])

  const left = me ? distanceMeters(me, tree.location) : null
  const near = left !== null && me !== null && left <= Math.max(NEAR_M, me.accuracy)
  const landmark = tree.neighbors.find((n) => n.species !== tree.species) // 수종이 다른 옆 나무는 좋은 표시가 된다

  return (
    <section className="find-tree" aria-labelledby="find-tree-title">
      <h2 id="find-tree-title" className="tc-section-title">
        내 나무 찾아가기
      </h2>

      {KAKAO_MAP_KEY ? (
        <KakaoTreeMap
          appKey={KAKAO_MAP_KEY}
          center={tree.location}
          level={MAP_LEVEL}
          trees={trees}
          selectedId={tree.id}
          onSelect={noop}
          onBoundsChange={setBbox}
          kindOf={kindOf}
          me={me}
        />
      ) : (
        <p className="body tree-muted">지도 키(VITE_KAKAO_MAP_KEY)가 없어 작은 지도를 띄우지 못했어요. 아래 길찾기와 양옆 나무로 찾아 주세요.</p>
      )}

      <div className="find-tree__status">
        {me && left !== null ? (
          <p className="body" role="status">
            {near ? (
              <b>거의 다 왔어요. 아래 양옆 나무로 내 나무를 확인해 주세요.</b>
            ) : (
              <>
                내 나무까지 <b>{formatDistance(left)}</b>
              </>
            )}{' '}
            <span className="caption tree-muted">(위치 오차 ±{Math.round(me.accuracy)}m)</span>
          </p>
        ) : (
          <button className="tc-link" type="button" onClick={startLocating}>
            내 위치 보기 · 남은 거리 알려 주기
          </button>
        )}
        {locError && (
          <p className="caption find-tree__error" role="alert">
            {locError}
          </p>
        )}
      </div>

      <h3 className="caption tree-muted find-tree__label">도착하면 양옆 나무로 확인해요</h3>
      {tree.neighbors.length === 0 ? (
        <p className="body">50m 안에 같은 길의 다른 나무가 없어요. 이 근처의 {tree.species}는 이 나무 하나예요.</p>
      ) : (
        <>
          <ul className="find-tree__neighbors">
            {tree.neighbors.map((n) => (
              <li key={n.id} className="find-tree__neighbor">
                <span className="caption tree-muted">
                  {n.direction}쪽 {n.distanceM}m
                </span>
                <span className="body">{n.species}</span>
              </li>
            ))}
          </ul>
          <p className="caption tree-muted">
            {landmark
              ? `바로 ${landmark.direction}쪽 나무가 ${landmark.species}예요. 수종이 다른 나무를 표시로 삼으면 찾기 쉬워요.`
              : `양옆도 모두 ${tree.species}예요. 옆 나무까지의 거리로 구분해 주세요.`}
          </p>
        </>
      )}

      <a className="tc-btn tc-btn--ink find-tree__directions" href={kakaoDirectionsUrl(tree.name, tree.location)} target="_blank" rel="noreferrer">
        카카오맵으로 길찾기
      </a>
    </section>
  )
}
