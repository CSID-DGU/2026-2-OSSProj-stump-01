type ChoiceGroupProps<T extends string | number> = {
  label: string // 묶음 이름 (화면에 보이고, 화면 낭독기도 읽는다)
  options: readonly T[]
  selected: T[] // 고른 것들
  onChange: (next: T[]) => void
  multiple?: boolean // true면 여러 개, false면 하나만
  format?: (option: T) => string // 버튼에 보일 글자 (기본: 그대로)
}

// 칩 모양 선택 버튼 묶음. "한 일"(여러 개), "활동 시간"(하나)처럼 쓴다.
// 고른 버튼에는 aria-pressed="true"가 붙고 CSS가 초록 테두리로 보여 준다.
export default function ChoiceGroup<T extends string | number>({
  label,
  options,
  selected,
  onChange,
  multiple = false,
  format = (option) => String(option),
}: ChoiceGroupProps<T>) {
  function toggle(option: T) {
    const isOn = selected.includes(option)
    if (multiple) {
      onChange(isOn ? selected.filter((s) => s !== option) : [...selected, option])
    } else {
      onChange(isOn ? [] : [option])
    }
  }

  return (
    <fieldset className="tc-choices">
      <legend className="tc-field__label">{label}</legend>
      <div className="tc-choices__list">
        {options.map((option) => (
          <button
            key={String(option)}
            type="button"
            className="tc-choice"
            aria-pressed={selected.includes(option)}
            onClick={() => toggle(option)}
          >
            {format(option)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
