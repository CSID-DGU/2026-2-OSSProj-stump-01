# 공용 나무 지도 (#27)

시민 웹(모바일)과 구청 웹(데스크탑)이 함께 쓰는 나무 지도다. 구청 웹은 "나무 지도" 화면(`district/src/pages/MapPage.tsx`)에서 쓴다.

## 하는 일

- **바탕 지도**: `kakaoKey`가 있으면 카카오맵, 없거나 SDK를 못 불러오면 OSM 임시 지도로 자동으로 바꾼다(`onEngine`으로 알려 준다).
- **마커 구분**(`markers.ts`): GET /trees 응답의 `hasOpenReport`, `careGap`으로 정한다. 한 나무가 여러 조건에 걸리면 급한 것 하나로 보인다.

  | 종류 | 조건 | 색 |
  |---|---|---|
  | `report` 미처리 신고 | `hasOpenReport` | `--color-danger` |
  | `inactive` 활동이 끊긴 나무 | `careGap = inactive` (관리 사각지대) | `--color-highlight` |
  | `cared` 돌보미 나무 | `careGap = null` | `--color-primary` |
  | `uncared` 돌보미 없는 나무 | `careGap = no_caregiver` (관리 사각지대) | `--color-text-faint` |

- **급한 나무 강조**: 미처리 신고·활동이 끊긴 나무는 점을 더 크게 그리고 둘레에 퍼지는 고리를 둘러 멀리서도 보이게 한다. 움직임을 줄이도록 설정한 기기(`prefers-reduced-motion`)에서는 고리를 멈춘다. 고른 나무는 가장 크게, 검은 테두리로 보인다.
- **묶음(클러스터)**: 화면에서 48px 칸 안의 나무를 하나로 묶어 숫자로 보여 준다. 테두리 색은 안에 든 가장 급한 종류이고, 안에 미처리 신고·활동이 끊긴 나무가 있으면 모서리 배지에 그 수를 단다. 누르면 그 자리로 두 단계 확대하고, 줌 17부터는 묶지 않는다. 라이브러리 없이 직접 묶는다(`clusterByGrid`).
- **출처**: 가로수 데이터가 공공누리 제4유형(출처표시)이라 지도 위에 항상 출처를 보여 준다. OSM 바탕이면 OSM 출처도 같이 보여 준다.
- **모바일·데스크탑**: 틀 요소 크기에 맞춰 그린다. OSM 바탕은 손가락 끌기(포인터 이벤트)·휠·+/− 버튼으로 움직인다.

## 왜 React 컴포넌트가 아닌가

두 웹의 React·Vite·React Router 버전이 달라서(`CLAUDE.md` 기술 스택), 한쪽 React로 만든 컴포넌트를 다른 쪽에서 쓰면 React가 두 벌 섞인다.
그래서 이 모듈은 React 없이 DOM만 쓰고, 각 웹이 `useEffect` 안에서 만들고 지운다. 의존 라이브러리가 없어서 어느 웹에서든 상대 경로로 불러오면 된다.

## 쓰는 법

```tsx
import { createTreeMap, type TreeMapHandle } from '../../../shared/map';

const box = useRef<HTMLDivElement>(null);
const map = useRef<TreeMapHandle<Tree> | null>(null);

useEffect(() => {
  const handle = createTreeMap<Tree>(box.current!, {
    kakaoKey: import.meta.env.VITE_KAKAO_MAP_KEY, // 비우면 OSM 임시 지도
    center: { lat: 37.5636, lng: 126.9976 },
    zoom: 16, // OSM 줌 11~19 (카카오 level = 20 - zoom)
    onBoundsChange: ({ bbox }) => fetchTrees(bbox).then((trees) => handle.setTrees(trees)), // GET /trees?bbox=
    onSelect: (tree) => setSelected(tree),
    onEngine: (kind, error) => {}, // 'kakao' | 'osm', 카카오를 못 불러왔으면 error
  });
  map.current = handle;
  return () => handle.destroy();
}, []);

// 고른 나무 강조
useEffect(() => map.current?.setSelected(selected?.id ?? null), [selected]);

// 목록에서 나무를 고르면 그 나무로 옮겨 가기(적어도 줌 17까지 확대)
function pick(tree: Tree) {
  setSelected(tree);
  map.current?.focus(tree.location);
}

return <div ref={box} style={{ height: 480 }} />; // 이 안에는 React 자식을 두지 않는다
```

