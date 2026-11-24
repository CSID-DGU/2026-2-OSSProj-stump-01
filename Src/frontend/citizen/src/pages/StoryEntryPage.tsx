import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import TopBar from '../components/TopBar'
import { api, ApiError, type StoryEntryDetail } from '../lib/api'
import { formatLongDate, toDateKey } from '../lib/date'
import './TreeDetailPage.css'

// 이야기 한 편 (#44). 나이테의 별을 누르면 온다. 로그인 없이 연다. 비공개 글은 서버가 404를 준다.
export default function StoryEntryPage() {
  const { id } = useParams()
  const entryId = Number(id)
  const [entry, setEntry] = useState<StoryEntryDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api
      .storyEntry(entryId)
      .then((e) => {
        if (alive) setEntry(e)
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof ApiError && e.status === 404 ? '이야기를 찾을 수 없어요. 글쓴이가 비공개로 바꿨거나 없어진 글이에요.' : '이야기를 불러오지 못했어요.')
      })
    return () => {
      alive = false
    }
  }, [entryId])


  return (
    <div className="page tree-detail">
      <TopBar title="나무 이야기" kind="back" />

      {error && <p className="body tree-muted">{error}</p>}
      {!entry && !error && <p className="body tree-muted">불러오는 중이에요.</p>}

      {entry && (
        <>
          <div className="page-title">
            <p className="caption tree-muted">
              {formatLongDate(toDateKey(new Date(entry.createdAt)))}, {entry.author.displayName}
            </p>
            <h1 className="display">
              {entry.tree.name}
            </h1>
          </div>
          <p className="tree-story__body">{entry.body}</p>
          {(entry.likeCount > 0 || entry.replyCount > 0) && (
            <p className="caption tree-muted">
              좋아요 {entry.likeCount} · 한 줄 응답 {entry.replyCount}
            </p>
          )}
          <div className="page-bottom">
            <Link className="tc-btn tc-btn--primary" to={`/trees/${entry.tree.id}`}>
              이 나무의 이야기 모두 보기
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
