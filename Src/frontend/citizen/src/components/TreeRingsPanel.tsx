import { useEffect, useState } from 'react'
import TreeRingChart from './TreeRingChart'
import { api, ApiError, type StoryEntry, type TreeRings } from '../lib/api'
import { todayKey } from '../lib/date'
import { sampleRings } from '../lib/rings'

const YEARS_SHOWN = 2 // 올해와 지난해 두 겹을 보여 준다

// 나무 상세의 나이테 탭 (#44). 나이테 API(#12)로 올해·지난해를 받아 그린다.
// API가 아직 없으면(404) 그 나무의 실제 공개 이야기에 예시 값을 합쳐 그리고 "예시"라고 표시한다.
export default function TreeRingsPanel({ treeId, stories }: { treeId: number; stories: StoryEntry[] }) {
  const today = todayKey()
  const year = Number(today.slice(0, 4))
  const [rings, setRings] = useState<TreeRings[] | null>(null)
  const [sample, setSample] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const years = Array.from({ length: YEARS_SHOWN }, (_, i) => year - (YEARS_SHOWN - 1) + i) // 오래된 해부터
    Promise.all(years.map((y) => api.rings(treeId, y)))
      .then((list) => {
        if (alive) setRings(list)
      })
      .catch((e) => {
        if (!alive) return
        if (e instanceof ApiError && e.status === 404) {
          setRings(years.map((y) => sampleRings(treeId, y, stories, today)))
          setSample(true)
        } else setError(e instanceof ApiError ? e.message : '나이테를 불러오지 못했어요.')
      })
    return () => {
      alive = false
    }
  }, [treeId, year, stories, today])

  if (error) return <p className="tc-field__error">{error}</p>
  if (!rings) return <p className="body tree-muted">나이테를 그리는 중이에요.</p>
  return <TreeRingChart rings={rings} today={today} sample={sample} />
}
