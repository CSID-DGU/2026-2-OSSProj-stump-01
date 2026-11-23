import { useEffect, useState } from 'react'
import { api, ApiError, type TodayWeather } from '../lib/api'
import './WeatherToday.css'

type WeatherTodayProps = {
  treeId?: number // 이 나무 위치 기준 (없으면 서울시청 기준)
  placeLabel: string // "은행나무, 난계로 기준" 같은 설명
}

// 오늘의 날씨와 활동 추천 시간 (#79, API #72)
// 기상청 단기예보·특보로 서버가 계산한 값을 그대로 보여 준다. 폭염(33℃ 이상 또는 폭염특보)이면 낮 활동 자제를 알린다.
export default function WeatherToday({ treeId, placeLabel }: WeatherTodayProps) {
  const [weather, setWeather] = useState<TodayWeather | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .weatherToday(treeId)
      .then((w) => {
        if (alive) setWeather(w)
      })
      .catch((e) => {
        if (!alive) return
        // 503: 기상청 키 미설정·활용 신청 전·기상청 장애. 홈의 다른 내용은 그대로 보여 준다
        setFailed(e instanceof ApiError && e.status === 503 ? '지금은 날씨 정보를 가져올 수 없어요.' : '날씨를 불러오지 못했어요.')
      })
    return () => {
      alive = false
    }
  }, [treeId])

  if (failed) {
    return (
      <section className="weather" aria-label="오늘의 날씨">
        <p className="caption weather-muted">오늘의 날씨</p>
        <p className="body weather-muted">{failed}</p>
      </section>
    )
  }

  if (!weather) {
    return (
      <section className="weather" aria-label="오늘의 날씨" aria-busy="true">
        <p className="caption weather-muted">오늘의 날씨를 불러오는 중이에요.</p>
      </section>
    )
  }

  const times = weather.recommendedTimes.map((t) => `${t.start}~${t.end}`).join(', ')

  return (
    <section className={weather.isHeatwave ? 'weather is-heat' : 'weather'} aria-label="오늘의 날씨">
      <div className="weather__head">
        <span className="caption weather-muted">오늘의 날씨 · {placeLabel}</span>
        {weather.warnings.length > 0 && (
          <span className="tc-status tc-status--alert">{weather.warnings.join(', ')}</span>
        )}
      </div>

      <div className="weather__temps">
        <span className="display-xl weather__max">{weather.tempMax !== null ? `${Math.round(weather.tempMax)}°` : '-'}</span>
        <span className="body weather-muted">
          최고{weather.tempMin !== null ? ` · 최저 ${Math.round(weather.tempMin)}°` : ''}
        </span>
      </div>

      <div className="tc-rows">
        <div className="tc-row">
          <span>활동하기 좋은 시간</span>
          <span className={times ? 'tc-row__value' : 'tc-row__value tc-row__value--earth'}>{times || '오늘은 추천 시간이 없어요'}</span>
        </div>
      </div>

      <p className={weather.isHeatwave ? 'body weather__message weather-alert' : 'body weather__message'}>{weather.message}</p>
    </section>
  )
}
