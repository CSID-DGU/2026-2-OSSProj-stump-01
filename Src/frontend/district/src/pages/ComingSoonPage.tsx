// 아직 만들지 않은 처리 화면 자리. 각 이슈에서 실제 화면으로 바꾼다.
export function ComingSoonPage({ title, issue }: { title: string; issue: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h1 style={{ fontFamily: 'var(--font-title)', fontSize: 28 }}>{title}</h1>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>이 화면은 #{issue}에서 만듭니다.</p>
    </div>
  );
}
