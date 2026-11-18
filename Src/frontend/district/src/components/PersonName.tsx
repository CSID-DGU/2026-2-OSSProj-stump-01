// 돌보미 표시: '별명 (실명)'. 실명은 신청서에 적은 경우에만 있다. 구청 담당자만 보는 화면에서만 쓴다.
import type { Person } from '../api/types';

export function PersonName({ person }: { person: Pick<Person, 'nickname' | 'realName'> }) {
  return (
    <span>
      {person.nickname}
      {person.realName && <span style={{ color: 'var(--color-text-muted)' }}> ({person.realName})</span>}
    </span>
  );
}
