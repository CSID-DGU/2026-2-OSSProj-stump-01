import { toDateKey, todayKey } from '../lib/date'

type CalendarProps = {
  month: string // 보여 줄 달 "2026-11"
  selectable: Set<string> // 누를 수 있는 날 (보고서에 안 넣은 기록이 있는 날)
  submitted: Set<string> // 이미 보고서로 낸 날
  selected: Set<string> // 고른 날
  onToggle: (date: string) => void
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

// 한 달 달력. 일요일부터 시작한다.
// 누를 수 있는 날만 버튼이 켜지고, 고른 날은 초록으로 채워진다. 이미 낸 날은 "제출"이라고 적힌다.
export default function Calendar({ month, selectable, submitted, selected, onToggle }: CalendarProps) {
  const [y, m] = month.split('-').map(Number)
  const firstWeekday = new Date(y, m - 1, 1).getDay()
  const lastDay = new Date(y, m, 0).getDate()
  const today = todayKey()

  // 앞쪽 빈칸 + 1일~말일
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: lastDay }, (_, i) => toDateKey(new Date(y, m - 1, i + 1))),
  ]

  return (
    <div className="tc-calendar">
      <div className="tc-calendar__grid" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w} className="tc-calendar__weekday">
            {w}
          </span>
        ))}
      </div>
      <div className="tc-calendar__grid">
        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />
          const day = Number(date.slice(8))
          const canPick = selectable.has(date)
          const isOn = selected.has(date)
          const isSubmitted = submitted.has(date)
          const classes = ['tc-calendar__day']
          if (canPick) classes.push('is-open')
          if (isOn) classes.push('is-selected')
          if (date === today) classes.push('is-today')

          let label = `${m}월 ${day}일`
          if (isSubmitted) label += ', 이미 보고서로 냄'
          else if (canPick) label += isOn ? ', 고름' : ', 기록 있음'
          else label += ', 기록 없음'

          return (
            <button
              key={date}
              type="button"
              className={classes.join(' ')}
              disabled={!canPick}
              aria-pressed={canPick ? isOn : undefined}
              aria-label={label}
              onClick={() => onToggle(date)}
            >
              <span>{day}</span>
              {isSubmitted && <span className="tc-calendar__tag">제출</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
