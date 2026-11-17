import { NavLink } from 'react-router'

// 시민 웹 주 메뉴 5개. 순서와 이름은 디자인 가이드(BottomNav)를 따른다.
// NavLink는 지금 주소와 같은 메뉴에 aria-current="page"를 자동으로 붙인다.
// CSS(.tc-nav)가 그 속성을 보고 노란 밑줄과 굵은 글씨를 그린다.
const MENUS = [
  { to: '/', label: '홈', end: true },
  { to: '/map', label: '지도', end: false },
  { to: '/records', label: '기록', end: false },
  { to: '/group', label: '우리 단체', end: false },
  { to: '/me', label: '나', end: false },
]

export default function BottomNav() {
  return (
    <nav className="tc-nav" aria-label="주 메뉴">
      {MENUS.map((menu) => (
        <NavLink key={menu.to} to={menu.to} end={menu.end}>
          {menu.label}
        </NavLink>
      ))}
    </nav>
  )
}
