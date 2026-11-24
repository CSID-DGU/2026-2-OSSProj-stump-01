// #37 나무 지도. 지도 범위의 가로수를 백엔드(GET /trees)에서 받아 점으로 찍고, 누르면 나무 상세로 간다.
// Src/.env 에 VITE_KAKAO_MAP_KEY 가 있으면 카카오맵, 없으면 OSM 임시 지도(TreeMap)로 뜬다.
// 공용 지도 컴포넌트(frontend/shared, #27)가 나오면 지도 부분을 그것으로 바꾼다.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import PageTitle from '../components/PageTitle'
import KakaoTreeMap from '../components/KakaoTreeMap'
import TreeMap from '../components/TreeMap'
import { api, ApiError, type Bbox, type Tree } from '../lib/api'
import { KAKAO_MAP_KEY } from '../lib/kakao'
import { todayKey } from '../lib/date'
import { TREE_KIND_LABEL, countKinds, treeKind, type TreeKind } from '../lib/treeKind'
import { MAX_TREES } from '../content/applicationForm'
import { addToCart, removeFromCart, useApplyCart } from '../store/applyCart'
import { useAuth } from '../store/authStore'
import './MapPage.css'

const NO_TREES: ReadonlySet<number> = new Set()


// 처음 보여 주는 범위: 중구 명동 일대 (가로·세로 약 700m). 이 크기면 나무가 2000그루를 넘지 않는다.
const DEFAULT_BBOX: Bbox = [126.98, 37.56, 126.988, 37.567]
const DEFAULT_CENTER = { lng: (DEFAULT_BBOX[0] + DEFAULT_BBOX[2]) / 2, lat: (DEFAULT_BBOX[1] + DEFAULT_BBOX[3]) / 2 }
const KAKAO_LEVEL = 4 // 카카오맵 확대 단계. 작을수록 확대. 4 ≈ 가로 700m
const TREE_LIMIT = 2000 // 한 번에 받는 나무 수. 백엔드 상한과 같다
const ZOOM_STEP = 1.6 // 임시 지도에서 확대·축소 한 단계의 배율
const DISTRICT: string | undefined = '중구' // 시연 범위. 서울 전체로 넓히려면 undefined

