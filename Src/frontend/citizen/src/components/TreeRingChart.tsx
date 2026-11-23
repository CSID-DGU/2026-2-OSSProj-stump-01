import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { arc, symbol, symbolCircle, symbolDiamond, symbolStar, symbolTriangle } from 'd3'
import type { RingMonth, TreeRings } from '../lib/api'
import { HEAT_LABEL, THICKNESS_MAX, heatLevel, isFuture, monthSummary, ringThickness } from '../lib/rings'
import './TreeRingChart.css'

type TreeRingChartProps = {
  rings: TreeRings[] // 오래된 해부터. 안쪽 겹이 오래된 해다
  today: string // "2026-11-23"
  sample?: boolean // 예시 데이터면 화면에 표시한다
}

// ---- 그림 크기 ----
const SIZE = 340
const C = SIZE / 2 // 가운데
const CORE = 54 // 가운데 비워 두는 반지름 (글자 자리)
const BAND_GAP = 14 // 겹(해) 사이 틈 (신고·조치 표식 자리)
const BAND = THICKNESS_MAX + BAND_GAP // 한 해가 차지하는 반지름 폭
const SLICE = (Math.PI * 2) / 12 // 한 달 조각의 각도
const PAD = 0.012 // 조각 사이 틈(라디안)

// 극좌표 → 화면 좌표. 각도 0은 12시, 시계 방향 (D3 arc와 같은 기준)
const at = (r: number, a: number) => ({ x: C + r * Math.sin(a), y: C - r * Math.cos(a) })

const sliceArc = arc<{ inner: number; outer: number; start: number; end: number }>()
  .innerRadius((d) => d.inner)
  .outerRadius((d) => d.outer)
  .startAngle((d) => d.start)
  .endAngle((d) => d.end)
  .padAngle(PAD)
  .cornerRadius(2)

const STAR = symbol().type(symbolStar).size(70)()
const REPORT = symbol().type(symbolTriangle).size(26)()
const RESOLVED = symbol().type(symbolCircle).size(22)()
const REACTION = symbol().type(symbolDiamond).size(20)()

