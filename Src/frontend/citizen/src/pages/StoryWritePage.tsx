import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import TopBar from '../components/TopBar'
import ChoiceGroup from '../components/ChoiceGroup'
import { api, ApiError, type TreeDetail } from '../lib/api'
import { isActiveCaregiver } from '../lib/caregiver'
import { useAuth } from '../store/authStore'
import './StoryWritePage.css'

const BODY_MAX = 1000 // 서버(citizen/stories.ts)와 같은 기준 (임시값)

type Display = 'nickname' | 'real_name'
type Visibility = 'public' | 'private'

// 공동 이야기 덧붙이기 (#82)
// 그 나무의 승인된 돌보미만 쓴다. 이름(별명/실명)과 공개 여부는 글쓴 돌보미가 고른다(CLAUDE.md 규칙).
export default function StoryWritePage() {
  const { id } = useParams()
  const treeId = Number(id)
  const navigate = useNavigate()
  const auth = useAuth()
  const nickname = auth.status === 'signed-in' ? auth.user.nickname : ''

  const [tree, setTree] = useState<TreeDetail | null>(null)
  const [allowed, setAllowed] = useState<boolean | null>(null) // null: 확인 중
  const [body, setBody] = useState('')
  const [display, setDisplay] = useState<Display[]>(['nickname'])
  const [visibility, setVisibility] = useState<Visibility[]>(['public'])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // 나무 정보와 "내가 이 나무 돌보미인지"를 함께 확인한다
  useEffect(() => {
    let alive = true
    Promise.all([api.tree(treeId), api.myApplications()])
      .then(([t, mine]) => {
        if (!alive) return
        setTree(t)
        setAllowed(isActiveCaregiver(mine.applications, treeId))
      })
      .catch(() => {
        if (alive) setAllowed(false)
      })
    return () => {
      alive = false
    }
  }, [treeId])

  const isPublic = visibility[0] === 'public'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setError('')
    setSending(true)
    try {
      await api.addStoryEntry(treeId, { body: body.trim(), authorDisplay: display[0], isPublic })
      // 공개 글은 이야기 탭에서 바로 보인다. 비공개 글은 QR 페이지에 나오지 않으므로 안내와 함께 돌아간다
      navigate(`/trees/${treeId}${isPublic ? '' : '?saved=private'}`, { replace: true })
    } catch (err) {
      setError(storyErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="app-shell tc-screen">
      <TopBar title="이야기 덧붙이기" kind="close" />
      <form className="page story-form" onSubmit={submit} noValidate>
        <div className="page-title">
          <h1 className="display">{tree ? tree.name : '나무 이야기'}</h1>
          <p className="body">여러 돌보미가 함께 쓰는 이 나무의 이야기에 한 편을 덧붙여요.</p>
        </div>

        {allowed === null && <p className="body story-muted">확인하는 중이에요.</p>}

        {allowed === false && (
          <div className="story-blocked">
            <p className="body">이 나무의 승인된 돌보미만 이야기를 덧붙일 수 있어요.</p>
            <Link className="tc-link" to="/applications">
              내 신청 현황 보기
            </Link>
          </div>
        )}

        {allowed && (
          <>
            <div className="tc-field">
              <label className="tc-field__label" htmlFor="story-body">
                이야기
              </label>
              <textarea
                id="story-body"
                className={body ? 'tc-field__input is-filled story-body' : 'tc-field__input story-body'}
                maxLength={BODY_MAX}
                placeholder="잎이 반쯤 노랗게 바뀌었다. 올해는 작년보다 열흘쯤 늦다."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <span className="tc-field__count">
                {body.length}/{BODY_MAX}
              </span>
            </div>

            <ChoiceGroup
              label="이름 표시"
              options={['nickname', 'real_name'] as Display[]}
              selected={display}
              onChange={(next) => next.length > 0 && setDisplay(next)}
              format={(d) => (d === 'nickname' ? `별명 (${nickname})` : '실명')}
            />

            <div className="tc-field">
              <ChoiceGroup
                label="공개"
                options={['public', 'private'] as Visibility[]}
                selected={visibility}
                onChange={(next) => next.length > 0 && setVisibility(next)}
                format={(v) => (v === 'public' ? '모두에게 공개' : '비공개')}
              />
              <span className="tc-field__help">
                {isPublic ? 'QR 명판을 찍은 사람도 이 글을 볼 수 있어요.' : '비공개 글은 QR 이야기 페이지에 나오지 않아요.'}
              </span>
            </div>

            {error && (
              <p className="tc-field__error" role="alert">
                {error}
              </p>
            )}

            <div className="page-bottom">
              <button className="tc-btn tc-btn--primary" type="submit" disabled={!body.trim() || sending}>
                {sending ? '올리는 중' : '이야기 올리기'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

function storyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return '이 나무의 승인된 돌보미만 이야기를 덧붙일 수 있어요.'
    if (err.status === 400 && err.message.includes('실명')) return '실명이 등록되어 있지 않아 실명으로 쓸 수 없어요. 별명으로 올려 주세요.'
    if (err.status === 400) return '글을 다시 확인해 주세요. (1000자까지)'
    if (err.status === 0) return err.message
  }
  return '이야기를 올리지 못했어요. 잠시 뒤 다시 해 주세요.'
}
