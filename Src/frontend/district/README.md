# 구청 웹 (frontend/district)

녹지 담당자가 쓰는 데스크탑 웹이다. 담당: 오승현(구청 프론트).
Vite + React + TypeScript, 화면 이동은 React Router, 스타일은 CSS Modules와 CSS 변수(디자인 토큰)를 쓴다.

## 실행

Node.js 22 이상이 필요하다. API 서버(`Src/backend`)가 4000번에서 떠 있어야 화면에 숫자가 나온다(`Src/README.md`).

```bash
cd Src/frontend/district
npm install        # 처음 한 번, package.json이 바뀌었을 때
npm run dev        # http://localhost:5174
```

```bash
npm run typecheck  # 타입 검사
npm run lint       # 코드 규칙 검사
npm run build      # dist/로 빌드
```

- 개발 서버는 `/admin`, `/auth`, `/weather`, `/volunteer-hours` 요청을 API 서버로 넘긴다(`vite.config.ts`의 proxy). 그래서 화면 코드는 `fetch('/admin/dashboard')`처럼 주소 없이 경로만 쓴다.
- API 서버 주소를 바꾸려면 이 폴더에 `.env`를 만들고 `API_SERVER=http://주소:포트`를 넣는다.

## 로그인

- 로그인 화면은 `POST /auth/login`을 부른다. 이 API는 시민-BE 회원·인증(#3)에서 만들고, 응답이 `{ token }`이라고 가정했다. 명세가 나오면 `src/auth/AuthContext.tsx`의 `login()`만 맞춘다.
- 받은 토큰은 브라우저 `localStorage`에 둔다. 401 응답이 오면 자동으로 로그아웃된다.

### 개발용 토큰 (#3 전까지)

`npm run dev`로 띄운 화면에서만 로그인 화면 아래 "개발용 토큰으로 들어가기"가 보인다. 구청 담당자 계정과 토큰을 직접 만들어 넣는다.

1. 로컬 DB에 구청 담당자 계정을 만든다. `agency`는 가로수 데이터의 관리청 값(`trees.agency`)과 같아야 그 관리청 데이터가 보인다.

   ```bash
   docker exec -it treemate-db psql -U treemate -d treemate -c \
     "INSERT INTO users (email, password_hash, nickname, role, agency) VALUES ('officer@test.local', '-', '중구 담당자', 'officer', '중구') RETURNING id;"
   ```

2. 나온 id로 토큰을 만든다. `Src/backend`에서 실행하고, `JWT_SECRET`은 `Src/.env` 값과 같아야 한다.

   ```bash
   cd Src/backend
   node -e "console.log(require('jsonwebtoken').sign({}, process.argv[1], { subject: process.argv[2], expiresIn: '7d' }))" "<JWT_SECRET>" "<id>"
   ```

3. 출력된 토큰을 로그인 화면의 개발용 토큰 칸에 붙여 넣는다.

## 폴더

```
src/
  main.tsx, App.tsx    앱 시작, 화면 주소(라우트) 목록
  styles/global.css    디자인 토큰(색·글꼴)과 기본 스타일. 색 값은 여기에만 쓴다
  api/                 API 호출. client.ts(토큰·에러 처리 공통), 화면별 API 파일
  auth/                로그인 상태, 로그인 화면
  layout/              왼쪽 메뉴 + 화면 틀
  pages/               화면. 한눈에 보기(#28), 신청 심사(#74), 보고서 검토(#75), 물품 지급(#76), 신고 처리(#29)
  lib/                 화면과 분리한 함수(날짜·시간 표시 등)
```

- 디자인 토큰은 팀 시안(2026-11)의 구청 화면 색·글꼴을 옮긴 값이다. Figma 디자인 가이드(#36)가 확정되면 `global.css` 값만 바꾼다.
- 시민 웹과 같이 쓸 컴포넌트(지도 등)는 `Src/frontend/shared/`에 둔다(#27).
