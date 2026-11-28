// 단체 선택 상자 (#147). 처리 화면의 목록을 그 단체 회원 것으로 좁힌다.
// 단체 목록은 한눈에 보기 집계의 organizations(이 관리청 나무를 돌보는 회원이 있는 단체)를 쓴다.
import { useDashboard } from '../api/dashboard';
import ui from './ui.module.css';

export function OrgFilter({ value, onChange }: { value: number | null; onChange: (organizationId: number | null) => void }) {
  const { data } = useDashboard({});

  return (
    <label className={ui.filter}>
      <span>단체</span>
      <select
        className={ui.filterSelect}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{data ? `${data.agency} 전체` : '전체'}</option>
        {data?.organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        {/* 주소로 들어온 단체가 목록에 없어도 선택 상자가 빈칸이 되지 않게 한다 */}
        {value !== null && data && !data.organizations.some((o) => o.id === value) && (
          <option value={value}>단체 #{value}</option>
        )}
      </select>
    </label>
  );
}
