type PageTitleProps = {
  title: string
  description?: string
}

// 화면 제목(h1, Hahmlet)과 그 아래 설명 한 줄.
export default function PageTitle({ title, description }: PageTitleProps) {
  return (
    <div className="page-title">
      <h1 className="display">{title}</h1>
      {description && <p className="body">{description}</p>}
    </div>
  )
}
