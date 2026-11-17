import PageTitle from '../components/PageTitle'

type PlaceholderPageProps = {
  title: string
  issue: string // 이 화면을 만드는 GitHub 이슈 번호
  plan: string // 이 화면에 들어갈 것
}

// 아직 만들지 않은 화면 자리. 이슈를 진행하면서 실제 화면으로 바꾼다.
export default function PlaceholderPage({ title, issue, plan }: PlaceholderPageProps) {
  return (
    <div className="page">
      <PageTitle title={title} description={plan} />
      <div className="tc-rows">
        <div className="tc-row">
          <span>만들 이슈</span>
          <span className="tc-row__value">{issue}</span>
        </div>
      </div>
    </div>
  )
}
