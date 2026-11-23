import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import TopBar from '../components/TopBar'
import TreeRingsPanel from '../components/TreeRingsPanel'
import { api, ApiError, type SpeciesCard, type StoryEntry, type TreeDetail } from '../lib/api'
import { isActiveCaregiver } from '../lib/caregiver'
import { formatShortDate, toDateKey } from '../lib/date'
import { addToCart } from '../store/applyCart'
import { useAuth } from '../store/authStore'
import './TreeDetailPage.css'

// 나무 상세·QR 이야기 페이지 (#38). 로그인 없이 연다.
// 명판 QR은 /trees/{id}?from=qr 로 연결한다 (QR 명판 시안 #35). QR로 들어오면 인사 문구를 보여 준다.
export default function TreeDetailPage() {
  const { id } = useParams()
  const treeId = Number(id)
  if (!Number.isInteger(treeId) || treeId <= 0) return <NotFound />
  // 나무가 바뀌면 화면 상태를 처음부터 다시 시작한다 (key)
  return <TreeDetailView key={treeId} treeId={treeId} />
}

type Tab = 'story' | 'rings' | 'species'

// 이야기를 아직 못 받았을 때 나이테에 넘기는 빈 목록 (매번 새 배열을 만들면 나이테가 다시 불러온다)
const EMPTY_STORIES: StoryEntry[] = []

