import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import TopBar from '../components/TopBar'
import ChoiceGroup from '../components/ChoiceGroup'
import PhotoPicker, { type PickedPhoto } from '../components/PhotoPicker'
import RecordSaved from './RecordSaved'
import {
  ACTIVITY_OPTIONS,
  DURATION_OPTIONS,
  MAX_PHOTOS,
  NOTE_MAX_LENGTH,
  REPORT_TYPES,
  formatMinutes,
  reportLabel,
  type ReportCategory,
} from '../content/recordOptions'
import { api, ApiError, type ApiRecord } from '../lib/api'
import { formatKoreanDate, todayKey } from '../lib/date'
import { myActiveTrees } from '../lib/homeSummary'
import './RecordNewPage.css'

type Mode = 'activity' | 'report'
type Located = { lat: number; lng: number; accuracy: number }
type TreeOption = { id: number; name: string; agency: string; mine: boolean } // mine: 내가 돌보는 나무

// 날짜별 활동 기록·이상 신고 화면 (#39, API #5)
// 주소 예: /records/new (돌봄)  /records/new?type=report&tree=2 (2번 나무 신고)
// - 돌봄 기록은 내가 돌보는 나무에만 쓸 수 있다 (서버 403). 날짜는 서버가 오늘로 정한다.
// - 신고는 로그인한 시민이면 어느 나무든 할 수 있다 (나무 상세에서 ?tree= 로 넘어온다).
export default function RecordNewPage() {
  const [params, setParams] = useSearchParams()
  const mode: Mode = params.get('type') === 'report' ? 'report' : 'activity'
  const urlTreeId = Number(params.get('tree')) || null

  // 나무 목록과 이번 달 기록한 날 (저장 뒤 "이번 달 N일째" 계산용)
  const [trees, setTrees] = useState<TreeOption[] | null>(null)
  const [monthDays, setMonthDays] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState('')

  const [treeIds, setTreeIds] = useState<number[]>([])
  const [photos, setPhotos] = useState<PickedPhoto[]>([])
  const [note, setNote] = useState('')
  const [activities, setActivities] = useState<string[]>([])
  const [minutes, setMinutes] = useState<number[]>([])
  const [reportType, setReportType] = useState<ReportCategory[]>([])
  const [location, setLocation] = useState<Located | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')

  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<{ record: ApiRecord; tree: TreeOption; daysBefore: number; daysAfter: number } | null>(null)

  const date = todayKey()

  useEffect(() => {
    let alive = true
    Promise.all([api.myApplications(), api.myRecords(), urlTreeId ? api.tree(urlTreeId).catch(() => null) : Promise.resolve(null)])
      .then(([apps, recs, urlTree]) => {
        if (!alive) return
        const mine: TreeOption[] = myActiveTrees(apps.applications, recs.records, date).map((t) => ({
          id: t.id,
          name: t.name,
          agency: apps.applications.find((a) => a.tree.id === t.id)?.tree.district ?? '',
          mine: true,
        }))
        // 신고하려고 들어온 나무가 내 나무가 아니면 목록 맨 앞에 더한다
        const list =
          urlTree && !mine.some((t) => t.id === urlTree.id)
            ? [{ id: urlTree.id, name: urlTree.name, agency: urlTree.agency, mine: false }, ...mine]
            : mine
        setTrees(list)
        setMonthDays(new Set(recs.records.filter((r) => r.type === 'activity' && r.activityDate).map((r) => r.activityDate as string)))
        const first = (urlTreeId && list.find((t) => t.id === urlTreeId)) || list.find((t) => t.mine) || list[0]
        if (first) setTreeIds([first.id])
      })
      .catch((e) => {
        if (alive) setLoadError(e instanceof ApiError ? e.message : '내 나무를 불러오지 못했어요.')
      })
    return () => {
      alive = false
    }
  }, [urlTreeId, date])

  if (saved) {
    return <RecordSaved record={saved.record} treeName={saved.tree.name} agency={saved.tree.agency} daysBefore={saved.daysBefore} daysAfter={saved.daysAfter} />
  }

  // 돌봄 기록은 내 나무에만, 신고는 아무 나무에나
  const options = (trees ?? []).filter((t) => mode === 'report' || t.mine)
  const tree = options.find((t) => t.id === treeIds[0])

  const missing: string[] = []
  if (!tree) missing.push('나무')
  if (mode === 'activity') {
    if (activities.length === 0) missing.push('한 일')
    if (minutes.length === 0) missing.push('활동 시간')
    // 기록 검증(#13): 나무 근처 위치가 확인되지 않으면 사진이 필요하다. 거리는 서버가 확인한다
    if (!location && photos.length === 0) missing.push('사진 또는 현장 위치')
  } else {
    if (reportType.length === 0) missing.push('신고 유형')
    if (photos.length === 0) missing.push('사진')
  }

  function switchMode(next: Mode) {
    const nextParams = new URLSearchParams(params)
    if (next === 'report') nextParams.set('type', 'report')
    else nextParams.delete('type')
    setParams(nextParams, { replace: true })
    setError('')
  }

  function findMyLocation() {
    // 위치를 못 쓸 때: 신고는 나무 위치로 보내고, 활동 기록은 사진으로 확인한다(#13)
    const fallback = mode === 'activity' ? '나무 사진을 올려 주세요.' : '나무 위치로 보낼게요.'
    if (!('geolocation' in navigator)) {
      setLocationMessage(`이 브라우저는 위치를 알려 주지 않아요. ${fallback}`)
      return
    }
    setLocating(true)
    setLocationMessage('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) })
        setLocating(false)
      },
      () => {
        setLocating(false)
        setLocationMessage(`위치를 가져오지 못했어요. ${fallback}`)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function submit() {
    if (missing.length > 0 || !tree || sending) return
    setSending(true)
    setError('')
    try {
      const files = photos.map((p) => p.file)
      const record =
        mode === 'activity'
          ? await api.createRecord({
              type: 'activity',
              treeId: tree.id,
              activityKinds: activities,
              durationMin: minutes[0],
              memo: note.trim(),
              photos: files,
              ...(location && { lat: location.lat, lng: location.lng, accuracy: location.accuracy }), // 나무 근처 확인에만 쓰고 서버가 저장하지 않는다
            })
          : await api.createRecord({
              type: 'report',
              treeId: tree.id,
              category: reportType[0],
              memo: note.trim(),
              photos: files,
              ...(location && { lat: location.lat, lng: location.lng }),
            })
      const daysBefore = monthDays.size
      const day = record.activityDate ?? date
      const daysAfter = record.type === 'activity' && !monthDays.has(day) ? daysBefore + 1 : daysBefore
      setSaved({ record, tree, daysBefore, daysAfter })
    } catch (err) {
      setError(recordErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="app-shell tc-screen">
      <TopBar title="기록하기" kind="close" />

      <div className="record-tabs">
        <div className="tc-tabs" role="tablist" aria-label="기록 종류">
          <button className="tc-tab" role="tab" type="button" aria-selected={mode === 'activity'} onClick={() => switchMode('activity')}>
            돌봄
          </button>
          <button className="tc-tab" role="tab" type="button" aria-selected={mode === 'report'} onClick={() => switchMode('report')}>
            신고
          </button>
        </div>
      </div>

      <form
        className="page record-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="page-title">
          <h1 className="display">{mode === 'activity' ? '오늘 한 일을 남겨요' : '나무가 아파 보이면 알려 주세요'}</h1>
          <p className="body">
            {mode === 'activity'
              ? `${formatKoreanDate(date)} 기록이에요. 월말에 보고서로 묶어 구청에 낼 수 있어요.`
              : `신고는 공개되지 않고 ${tree?.agency || '관리청'} 담당자에게만 가요. 처리되면 알림으로 알려 드려요.`}
          </p>
        </div>

        {loadError && (
          <p className="tc-field__error" role="alert">
            {loadError}
          </p>
        )}
        {trees === null && !loadError && <p className="body record-muted">내 나무를 불러오는 중이에요.</p>}

        {trees !== null && options.length === 0 ? (
          <div className="record-empty">
            <p className="body">
              {mode === 'activity'
                ? '돌보는 나무가 있어야 활동을 기록할 수 있어요. 돌보미로 승인되면 여기에 나무가 나와요.'
                : '신고할 나무를 지도에서 골라 주세요. 나무 상세의 "나무가 아파 보여요"로 들어오면 돼요.'}
            </p>
            <Link className="tc-link" to="/map">
              지도에서 나무 찾기
            </Link>
          </div>
        ) : (
          trees !== null && (
            <>
              <ChoiceGroup
                label="어느 나무인가요"
                options={options.map((t) => t.id)}
                selected={treeIds}
                onChange={(next) => next.length > 0 && setTreeIds(next)}
                format={(id) => options.find((t) => t.id === id)?.name ?? ''}
              />

              {mode === 'activity' ? (
                <>
                  <ChoiceGroup label="한 일 (여러 개 고를 수 있어요)" options={ACTIVITY_OPTIONS} selected={activities} onChange={setActivities} multiple />
                  <ChoiceGroup label="활동 시간" options={DURATION_OPTIONS} selected={minutes} onChange={setMinutes} format={formatMinutes} />
                  <div className="tc-field">
                    <span className="tc-field__label">현장 확인</span>
                    <div className="tc-rows">
                      <div className="tc-row">
                        <span>{location ? '내 위치' : '위치 확인 전'}</span>
                        <span className="tc-row__value">{location ? `오차 약 ${location.accuracy}m` : '사진으로 대신할 수 있어요'}</span>
                      </div>
                    </div>
                    {!location && (
                      <div className="tc-choices__list field-only">
                        <button type="button" className="tc-choice" onClick={findMyLocation} disabled={locating}>
                          {locating ? '위치 찾는 중' : '나무 앞에서 위치 확인하기'}
                        </button>
                      </div>
                    )}
                    <span className="tc-field__help">
                      {locationMessage || '나무 30m 안에서 위치가 확인되면 사진 없이도 저장돼요. 위치는 확인에만 쓰고 저장하지 않아요.'}
                    </span>
                  </div>
                  <PhotoPicker
                    label={location ? '사진 (선택)' : '사진 (위치 확인을 안 하면 꼭 필요해요)'}
                    photos={photos}
                    onChange={setPhotos}
                    max={MAX_PHOTOS}
                    help="사진이 있는 기록만 활동 순위에 들어가요."
                  />
                </>
              ) : (
                <>
                  <ChoiceGroup
                    label="무엇이 문제인가요"
                    options={REPORT_TYPES.map((t) => t.code)}
                    selected={reportType}
                    onChange={setReportType}
                    format={reportLabel}
                  />
                  <PhotoPicker label="사진 (꼭 필요해요)" photos={photos} onChange={setPhotos} max={MAX_PHOTOS} help="담당자가 현장에 가기 전에 상태를 볼 수 있게 한 장 이상 올려 주세요." />
                  <div className="tc-field">
                    <span className="tc-field__label">위치</span>
                    <div className="tc-rows">
                      <div className="tc-row">
                        <span>{location ? '내 위치' : '나무 위치'}</span>
                        <span className="tc-row__value">{location ? `오차 약 ${location.accuracy}m` : tree?.name ?? ''}</span>
                      </div>
                    </div>
                    {!location && (
                      <div className="tc-choices__list field-only">
                        <button type="button" className="tc-choice" onClick={findMyLocation} disabled={locating}>
                          {locating ? '위치 찾는 중' : '내 위치도 함께 보내기'}
                        </button>
                      </div>
                    )}
                    {locationMessage && <span className="tc-field__help">{locationMessage}</span>}
                  </div>
                </>
              )}

              <div className="tc-field">
                <label className="tc-field__label" htmlFor="record-note">
                  {mode === 'activity' ? '짧은 글 (선택)' : '상황 설명 (선택)'}
                </label>
                <textarea
                  id="record-note"
                  className={note ? 'tc-field__input is-filled' : 'tc-field__input'}
                  value={note}
                  maxLength={NOTE_MAX_LENGTH}
                  placeholder={mode === 'activity' ? '잎이 반쯤 노랗게 바뀌었다' : '지지대가 줄기를 파고들어 있다'}
                  onChange={(e) => setNote(e.target.value)}
                />
                <span className="tc-field__count">
                  {note.length}/{NOTE_MAX_LENGTH}
                </span>
              </div>

              {error && (
                <p className="tc-field__error" role="alert">
                  {error}
                </p>
              )}

              <div className="page-bottom">
                {missing.length > 0 && <p className="micro record-missing">아직 안 고른 것: {missing.join(', ')}</p>}
                <button className="tc-btn tc-btn--primary" type="submit" disabled={missing.length > 0 || sending}>
                  {sending ? '올리는 중' : mode === 'activity' ? '기록 저장' : '신고 보내기'}
                </button>
              </div>
            </>
          )
        )}
      </form>
    </div>
  )
}

function recordErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return '이 나무의 승인된 돌보미만 활동을 기록할 수 있어요. 활동 기간도 확인해 주세요.'
    if (err.status === 400 && err.code === 'UPLOAD_ERROR') return '사진을 올리지 못했어요. jpg·png·webp·heic 사진을 한 장 10MB 이하로 올려 주세요.'
    if (err.status === 400 && err.code === 'PHOTO_REQUIRED') return '나무 근처에서 위치가 확인되지 않았어요. 나무 사진을 한 장 이상 올려 주세요.'
    if (err.status === 400) return '입력한 내용을 다시 확인해 주세요.'
    if (err.status === 0) return err.message
  }
  return '기록을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.'
}