export default function MapPage() {
  const [bbox, setBbox] = useState<Bbox>(DEFAULT_BBOX)
  const [trees, setTrees] = useState<Tree[]>([])
  const [truncated, setTruncated] = useState(false)
  const [selected, setSelected] = useState<Tree | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedBbox, setLoadedBbox] = useState<Bbox | null>(null) // 마지막으로 응답을 받은 범위
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number } | null>(null)
  const cart = useApplyCart() // 돌보미 신청할 나무 (#40)
  const useKakao = Boolean(KAKAO_MAP_KEY)
  const loading = loadedBbox !== bbox // 지금 범위의 응답을 아직 못 받았으면 불러오는 중

  // 내가 돌보는 나무 (#37 "돌보미 나무·내 나무 구분"). 로그인했을 때만 내 신청 현황으로 정한다
  const signedIn = useAuth().status === 'signed-in'
  const [myTreeIds, setMyTreeIds] = useState<ReadonlySet<number>>(NO_TREES)
  useEffect(() => {
    if (!signedIn) return
    let alive = true
    const today = todayKey()
    api
      .myApplications()
      .then((r) => {
        if (!alive) return
        const ids = r.applications.filter((a) => a.status === 'approved' && a.periodStart <= today && today <= a.periodEnd).map((a) => a.tree.id)
        setMyTreeIds(new Set(ids))
      })
      .catch(() => {}) // 못 받아도 지도는 그대로 보여 준다 (내 나무 구분만 빠짐)
    return () => {
      alive = false
    }
  }, [signedIn])
  const mine = signedIn ? myTreeIds : NO_TREES
  const kindOf = useCallback((t: Tree): TreeKind => treeKind(t, mine), [mine])
  const kinds = countKinds(trees, mine)

  useEffect(() => {
    let alive = true
    api
      .trees(bbox, TREE_LIMIT, DISTRICT)
      .then((r) => {
        if (!alive) return
        setTrees(r.trees)
        setTruncated(r.truncated)
        setError(null)
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiError ? e.message : '나무를 불러오지 못했어요.')
      })
      .finally(() => {
        if (alive) setLoadedBbox(bbox)
      })
    return () => {
      alive = false
    }
  }, [bbox])

  function pan(dLng: number, dLat: number) {
    setSelected(null)
    setBbox(([a, b, c, d]) => [a + dLng, b + dLat, c + dLng, d + dLat])
  }

  // 가운데를 고정한 채 범위를 factor 배로 키우거나(축소) 줄인다(확대)
  function zoom(factor: number) {
    setSelected(null)
    setBbox(([a, b, c, d]) => {
      const cx = (a + c) / 2
      const cy = (b + d) / 2
      const w = ((c - a) / 2) * factor
      const h = ((d - b) / 2) * factor
      return [cx - w, cy - h, cx + w, cy + h]
    })
  }

  function moveToMyLocation() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setFlyTo({ lat: coords.latitude, lng: coords.longitude }) // 지도 이동 + 내 위치 점
        if (useKakao) return // 카카오맵은 이동이 끝나면(idle) 새 범위를 알려 준다
        const w = (bbox[2] - bbox[0]) / 2
        const h = (bbox[3] - bbox[1]) / 2
        setBbox([coords.longitude - w, coords.latitude - h, coords.longitude + w, coords.latitude + h])
      },
      () => setError('위치를 가져오지 못했어요. 브라우저의 위치 권한을 확인하세요.'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  // 이 범위의 수종별 그루 수 (많은 순 3개)
  const bySpecies = trees.reduce<Record<string, number>>((acc, t) => {
    acc[t.species] = (acc[t.species] ?? 0) + 1
    return acc
  }, {})
  const top = Object.entries(bySpecies)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  return (
    <div className="page map-page">
      <div className="map-page__head">
        <PageTitle title="나무 지도" description={DISTRICT ? `${DISTRICT} 가로수` : '서울 가로수'} />
        <button type="button" className="tc-link map-page__locate" onClick={moveToMyLocation}>
          현재 위치로
        </button>
      </div>

      {useKakao ? (
        <KakaoTreeMap
          appKey={KAKAO_MAP_KEY!}
          center={DEFAULT_CENTER}
          level={KAKAO_LEVEL}
          trees={trees}
          selectedId={selected?.id}
          onSelect={setSelected}
          onBoundsChange={(b) => {
            setSelected(null)
            setBbox(b)
          }}
          flyTo={flyTo}
          kindOf={kindOf}
        />
      ) : (
        <TreeMap
          bbox={bbox}
          trees={trees}
          selectedId={selected?.id}
          onSelect={setSelected}
          onPan={pan}
          onZoom={(dir) => zoom(dir === 'in' ? 1 / ZOOM_STEP : ZOOM_STEP)}
          me={flyTo}
          kindOf={kindOf}
        />
      )}

      {/* #37 나무 구분 범례: 이 범위의 그루 수와 함께 */}
      <ul className="map-legend caption" aria-label="지도의 나무 표시">
        {(signedIn ? (['mine', 'cared', 'waiting'] as TreeKind[]) : (['cared', 'waiting'] as TreeKind[])).map((k) => (
          <li key={k} className="map-legend__item">
            <span className={`map-legend__dot map-legend__dot--${k}`} aria-hidden="true" />
            {TREE_KIND_LABEL[k]} {loading ? '' : kinds[k]}
          </li>
        ))}
      </ul>

      {error && (
        <p className="map-page__notice map-page__notice--error">
          {error} 백엔드가 켜져 있고 가로수 데이터가 적재돼 있어야 해요.
        </p>
      )}
      {!error && !loading && trees.length === 0 && (
        <p className="map-page__notice">이 범위에는 가로수가 없어요. 지도를 옮기거나 넓혀 보세요.</p>
      )}
      {truncated && <p className="map-page__notice">나무가 많아 {TREE_LIMIT}그루만 표시했어요. 지도를 확대해 보세요.</p>}

      {selected ? (
        <div className="tc-rows">
          <Link className="tc-tree tc-row" to={`/trees/${selected.id}`}>
            <span className="tc-tree__name">
              {selected.name}
            </span>
            <span className="tc-tree__meta">{selected.code ?? `${selected.district} ${selected.dong ?? ''}`} · 자세히</span>
          </Link>
          <div className="tc-row">
            <span className="caption map-page__kind">{TREE_KIND_LABEL[kindOf(selected)]}</span>
            <span className="caption map-page__kind">{selected.caregiverCount > 0 ? `돌보미 ${selected.caregiverCount}명` : '돌보미 없음'}</span>
          </div>
          {/* #40 돌보미 신청: 이 나무를 신청 목록에 담거나 뺀다 (이미 내 나무면 그리지 않는다) */}
          {kindOf(selected) !== 'mine' && (
          <div className="tc-choices__list map-page__apply">
            {cart.some((t) => t.id === selected.id) ? (
              <button type="button" className="tc-choice" aria-pressed="true" onClick={() => removeFromCart(selected.id)}>
                신청 목록에 담음 · 빼기
              </button>
            ) : (
              <button
                type="button"
                className="tc-choice"
                disabled={cart.length >= MAX_TREES}
                onClick={() =>
                  addToCart({ id: selected.id, species: selected.species, name: selected.name, district: selected.district, code: selected.code })
                }
              >
                {cart.length >= MAX_TREES ? `한 번에 ${MAX_TREES}그루까지 신청할 수 있어요` : '돌보미 신청할 나무로 담기'}
              </button>
            )}
          </div>
          )}
        </div>
      ) : (
        <div className="map-page__stats">
          <div>
            <div className="map-page__n">{loading ? '…' : trees.length}</div>
            <div className="map-page__l">이 범위의 나무</div>
          </div>
          {top.map(([species, n]) => (
            <div key={species}>
              <div className="map-page__n map-page__n--small">{n}</div>
              <div className="map-page__l">{species}</div>
            </div>
          ))}
        </div>
      )}

      {/* #40 담은 나무가 있으면 신청서로 가는 줄 */}
      {cart.length > 0 && (
        <div className="tc-rows">
          <Link className="tc-row map-page__cart" to="/apply">
            <span className="label-lg">돌보미 신청서 쓰기</span>
            <span className="tc-row__value">{cart.length}그루 담음</span>
          </Link>
        </div>
      )}
    </div>
  )
}