function TreeDetailView({ treeId }: { treeId: number }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const fromQr = params.get('from') === 'qr'
  const savedPrivate = params.get('saved') === 'private' // 비공개 이야기를 막 올리고 돌아왔을 때 (#82)
  const auth = useAuth()
  const signedIn = auth.status === 'signed-in'
  const [caregiver, setCaregiver] = useState(false) // 내가 이 나무의 돌보미인지 (로그인했을 때만 확인)

  const [tree, setTree] = useState<TreeDetail | null>(null)
  const [entries, setEntries] = useState<StoryEntry[] | null>(null)
  const [error, setError] = useState<'notfound' | string | null>(null)
  // ?tab=species, ?tab=rings 로 열면 그 탭부터 보여 준다
  const tabParam = params.get('tab')
  const [tab, setTab] = useState<Tab>(tabParam === 'species' || tabParam === 'rings' ? tabParam : 'story')

  useEffect(() => {
    let alive = true
    Promise.all([api.tree(treeId), api.story(treeId)])
      .then(([t, s]) => {
        if (!alive) return
        setTree(t)
        setEntries(s.entries)
      })
      .catch((e) => {
        if (!alive) return
        if (e instanceof ApiError && e.status === 404) setError('notfound')
        else setError(e instanceof ApiError ? e.message : '나무 정보를 불러오지 못했어요.')
      })
    return () => {
      alive = false
    }
  }, [treeId])

  // 로그인했으면 내 신청 현황으로 "이 나무 돌보미인지" 확인한다. 돌보미면 이야기를 덧붙일 수 있다 (#82)
  useEffect(() => {
    if (!signedIn) return
    let alive = true
    api
      .myApplications()
      .then((r) => {
        if (alive) setCaregiver(isActiveCaregiver(r.applications, treeId))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [signedIn, treeId])

  if (error === 'notfound') return <NotFound />

  const place = tree ? tree.roadName ?? tree.dong ?? tree.district : ''

  function becomeCaregiver() {
    if (!tree) return
    addToCart({ id: tree.id, species: tree.species, place, district: tree.district, code: tree.code })
    navigate('/apply')
  }

  return (
    <div className="page tree-detail">
      <TopBar title="나무 이야기" kind="back" />

      {error && (
        <p className="tc-field__error" role="alert">
          {error}
        </p>
      )}

      {!tree && !error && <p className="body tree-muted">나무 정보를 불러오는 중이에요.</p>}

      {tree && (
        <>
          {fromQr && <p className="body tree-qr field-only">명판을 찍으셨군요. 로그인 없이 이 나무의 이야기를 볼 수 있어요.</p>}
          {savedPrivate && (
            <p className="body tree-qr" role="status">
              비공개로 이야기를 올렸어요. 비공개 글은 이 페이지에 나오지 않아요.
            </p>
          )}

          <div className="page-title">
            <h1 className="display">
              {tree.species}, {place}
            </h1>
            <p className="body">
              {tree.address ?? `${tree.district} ${tree.dong ?? ''}`}
              {tree.code && ` · 관리번호 ${tree.code}`}
            </p>
          </div>

          <div className="tc-rows">
            <div className="tc-row">
              <span>돌보는 사람</span>
              <span className={tree.caregiverCount > 0 ? 'tc-row__value' : 'tc-row__value tc-row__value--earth'}>
                {tree.caregiverCount > 0 ? `${tree.caregiverCount}명` : '아직 없어요'}
              </span>
            </div>
            {tree.roadName && (
              <div className="tc-row">
                <span>{tree.roadName}의 가로수</span>
                <span className="tc-row__value">{tree.sameRoadCount.toLocaleString()}그루</span>
              </div>
            )}
            {tree.dong && (
              <div className="tc-row">
                <span>{tree.dong}의 가로수</span>
                <span className="tc-row__value">{tree.sameDongCount.toLocaleString()}그루</span>
              </div>
            )}
            <div className="tc-row">
              <span>관리청</span>
              <span className="tc-row__value">{tree.agency}</span>
            </div>
            {tree.hasOpenReport && (
              <div className="tc-row">
                <span>신고</span>
                <span className="tc-row__value tc-row__value--earth">구청이 확인하고 있어요</span>
              </div>
            )}
          </div>

          <div className="tc-tabs tree-tabs" role="tablist" aria-label="나무 정보">
            <button className="tc-tab" role="tab" type="button" aria-selected={tab === 'story'} onClick={() => setTab('story')}>
              이야기 {entries && entries.length > 0 ? entries.length : ''}
            </button>
            <button className="tc-tab" role="tab" type="button" aria-selected={tab === 'rings'} onClick={() => setTab('rings')}>
              나이테
            </button>
            <button className="tc-tab" role="tab" type="button" aria-selected={tab === 'species'} onClick={() => setTab('species')}>
              {tree.species}
            </button>
          </div>

          {tab === 'story' && <StoryList entries={entries ?? []} />}
          {tab === 'rings' && <TreeRingsPanel treeId={tree.id} stories={entries ?? EMPTY_STORIES} />}
          {tab === 'species' && <SpeciesCardView card={tree.speciesCard} species={tree.species} />}

          <div className="page-bottom">
            {caregiver ? (
              <Link className="tc-btn tc-btn--primary" to={`/trees/${tree.id}/story/new`}>
                이야기 덧붙이기
              </Link>
            ) : (
              <button className="tc-btn tc-btn--primary" type="button" onClick={becomeCaregiver}>
                나도 이 나무 돌보미 하기
              </button>
            )}
            <p className="micro tree-muted tree-source">가로수 정보: 서울 열린데이터광장 「서울시 가로수 위치 정보」</p>
          </div>
        </>
      )}
    </div>
  )
}

// 공동 이야기 목록 (공개 글, 오래된 순)
function StoryList({ entries }: { entries: StoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="body tree-muted">아직 이 나무의 이야기가 없어요. 돌보미가 되면 첫 이야기를 남길 수 있어요.</p>
  }
  return (
    <ol className="tree-stories">
      {entries.map((e) => (
        <li key={e.id} className="tree-story">
          <span className="caption tree-muted">
            {formatShortDate(toDateKey(new Date(e.createdAt)))}, {e.author.displayName}
          </span>
          <p className="tree-story__body">{e.body}</p>
          {(e.likeCount > 0 || e.replyCount > 0) && (
            <span className="caption tree-muted">
              좋아요 {e.likeCount} · 한 줄 응답 {e.replyCount}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

const SEASON_LABEL = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' } as const
type Season = keyof typeof SEASON_LABEL

// 지금 계절 (3~5월 봄, 6~8월 여름, 9~11월 가을, 12~2월 겨울)
function currentSeason(): Season {
  const m = Number(toDateKey(new Date()).slice(5, 7))
  if (m >= 3 && m <= 5) return 'spring'
  if (m >= 6 && m <= 8) return 'summer'
  if (m >= 9 && m <= 11) return 'autumn'
  return 'winter'
}

// 수종별 기본 콘텐츠 카드 (Src/content/species-cards.json, 서버가 함께 준다)
function SpeciesCardView({ card, species }: { card: SpeciesCard | null; species: string }) {
  if (!card) {
    return <p className="body tree-muted">{species} 소개 카드는 아직 준비 중이에요. 서울 가로수 상위 10종부터 만들고 있어요.</p>
  }
  const now = currentSeason()
  const order: Season[] = [now, ...(['spring', 'summer', 'autumn', 'winter'] as Season[]).filter((s) => s !== now)]
  return (
    <div className="species">
      <p className="caption tree-muted">
        {card.scientificName} · {card.family} · {card.leafType}
      </p>
      <p className="body">{card.summary}</p>
      <p className="caption tree-muted">
        서울 가로수 {card.rank}위 · {card.seoulCount.toLocaleString()}그루
      </p>
      <ul className="species__features body">
        {card.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <div className="tc-rows">
        {order.map((s) => (
          <div key={s} className={s === now ? 'species__season is-now' : 'species__season'}>
            <span className="species__season-name">{s === now ? `지금, ${SEASON_LABEL[s]}` : SEASON_LABEL[s]}</span>
            <span className="body">{card.seasons[s]}</span>
          </div>
        ))}
      </div>
      <p className="micro tree-muted">{card.source}</p>
    </div>
  )
}

function NotFound() {
  return (
    <div className="page tree-detail">
      <TopBar title="나무 이야기" kind="back" />
      <div className="page-title">
        <h1 className="display">나무를 찾을 수 없어요</h1>
        <p className="body">주소가 바뀌었거나 없어진 나무예요. 지도에서 다시 찾아 주세요.</p>
      </div>
    </div>
  )
}
