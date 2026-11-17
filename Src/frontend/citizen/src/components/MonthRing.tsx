import { useEffect, useState } from 'react'

type MonthRingProps = {
  month: number // 이번 달 (1~12)
  fromFraction: number // 저장 전 이번 달 조각이 찬 정도 (0~1)
  toFraction: number // 저장 후 찬 정도 (0~1)
  centerTop: string // 가운데 큰 글자
  centerBottom: string // 가운데 작은 글자
}

// 1년 = 12조각 고리. 저장하면 이번 달 조각이 fromFraction에서 toFraction까지 차오른다.
// 나이테의 정식 규칙(두께·색·점의 뜻)은 #44에서 정한다. 여기서는 "차오름" 연출만 한다.
const SIZE = 220
const CENTER = SIZE / 2
const RADIUS = 84
const STROKE = 18
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const GAP = 4 // 조각 사이 틈(px)
const SLICE = CIRCUMFERENCE / 12 - GAP

export default function MonthRing({ month, fromFraction, toFraction, centerTop, centerBottom }: MonthRingProps) {
  // 처음엔 저장 전 값으로 그리고, 바로 다음 순간 저장 후 값으로 바꿔서 CSS가 차오르게 한다
  const [fraction, setFraction] = useState(fromFraction)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFraction(toFraction))
    return () => cancelAnimationFrame(frame)
  }, [toFraction])

  return (
    <svg
      className="month-ring"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`${month}월 조각이 ${Math.round(toFraction * 100)}퍼센트 찼어요`}
    >
      {Array.from({ length: 12 }, (_, i) => {
        const m = i + 1
        // 12시 방향에서 1월이 시작해 시계 방향으로 돈다
        const rotate = -90 + i * 30
        const common = {
          cx: CENTER,
          cy: CENTER,
          r: RADIUS,
          fill: 'none',
          strokeWidth: STROKE,
          transform: `rotate(${rotate} ${CENTER} ${CENTER})`,
        }
        return (
          <g key={m}>
            {/* 바탕 조각 */}
            <circle {...common} className="month-ring__track" strokeDasharray={`${SLICE} ${CIRCUMFERENCE - SLICE}`} />
            {/* 지난달은 다 찬 조각, 이번 달은 차오르는 조각 */}
            {m < month && <circle {...common} className="month-ring__past" strokeDasharray={`${SLICE} ${CIRCUMFERENCE - SLICE}`} />}
            {m === month && (
              <circle
                {...common}
                className="month-ring__now"
                strokeDasharray={`${SLICE * fraction} ${CIRCUMFERENCE - SLICE * fraction}`}
              />
            )}
          </g>
        )
      })}
      <text x={CENTER} y={CENTER - 2} textAnchor="middle" className="month-ring__top">
        {centerTop}
      </text>
      <text x={CENTER} y={CENTER + 22} textAnchor="middle" className="month-ring__bottom">
        {centerBottom}
      </text>
    </svg>
  )
}