- 나무 형식은 `MapTree`(id, name, location, caregiverCount, hasOpenReport, careGap)를 가진 아무 형이면 된다. GET /trees 응답을 그대로 넘기면 된다.
- 마커 종류를 화면마다 다르게 정하려면 `kindOf` 옵션을 넘긴다. 한쪽 화면만을 위해 이 폴더를 고치지 않는다(`CLAUDE.md` 경계 규칙).
- `handle`이 하는 일: `setTrees(나무 배열)`, `setSelected(id | null)`, `setCenter(위치)`, `focus(위치, 최소 줌)`, `destroy()`.
- 다른 화면으로 넘어갈 때 지도 틀이 페이지에서 빠지면 그 뒤로는 `onBoundsChange`를 부르지 않는다. 늦게 온 범위 알림이 주소(`?lat=…`)를 바꿔 이전 화면으로 되돌리는 일을 막기 위해서다.
- 범례는 `<span class="tm-dot tm-dot--report" />`처럼 같은 클래스를 쓰면 지도와 같은 모양이 나온다. 이름은 `MARKER_LABEL`.

### 각 웹에서 할 설정

- **카카오맵 키**: `Src/.env`의 `VITE_KAKAO_MAP_KEY`. Vite 설정에 `envDir: '../..'`를 둔다.
  카카오 개발자 콘솔 → 플랫폼 → Web → 사이트 도메인에 그 웹의 주소를 등록해야 한다(로컬: 시민 `http://localhost:5173`, 구청 `http://localhost:5174`).
- **개발 서버 파일 허용**: 이 폴더는 각 웹 폴더 밖이라 Vite 설정에 `server.fs.allow: ['.', '../shared']`를 둔다(구청 웹 `vite.config.ts` 참고).
- 이 폴더 파일을 고친 뒤 화면이 예전 그대로이거나 "is not a function" 오류가 나면 개발 서버(`npm run dev`)를 다시 켠다. 웹 폴더 밖 파일은 바뀐 것을 늦게 알아챌 때가 있다.

## 파일

| 파일 | 내용 |
|---|---|
| `treeMap.ts` | `createTreeMap`. 바탕 고르기, 마커·묶음 그리기, 범위 알림 |
| `markers.ts` | 마커 종류·이름·우선순위, 칸 묶음 |
| `engine.ts` | 바탕 지도가 해 줘야 하는 일(좌표 ↔ 화면 px, 확대, 마커 붙이기) |
| `kakao.ts` | 카카오맵 SDK 로더와 바탕 |
| `osm.ts` | OSM 타일 바탕(라이브러리 없음, 개발·시연 규모용) |
| `treeMap.css` | 마커·묶음·출처·OSM 바탕 모양 (`tm-`로 시작) |

## 아직 남은 것

- 지도를 넓게 보면 GET /trees가 최대 2,000그루만 줘서(`truncated`), 구청 웹은 그때 신고 처리 큐에서 받은 미처리 신고 나무만 보여 준다. 활동이 끊긴 나무도 넓게 보려면 그 나무 위치를 주는 API가 필요하다.
- 시민 웹 지도(`citizen/src/components/KakaoTreeMap.tsx`·`TreeMap.tsx`)를 이 모듈로 바꾸는 일은 시민 웹 담당과 같이 한다. 시민 웹의 "내 나무"·"내 위치" 표시는 `kindOf` 옵션과 추가 옵션으로 넣는다.
