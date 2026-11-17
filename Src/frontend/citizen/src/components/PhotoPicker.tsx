import { useEffect, useRef, useState } from 'react'

export type PickedPhoto = {
  id: string
  file: File
  url: string // 미리보기용 주소 (브라우저 안에서만 쓰임)
}

type PhotoPickerProps = {
  label: string
  photos: PickedPhoto[]
  onChange: (next: PickedPhoto[]) => void
  max: number
  help?: string
}

// 사진 고르기. "사진 찍기"는 휴대폰 카메라를 바로 열고, "앨범에서 고르기"는 저장된 사진을 고른다.
// 데스크탑에서는 field-only가 붙은 "사진 찍기"가 숨겨진다.
export default function PhotoPicker({ label, photos, onChange, max, help }: PhotoPickerProps) {
  const cameraInput = useRef<HTMLInputElement>(null)
  const albumInput = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')

  // 화면을 떠날 때 미리보기 주소를 정리한다 (메모리 낭비 방지)
  const latest = useRef(photos)
  useEffect(() => {
    latest.current = photos
  }, [photos])
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

  function addFiles(fileList: FileList | null) {
    if (!fileList) return
    const room = max - photos.length
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
    if (files.length > room) setMessage(`사진은 ${max}장까지 올릴 수 있어요. 앞의 ${room}장만 넣었어요.`)
    else setMessage('')
    const added = files.slice(0, room).map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 6)}`,
      file,
      url: URL.createObjectURL(file),
    }))
    onChange([...photos, ...added])
  }

  function remove(id: string) {
    const target = photos.find((p) => p.id === id)
    if (target) URL.revokeObjectURL(target.url)
    onChange(photos.filter((p) => p.id !== id))
    setMessage('')
  }

  const full = photos.length >= max

  return (
    <div className="tc-field">
      <span className="tc-field__label">
        {label} ({photos.length}/{max})
      </span>

      {photos.length > 0 && (
        <ul className="tc-photos">
          {photos.map((photo, index) => (
            <li key={photo.id} className="tc-photos__item">
              <img src={photo.url} alt={`고른 사진 ${index + 1}`} />
              <button type="button" className="tc-photos__remove" aria-label={`사진 ${index + 1} 빼기`} onClick={() => remove(photo.id)}>
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <div className="tc-choices__list">
          <button type="button" className="tc-choice field-only" onClick={() => cameraInput.current?.click()}>
            사진 찍기
          </button>
          <button type="button" className="tc-choice" onClick={() => albumInput.current?.click()}>
            앨범에서 고르기
          </button>
        </div>
      )}

      {/* 실제 파일 입력창은 숨기고 위 버튼으로 연다. capture는 휴대폰에서 카메라를 바로 연다. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={albumInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {message ? <span className="tc-field__error">{message}</span> : help && <span className="tc-field__help">{help}</span>}
    </div>
  )
}
