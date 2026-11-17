import { useState } from 'react'
import { useSearchParams } from 'react-router'
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
import { myTrees, findTree } from '../mocks/sample'
import { formatKoreanDate, todayKey } from '../lib/date'
import {
  addActivity,
  addReport,
  countRecordDaysThisMonth,
  useRecords,
  type TreeRecord,
} from '../store/recordStore'
import './RecordNewPage.css'

type Mode = 'activity' | 'report'
type Located = { lat: number; lng: number; accuracy: number }

// 날짜별 활동 기록·이상 신고 화면 (#39)
// 주소 예: /records/new (돌봄)  /records/new?type=report&tree=2 (2번 나무 신고)
export default function RecordNewPage() {
  const [params, setParams] = useSearchParams()
  const mode: Mode = params.get('type') === 'report' ? 'report' : 'activity'
  const records = useRecords()

  // 공통 입력
  const [treeIds, setTreeIds] = useState<number[]>(() => {
    const fromUrl = Number(params.get('tree'))
    return [findTree(fromUrl) ? fromUrl : myTrees[0].id]
  })
  const [photos, setPhotos] = useState<PickedPhoto[]>([])
  const [note, setNote] = useState('')

  // 돌봄 기록 입력
  const [activities, setActivities] = useState<string[]>([])
  const [minutes, setMinutes] = useState<number[]>([])

  // 신고 입력
  const [reportType, setReportType] = useState<ReportCategory[]>([])
  const [location, setLocation] = useState<Located | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')

  // 저장이 끝나면 결과 화면을 보여 준다
  const [saved, setSaved] = useState<{ record: TreeRecord; daysBefore: number } | null>(null)

  const date = todayKey()
  const tree = findTree(treeIds[0])

  if (saved) {
    return <RecordSaved record={saved.record} daysBefore={saved.daysBefore} daysAfter={countRecordDaysThisMonth(records)} />
  }

  // 아직 안 채운 것 (저장 버튼 위에 알려 준다)
  const missing: string[] = []
  if (!tree) missing.push('나무')
  if (mode === 'activity') {
    if (activities.length === 0) missing.push('한 일')
    if (minutes.length === 0) missing.push('활동 시간')
  } else {
    if (reportType.length === 0) missing.push('신고 유형')
    if (photos.length === 0) missing.push('사진')
  }

  function switchMode(next: Mode) {
    const nextParams = new URLSearchParams(params)
    if (next === 'report') nextParams.set('type', 'report')
    else nextParams.delete('type')
    setParams(nextParams, { replace: true })
  }

  function findMyLocation() {
    if (!('geolocation' in navigator)) {
      setLocationMessage('이 브라우저는 위치를 알려 주지 않아요. 나무 위치로 보낼게요.')
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
        setLocationMessage('위치를 가져오지 못했어요. 나무 위치로 보낼게요.')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  function submit() {
    if (missing.length > 0 || !tree) return
    const daysBefore = countRecordDaysThisMonth(records)
    const record =
      mode === 'activity'
        ? addActivity({
            treeId: tree.id,
            date,
            activities,
            note: note.trim(),
            minutes: minutes[0],
            photoCount: photos.length,
          })
        : addReport({
            treeId: tree.id,
            date,
            reportType: reportType[0],
            note: note.trim(),
            photoCount: photos.length,
            location,
          })
    setSaved({ record, daysBefore })
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
              : `신고는 공개되지 않고 ${tree?.district ?? '관리청'} 담당자에게만 가요. 처리되면 알림으로 알려 드려요.`}
          </p>
        </div>

        <ChoiceGroup
          label="어느 나무인가요"
          options={myTrees.map((t) => t.id)}
          selected={treeIds}
          onChange={(next) => next.length > 0 && setTreeIds(next)}
          format={(id) => {
            const t = findTree(id)
            return t ? `${t.species}, ${t.place}` : ''
          }}
        />

        {mode === 'activity' ? (
          <>
            <ChoiceGroup label="한 일 (여러 개 고를 수 있어요)" options={ACTIVITY_OPTIONS} selected={activities} onChange={setActivities} multiple />
            <ChoiceGroup label="활동 시간" options={DURATION_OPTIONS} selected={minutes} onChange={setMinutes} format={formatMinutes} />
            <PhotoPicker label="사진" photos={photos} onChange={setPhotos} max={MAX_PHOTOS} help="사진이 있는 기록만 활동 순위에 들어가요." />
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
                  <span className="tc-row__value">
                    {location ? `오차 약 ${location.accuracy}m` : tree ? `${tree.species}, ${tree.place}` : ''}
                  </span>
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

        <div className="page-bottom">
          {missing.length > 0 && <p className="micro record-missing">아직 안 고른 것: {missing.join(', ')}</p>}
          <button className="tc-btn tc-btn--primary" type="submit" disabled={missing.length > 0}>
            {mode === 'activity' ? '기록 저장' : '신고 보내기'}
          </button>
        </div>
      </form>
    </div>
  )
}