// 디지털 나이테 (#44). 1년 1겹, 월별 12조각. 조각을 누르면 그 달 요약, 별을 누르면 그 이야기로 간다.
export default function TreeRingChart({ rings, today, sample = false }: TreeRingChartProps) {
  const navigate = useNavigate()
  const latest = rings[rings.length - 1]
  const thisMonth = Number(today.slice(5, 7))
  const [selected, setSelected] = useState<{ year: number; month: number }>({
    year: latest.year,
    month: latest.year === Number(today.slice(0, 4)) ? thisMonth : 12,
  })

  const selectedMonth = rings.find((r) => r.year === selected.year)?.months.find((m) => m.month === selected.month)

  function onKey(e: KeyboardEvent, year: number, month: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSelected({ year, month })
    }
  }

  function openStory(e: MouseEvent, id: number) {
    e.preventDefault()
    navigate(`/stories/${id}`)
  }

  return (
    <figure className="rings">
      <svg className="rings__svg" viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label={`디지털 나이테, ${rings.map((r) => r.year).join('·')}년`}>
        {rings.map((ring, k) => {
          const inner = CORE + k * BAND
          return (
            <g key={ring.year}>
              {ring.months.map((m) => {
                const start = (m.month - 1) * SLICE
                const end = m.month * SLICE
                const future = isFuture(ring.year, m.month, today)
                const outer = inner + ringThickness(m)
                const isSel = selected.year === ring.year && selected.month === m.month
                const label = `${ring.year}년 ${m.month}월: ${future ? '아직 오지 않은 달' : `${HEAT_LABEL[heatLevel(m)]}, ${monthSummary(m)}`}`
                return (
                  <g key={m.month}>
                    {/* 조각: 두께 = 받은 비와 돌봄, 색 = 더위 */}
                    <path
                      className={`rings__slice ring-heat-${future ? 'none' : heatLevel(m)}${isSel ? ' is-selected' : ''}`}
                      d={sliceArc({ inner, outer, start, end }) ?? ''}
                      transform={`translate(${C},${C})`}
                      role="button"
                      tabIndex={future ? -1 : 0}
                      aria-pressed={isSel}
                      aria-label={label}
                      onClick={() => !future && setSelected({ year: ring.year, month: m.month })}
                      onKeyDown={(e) => !future && onKey(e, ring.year, m.month)}
                    />
                    {!future && <MonthMarks m={m} year={ring.year} inner={inner} outer={outer} start={start} onStory={openStory} />}
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* 가운데: 고른 달 */}
        <text x={C} y={C - 4} textAnchor="middle" className="rings__center-big">
          {selected.month}월
        </text>
        <text x={C} y={C + 18} textAnchor="middle" className="rings__center-small">
          {selected.year}년
        </text>
      </svg>

      <figcaption className="rings__caption">
        {selectedMonth && (
          <p className="body">
            <strong>
              {selected.year}년 {selected.month}월
            </strong>{' '}
            · {HEAT_LABEL[heatLevel(selectedMonth)]} · {monthSummary(selectedMonth)}
          </p>
        )}
        {sample && <p className="caption rings__sample">예시 데이터예요. 이야기 별만 이 나무의 실제 이야기이고, 나머지는 나이테 API(#12)가 준비되면 실제 기록으로 바뀌어요.</p>}
        <RingLegend />
      </figcaption>
    </figure>
  )
}

// 한 달 조각 위의 점(활동한 날)·별(이야기)·표식(신고·조치·받은 호응)
function MonthMarks({ m, year, inner, outer, start, onStory }: { m: RingMonth; year: number; inner: number; outer: number; start: number; onStory: (e: MouseEvent, id: number) => void }) {
  const days = new Date(year, m.month, 0).getDate()
  const dayAngle = (day: number) => start + PAD + ((day - 0.5) / days) * (SLICE - 2 * PAD)
  const mid = start + SLICE / 2
  return (
    <g aria-hidden={m.stories.length === 0 ? true : undefined}>
      {/* 점: 활동한 날 */}
      {m.activityDays.map((d) => {
        const p = at((inner + outer) / 2, dayAngle(d))
        return <circle key={`d${d}`} className="rings__dot" cx={p.x} cy={p.y} r={2.2} />
      })}
      {/* 표식: 신고(빨간 세모)·조치(초록 점) — 조각 안쪽 가장자리 */}
      {m.reported > 0 && <Mark className="rings__report" d={REPORT} p={at(inner - 6, mid - 0.12)} />}
      {m.resolved > 0 && <Mark className="rings__resolved" d={RESOLVED} p={at(inner - 6, mid + 0.12)} />}
      {/* 표식: 받은 호응 — 조각 바깥 가장자리 */}
      {m.reactions > 0 && <Mark className="rings__reaction" d={REACTION} p={at(outer + 5, start + SLICE - 0.08)} />}
      {/* 별: 이야기 (누르면 그 이야기로) */}
      {m.stories.map((s) => {
        const p = at(outer + 9, dayAngle(s.day))
        return (
          <a key={`s${s.id}`} href={`/stories/${s.id}`} onClick={(e) => onStory(e, s.id)} aria-label={`${year}년 ${m.month}월 ${s.day}일 이야기 보기`}>
            <circle cx={p.x} cy={p.y} r={11} className="rings__star-hit" />
            <path className="rings__star" d={STAR ?? ''} transform={`translate(${p.x},${p.y})`} />
          </a>
        )
      })}
    </g>
  )
}

function Mark({ className, d, p }: { className: string; d: string | null; p: { x: number; y: number } }) {
  return <path className={className} d={d ?? ''} transform={`translate(${p.x},${p.y})`} />
}

// 읽는 법
function RingLegend() {
  return (
    <ul className="rings__legend caption">
      <li>한 겹이 한 해, 한 조각이 한 달이에요.</li>
      <li>조각이 두꺼울수록 그 달 나무가 받은 비와 돌봄이 많았어요.</li>
      <li className="rings__legend-heat">
        <span>색은 더위:</span>
        {(['cold', 'cool', 'mild', 'warm', 'hot'] as const).map((h) => (
          <span key={h} className="rings__legend-item">
            <span className={`rings__swatch ring-heat-${h}`} aria-hidden="true" />
            {HEAT_LABEL[h]}
          </span>
        ))}
      </li>
      <li className="rings__legend-marks">
        <LegendIcon className="rings__dot-icon" /> 활동한 날
        <LegendIcon className="rings__star-icon" d={STAR} /> 이야기
        <LegendIcon className="rings__report" d={REPORT} /> 신고
        <LegendIcon className="rings__resolved" d={RESOLVED} /> 조치
        <LegendIcon className="rings__reaction" d={REACTION} /> 받은 호응
      </li>
    </ul>
  )
}

function LegendIcon({ className, d }: { className: string; d?: string | null }) {
  return (
    <svg className="rings__legend-icon" viewBox="-8 -8 16 16" aria-hidden="true">
      {d ? <path className={className} d={d} /> : <circle className="rings__dot" r={2.5} />}
    </svg>
  )
}
